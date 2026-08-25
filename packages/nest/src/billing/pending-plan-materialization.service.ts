import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { BillingCycle, TenantSubscriptionWritePort } from '@saasicat/core';

import { EntitlementService } from '../entitlement/entitlement.service.js';
import { initialPeriodWindow } from './billing-period.js';
import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import {
    PENDING_PLAN_QUERY_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
    type PendingPlanQueryPort,
} from './tenant-billing.tokens.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';

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
// The service is opt-in: it is only registered if the consumer provides a
// `pendingPlanQueryPort`. The cron trigger (timing) is supplied by the
// consumer — it calls `materializeDuePlanChanges()`.

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
    ) {}

    async materializeDuePlanChanges(now: Date = new Date()): Promise<{ applied: number }> {
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
            const cycle = (change.pendingBillingCycle ?? 'MONTHLY') as BillingCycle;
            const period = initialPeriodWindow(now, cycle);
            try {
                const result = await this.subscriptionWrite.changePlanImmediate(change.tenantId, {
                    planId: change.pendingPlan,
                    cycle,
                    periodStart: period.start,
                    periodEnd: period.end,
                    // Status stays (ACTIVE/PAST_DUE etc.) — only the plan is materialized.
                    nextStatus: null,
                    expectedCanceledAt: change.canceledAt,
                });
                if (!result.claimed) {
                    // A cancellation arrived between the query and this write.
                    // Same answer as the check above, reached the other way.
                    declined += 1;
                    continue;
                }
                this.entitlements.invalidateTenant(change.tenantId);
                applied += 1;
            } catch (err) {
                // Non-fatal per tenant — one failure must not abort the run.
                this.logger.error(
                    `Pending plan materialisation failed (tenant ${change.tenantId}): ${String(err)}`,
                );
                continue;
            }
            // #18: freeze contract (non-fatal — the plan change is persisted).
            await this.tryFreeze(
                change.tenantId,
                change.pendingPlan,
                cycle,
                now,
                change.canceledEffectiveAt ?? change.canceledAt,
            );
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

    private async tryFreeze(
        tenantId: string,
        plan: string,
        cycle: BillingCycle,
        now: Date,
        endsAt: Date | null,
    ): Promise<void> {
        if (!this.contractFreeze) return;
        try {
            // The due change was declined above when the cancellation had
            // landed, so anything reaching here is a subscription still
            // running — with an ending the frozen contract has to carry.
            await this.contractFreeze.freezeOnPlanChange(tenantId, plan, cycle, now, endsAt);
        } catch (err) {
            this.logger.error(
                `Contract freeze after materialisation failed (tenant ${tenantId}): ${String(err)}`,
            );
        }
    }
}
