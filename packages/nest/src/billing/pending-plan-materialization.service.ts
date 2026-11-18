import { HttpException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
    RlsBypassPort,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
    TenantSubscriptionWritePort,
} from '@saasicat/core';
import { AdminAuditService, platformJobActor } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';

import { EntitlementService } from '../entitlement/entitlement.service.js';
import { initialPeriodWindow } from './billing-period.js';
import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import {
    PENDING_PLAN_QUERY_PORT_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
    type DuePendingPlanChange,
    type PendingPlanQueryPort,
} from './tenant-billing.tokens.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import { freezeOrPutBack, type PlanChangeTerms } from './contract-or-take-back.js';
import { rhythmTheChangeLandsIn } from './scheduled-change.js';

// PendingPlanMaterializationService (#19) — materializes scheduled plan changes
// at the effective date. A scheduled change (downgrade/cycle) only sets
// `pendingPlan` + `pendingEffectiveAt`; otherwise the effective plan is only
// resolved LAZILY in the entitlement resolver (`resolveEntitlementPlan`) — there
// is no materialization point at which follow-up actions (contract freeze, audit,
// invoicing) could trigger.
//
// This run applies due pending changes via `TenantSubscriptionWritePort.
// changePlanImmediate` — that clears the pending fields AND triggers the
// adapter-/hook-side follow-up actions (freeze etc.). TRIAL is excluded:
// there the trial entitlement plan applies during the trial, and the transition
// is driven by the trial lifecycle.
//
// A change and its contract are one (`SC-CHG-026`): the contract is asked
// first, and where it cannot be written after all the subscription is put
// back, its change still scheduled — so the change stays due, and the next run
// makes both.
//
// The service is opt-in: it is only registered if the consumer provides a
// `pendingPlanQueryPort`. The cron trigger (timing) is supplied by the
// consumer — it calls `materializeDuePlanChanges()`.

/** The name the run writes its audit entries under: `job:platform:scheduled-plan-changes`. */
const JOB = 'scheduled-plan-changes';

/** Why a due change was not made, as its audit entry says it. */
type ChangeFailure =
    | {
          readonly reason: 'contract-refused';
          readonly code: string | null;
          readonly params?: unknown;
      }
    | { readonly reason: 'contract-not-written'; readonly putBack: boolean };

@Injectable()
export class PendingPlanMaterializationService {
    private readonly logger = new Logger(PendingPlanMaterializationService.name);

    constructor(
        @Inject(PENDING_PLAN_QUERY_PORT_TOKEN)
        private readonly query: PendingPlanQueryPort,
        @Inject(SUBSCRIPTION_WRITE_PORT_TOKEN)
        private readonly subscriptionWrite: TenantSubscriptionWritePort,
        private readonly entitlements: EntitlementService,
        // #18: optional contract freeze after materialization. Without a hook
        // the entitlement resolution stays version-/catalog-pinned.
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
        // The run applies every tenant's due change, reads and writes, so under
        // row-level security it works inside the bypass: without the frame a
        // forced policy leaves it nothing to see and nothing to write, and it
        // reports that as a quiet night.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        // Where the change records what the subscriber agreed to when they
        // scheduled it: read before the write that clears it, and handed to
        // the contract it ends in. Without it the contract takes the file's.
        @Optional()
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly usage: SubscriptionUsagePort | null = null,
        // Where a change that could not be made is recorded for the operator.
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: Pick<AdminAuditService, 'log'> | null = null,
    ) {}

    /**
     * The failures already written to the audit log by this process, so a
     * change that fails on every run is recorded once rather than every
     * quarter of an hour. A restart records it once more.
     */
    private readonly auditedFailures = new Set<string>();

    async materializeDuePlanChanges(now: Date = new Date()): Promise<{ applied: number }> {
        return readAcrossTenants(this.rlsBypass, () => this.materializeAll(now));
    }

    private async materializeAll(now: Date): Promise<{ applied: number }> {
        const due = await this.query.findDuePendingPlanChanges(now);

        let applied = 0;
        let declined = 0;
        for (const change of due) {
            // A change scheduled before the customer cancelled still comes due.
            // Applying it here would restart the billing period and run the
            // follow-up hooks — a contract freeze among them — on a
            // subscription whose term is over.
            if (cancellationHasLanded(change, now)) {
                declined += 1;
                continue;
            }
            try {
                const outcome = await this.apply(change, now);
                if (outcome === 'declined') declined += 1;
                if (outcome === 'applied') applied += 1;
            } catch (err) {
                // Non-fatal per tenant — one failure must not abort the run.
                this.logger.error(
                    `Pending plan materialisation failed (tenant ${change.tenantId}): ${String(err)}`,
                );
            }
        }

        if (applied > 0) {
            this.logger.log(
                `Pending plan materialisation: applied ${applied} scheduled plan change(s).`,
            );
        }
        if (declined > 0) {
            // Said out loud rather than skipped quietly: a scheduled change that
            // never happens is something an operator may be asked about.
            this.logger.log(
                `Pending plan materialisation: declined ${declined} change(s) on ` +
                    `subscriptions whose cancellation has taken effect.`,
            );
        }
        return { applied };
    }

    /** Applies one due change with its contract, or leaves it due. */
    private async apply(
        change: DuePendingPlanChange,
        now: Date,
    ): Promise<'applied' | 'declined' | 'left-due'> {
        const cycle = rhythmTheChangeLandsIn(change);
        const period = initialPeriodWindow(now, cycle);
        // Read before the write that clears the change: what the subscriber
        // agreed to when they scheduled it, and the row a contract that cannot
        // be written puts back.
        const read = (await this.usage?.findForTenant(change.tenantId)) ?? null;
        if (this.contractFreeze && !read) {
            this.logger.error(
                `The scheduled change of tenant ${change.tenantId} is due, and its subscription ` +
                    'could not be read, so nothing could be put back: it stays due.',
            );
            return 'left-due';
        }
        // The due change was declined above when the cancellation had landed,
        // so anything reaching here is a subscription still running — with an
        // ending the contract has to carry.
        const terms: PlanChangeTerms = {
            plan: change.pendingPlan,
            cycle,
            effectiveFrom: now,
            endsAt: change.canceledEffectiveAt ?? change.canceledAt,
            agreed: read?.pendingAgreement ?? undefined,
        };
        // Asked first, as every plan change asks it: what the contract refuses
        // is answered while nothing has moved.
        try {
            await this.contractFreeze?.assertContractFor(
                change.tenantId,
                { plan: change.pendingPlan, planVersionId: change.pendingChangeVersionId ?? null },
                { effectiveFrom: now, cycle, endsAt: terms.endsAt },
            );
        } catch (error) {
            await this.failed(change, read, refusalOf(error));
            return 'left-due';
        }
        const result = await this.subscriptionWrite.changePlanImmediate(change.tenantId, {
            planId: change.pendingPlan,
            cycle,
            periodStart: period.start,
            periodEnd: period.end,
            // Status stays (ACTIVE/PAST_DUE etc.) — only the plan is materialized.
            nextStatus: null,
            expectedCanceledAt: change.canceledAt,
            // A change binds the version it was quoted at — another plan's
            // (`SC-CHG-022`), or a newer one of the same plan taken as an offer
            // (`SC-SUB-021`). One that names none leaves the plan as it is and
            // moves the rhythm, not the version the subscriber agreed to.
            keepsBoundVersion: (change.pendingChangeVersionId ?? null) === null,
            quotedPlanVersionId: change.pendingChangeVersionId,
        });
        if (!result.claimed) {
            // A cancellation arrived between the query and this write. Same
            // answer as the check in the run, reached the other way.
            return 'declined';
        }
        this.entitlements.invalidateTenant(change.tenantId);
        if (!read) return 'applied';
        const outcome = await freezeOrPutBack(
            {
                contractFreeze: this.contractFreeze,
                writes: this.subscriptionWrite,
                entitlements: this.entitlements,
                logger: this.logger,
            },
            change.tenantId,
            terms,
            {
                read,
                boundAfter: change.pendingChangeVersionId ?? read.planVersion?.id ?? null,
                what: 'a scheduled plan change',
            },
        );
        if (outcome.written) return 'applied';
        await this.failed(change, read, {
            reason: 'contract-not-written',
            putBack: outcome.takenBack,
        });
        return 'left-due';
    }

    /**
     * Says that a due change was not made, once in each run, and records it in
     * the audit log once in this process. The change stays due wherever the
     * subscription was put back, and the next run tries it again.
     */
    private async failed(
        change: DuePendingPlanChange,
        read: SubscriptionUsageRecord | null,
        failure: ChangeFailure,
    ): Promise<void> {
        this.logger.error(
            `The scheduled change of tenant ${change.tenantId} to ${change.pendingPlan} was not ` +
                `made: ${failure.reason}. The next run tries again while it is due.`,
        );
        const subscriptionId = read?.id ?? change.tenantId;
        const key = `${subscriptionId}:${change.pendingPlan}:${change.pendingChangeVersionId ?? ''}:${failure.reason}`;
        // Reserved before the write, so a run overlapping this one writes no
        // second entry, and released where the write fails, so the next run
        // tries it again.
        if (this.auditedFailures.has(key)) return;
        this.auditedFailures.add(key);
        try {
            await this.audit?.log({
                actor: platformJobActor(JOB),
                entity: 'Subscription',
                entityId: subscriptionId,
                tenantId: change.tenantId,
                action: 'SCHEDULED_PLAN_CHANGE_FAILED',
                changes: {
                    tenantId: change.tenantId,
                    fromPlan: read?.plan ?? null,
                    toPlan: change.pendingPlan,
                    toCycle: rhythmTheChangeLandsIn(change),
                    toPlanVersionId: change.pendingChangeVersionId ?? null,
                    ...failure,
                },
            });
        } catch (error) {
            this.auditedFailures.delete(key);
            this.logger.error(
                `Writing the audit entry SCHEDULED_PLAN_CHANGE_FAILED for tenant ` +
                    `${change.tenantId} failed: ${String(error)}`,
            );
        }
    }
}

/** The stable code a contract refused with, and its values, where it gave them. */
function refusalOf(error: unknown): ChangeFailure {
    const response: unknown = error instanceof HttpException ? error.getResponse() : null;
    if (typeof response !== 'object' || response === null) {
        return { reason: 'contract-refused', code: null };
    }
    const code = 'code' in response && typeof response.code === 'string' ? response.code : null;
    return 'params' in response && response.params !== undefined
        ? { reason: 'contract-refused', code, params: response.params }
        : { reason: 'contract-refused', code };
}
