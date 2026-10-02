// The moves a retirement announced, made at their date (`SC-SUB-031`).
//
// A subscription told of a retirement continues on the replacement from the
// date it was told, at the replacement's price. Nothing moves it at that moment:
// a run every quarter of an hour finds every subscription whose date has come
// and that is still on the retired version, and moves it — so a run that did not
// happen, under a maintenance lock or on a stopped server, is caught up by the
// next. What the subscription pays for the time between the date and the move
// is the replacement's price all the same: the charge journal does not price a
// period from the retired version's line once the date has come, and waits for
// the contract the move writes (`SC-PRIC-062`).
//
// The move is written the way the subscriber's own changes are claimed: only
// while the subscription is still bound to the retired version and its
// cancellation is as read, so a change made in between is not written over. A
// change the subscriber scheduled survives it. The move and the contract it
// writes are one: where the contract cannot be written, the move is put back,
// and the next run makes both.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
    BillingCycle,
    RetirementMoveRun,
    RlsBypassPort,
    SubscriptionNoticeRepository,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
    TenantSubscriptionWritePort,
    VersionRetiredNotice,
} from '@saasicat/core';

import { AdminAuditService, platformJobActor } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { recordChargesAfter } from './charges/record-charges-after.js';
import { SubscriberChargeService } from './charges/subscriber-charge.service.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import { bindReplacement, bindRetiredAgain } from './retirement-binding.js';
import { leavesTheVersionBy } from './retirement-reach.js';
import { retirementNoticesDue } from './retirement-notices.js';
import {
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
} from './tenant-billing.tokens.js';

/** The name the run writes its audit entries under: `job:platform:retirement-moves`. */
const JOB = 'retirement-moves';

/** Why a move was not made, as its audit entry and the log say it. */
type MoveFailure = 'no-party' | 'replacement-not-bookable' | 'contract-not-written';

@Injectable()
export class RetirementMoveService {
    private readonly logger = new Logger(RetirementMoveService.name);
    /**
     * The failures already written to the audit log by this process, so a move
     * that fails on every run is recorded once rather than every quarter of an
     * hour. A restart records it once more.
     */
    private readonly auditedFailures = new Set<string>();

    constructor(
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(SUBSCRIPTION_WRITE_PORT_TOKEN)
        private readonly writes: TenantSubscriptionWritePort,
        @Inject(ENTITLEMENT_SERVICE_TOKEN)
        private readonly entitlements: EntitlementService,
        // The run is the installation's, not a tenant's.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
        @Optional()
        @Inject(SubscriberChargeService)
        private readonly charges: SubscriberChargeService | null = null,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
    ) {}

    /** Moves every subscription whose retirement has taken effect by `now`. */
    async moveDue(now: Date): Promise<RetirementMoveRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const due = await retirementNoticesDue(this.notices, now);
            let moved = 0;
            let failed = 0;
            for (const [retiredId, notices] of groupByRetiredVersion(due)) {
                // `listBoundToVersion` is required where retiring is on, and
                // a notice exists only where it was.
                const onIt = await this.subscriptions.listBoundToVersion!(retiredId);
                const byId = new Map(onIt.map((row) => [row.subscription.id, row.subscription]));
                for (const notice of notices) {
                    const sub = byId.get(notice.subscriptionId);
                    if (!sub || !this.isMovable(sub, notice)) continue;
                    const outcome = await this.move(notice, sub, now);
                    if (outcome === 'moved') moved += 1;
                    if (outcome === 'failed') failed += 1;
                }
            }
            return { moved, failed };
        });
    }

    /**
     * Whether the move is the platform's to make: not where the subscription
     * has ended by its date, and not where a change of its own takes it off the
     * version by then — that change is the subscriber's, and it comes first.
     */
    private isMovable(sub: SubscriptionUsageRecord, notice: VersionRetiredNotice): boolean {
        const at = new Date(notice.effectiveAt);
        return !cancellationHasLanded(sub, at) && !leavesTheVersionBy(sub, at);
    }

    private async move(
        notice: VersionRetiredNotice,
        sub: SubscriptionUsageRecord,
        now: Date,
    ): Promise<'moved' | 'failed' | 'changed'> {
        const { tenantId } = notice;
        // Asked first, as every platform change asks it: a move written and a
        // contract that cannot name its party would leave the subscription on
        // one version and its contract on the other.
        try {
            await this.contractFreeze?.assertPartyFor(tenantId);
        } catch {
            return this.failed(notice, 'no-party');
        }
        const result = await bindReplacement(this.writes, tenantId, sub, notice, true);
        if (!result.claimed) {
            // Either the subscription changed between the read and the write —
            // the next run decides afresh — or, where it is still as read, the
            // write refused the replacement: it takes no bookings any more.
            return (await this.stillAsRead(notice, sub))
                ? this.failed(notice, 'replacement-not-bookable')
                : 'changed';
        }
        this.entitlements.invalidateTenant(tenantId);
        // A trial commits to no period and is charged nothing; its contract is
        // frozen when it converts, from the version it is bound to by then.
        const isTrial = sub.status === 'TRIAL';
        if (!isTrial && !(await this.writeContract(notice, sub, now))) {
            // Left half made, the subscription would run on the replacement
            // under the retired version's contract, and every period from its
            // date would wait for a contract no run writes.
            return this.failed(notice, 'contract-not-written', {
                putBack: await this.putBack(notice, sub),
            });
        }
        await this.auditMove(notice, 'PLAN_VERSION_RETIREMENT_MOVE');
        if (!isTrial) {
            await recordChargesAfter(this.charges, tenantId, 'a retirement move', this.logger);
        }
        return 'moved';
    }

    /**
     * Binds the subscription back to the version retired, where the move's
     * contract could not be written; whether that was written. The change it
     * scheduled goes back with it.
     */
    private async putBack(
        notice: VersionRetiredNotice,
        sub: SubscriptionUsageRecord,
    ): Promise<boolean> {
        const putBack = await bindRetiredAgain(
            this.writes,
            notice.tenantId,
            sub,
            notice,
            true,
            this.logger,
        );
        this.entitlements.invalidateTenant(notice.tenantId);
        return putBack;
    }

    /** Freezes the move's contract, marked with the retirement; whether it was written. */
    private async writeContract(
        notice: VersionRetiredNotice,
        sub: SubscriptionUsageRecord,
        now: Date,
    ): Promise<boolean> {
        if (!this.contractFreeze) return true;
        try {
            await this.contractFreeze.freezeOnPlanChange(
                notice.tenantId,
                notice.replacement.planKey,
                sub.billingCycle as BillingCycle,
                now,
                sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
                { retirementId: notice.retirementId },
            );
            return true;
        } catch (error) {
            this.logger.error(
                `The contract for the move of subscription ${notice.subscriptionId} could not ` +
                    `be written (tenant ${notice.tenantId}): ${String(error)}`,
            );
            return false;
        }
    }

    /** Whether the subscription still holds what the write claimed it by. */
    private async stillAsRead(
        notice: VersionRetiredNotice,
        read: SubscriptionUsageRecord,
    ): Promise<boolean> {
        const now = await this.subscriptions.findForTenant(notice.tenantId);
        return (
            now?.planVersion?.id === notice.retired.planVersionId &&
            sameInstant(now.canceledAt ?? null, read.canceledAt ?? null) &&
            now.pendingPlan === read.pendingPlan &&
            now.pendingBillingCycle === read.pendingBillingCycle &&
            sameInstant(now.pendingEffectiveAt, read.pendingEffectiveAt) &&
            now.pendingChangeVersionId === read.pendingChangeVersionId
        );
    }

    private async failed(
        notice: VersionRetiredNotice,
        reason: MoveFailure,
        extra: Record<string, unknown> = {},
    ): Promise<'failed'> {
        this.logger.error(
            `Subscription ${notice.subscriptionId} of tenant ${notice.tenantId} could not be ` +
                `moved to version ${notice.replacement.version} of ${notice.replacement.planKey}: ` +
                `${reason}. The next run tries again while it is on the version retired.`,
        );
        const key = `${notice.subscriptionId}:${notice.retirementId}:${reason}`;
        if (!this.auditedFailures.has(key)) {
            this.auditedFailures.add(key);
            await this.auditMove(notice, 'PLAN_VERSION_RETIREMENT_MOVE_FAILED', {
                reason,
                ...extra,
            });
        }
        return 'failed';
    }

    private async auditMove(
        notice: VersionRetiredNotice,
        action: string,
        extra: Record<string, unknown> = {},
    ): Promise<void> {
        try {
            await this.audit?.log({
                actor: platformJobActor(JOB),
                entity: 'Subscription',
                entityId: notice.subscriptionId,
                action,
                changes: {
                    tenantId: notice.tenantId,
                    retirementId: notice.retirementId,
                    fromPlanVersionId: notice.retired.planVersionId,
                    toPlanVersionId: notice.replacement.planVersionId,
                    effectiveAt: notice.effectiveAt,
                    ...extra,
                },
            });
        } catch (error) {
            // The move stands either way; the lost record of it is said loudly.
            this.logger.error(
                `Writing the audit entry ${action} for subscription ${notice.subscriptionId} failed.`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}

function groupByRetiredVersion(
    notices: readonly VersionRetiredNotice[],
): Map<string, VersionRetiredNotice[]> {
    const groups = new Map<string, VersionRetiredNotice[]>();
    for (const notice of notices) {
        const id = notice.retired.planVersionId;
        groups.set(id, [...(groups.get(id) ?? []), notice]);
    }
    return groups;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
    return a === null || b === null ? a === b : a.getTime() === b.getTime();
}
