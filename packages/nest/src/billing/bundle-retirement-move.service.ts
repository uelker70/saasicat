// The moves an add-on retirement announced, made at their date (`SC-BUN-049`).
//
// A booking told that its add-on version is being retired continues on the
// replacement from its date. As for a plan version, nothing moves it at that
// moment: a run every quarter of an hour finds every booking whose date has
// come and that is still on the version retired, and moves it — so a run that
// did not happen is caught up by the next. What the booking pays for the time
// between the date and the move is the replacement's price all the same: the
// charge journal prices no period of it from the date until the move has
// written the contract with the replacement (`SC-BUN-050`).
//
// The move keeps what the notice promised: it binds the replacement whatever
// its sale, since moving a booking books nothing new (`SC-BUN-051`). It is
// claimed only while the booking is still on the version retired, so a second
// run, or the put-back below, never writes over it. The booking keeps its row,
// its period, its terms and its rhythm (`SC-BUN-049`). The move and the
// contract it writes are one: where the contract cannot be written, the booking
// goes back, and the next run makes both.
//
// A booking that has ended — or whose subscription has — is not moved, even
// where the run missed its date: the source of a contract hands no line for an
// ended booking, so a move would write a contract without it. The booking ran
// on the version retired until it ended, and the journal charges those periods
// at that version (`SC-BUN-050`).

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
    BillingCycle,
    BundleVersionRetiredNotice,
    RetirementMoveRun,
    RlsBypassPort,
    SubscriptionBundleRecord,
    SubscriptionBundleRepository,
    SubscriptionNoticeRepository,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
} from '@saasicat/core';

import { AdminAuditService, platformJobActor } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { bookingsOfVersion } from './bundle-bookings-of-version.js';
import { bookingOverBy } from './bundle-retirement-reach.js';
import { recordChargesAfter } from './charges/record-charges-after.js';
import { SubscriberChargeService } from './charges/subscriber-charge.service.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import { bundleRetirementNoticesDue, groupByRetiredBundleVersion } from './retirement-notices.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import {
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
} from './tenant-billing.tokens.js';

/** The name the run writes its audit entries under: `job:platform:add-on-retirement-moves`. */
const JOB = 'add-on-retirement-moves';

/** Why a move was not made, as its audit entry and the log say it. */
type MoveFailure = 'no-party' | 'contract-not-written';

@Injectable()
export class BundleRetirementMoveService {
    private readonly logger = new Logger(BundleRetirementMoveService.name);
    /**
     * The failures already written to the audit log by this process, so a move
     * that fails on every run is recorded once rather than every quarter of an
     * hour. A restart records it once more.
     */
    private readonly auditedFailures = new Set<string>();
    /**
     * The bookings that ended before their move came whose charges this
     * process has recorded, so the journal is asked once rather than every
     * quarter of an hour.
     */
    private readonly endedUnmoved = new Set<string>();

    constructor(
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
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

    /** Moves every booking whose add-on retirement has taken effect by `now`. */
    async moveDue(now: Date): Promise<RetirementMoveRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const due = await bundleRetirementNoticesDue(this.notices, now);
            let moved = 0;
            let failed = 0;
            for (const [retiredId, notices] of groupByRetiredBundleVersion(due)) {
                // `listOfVersion` and `listByIds` are required where retiring is
                // on, and a notice exists only where it was.
                const { bookings, owners } = await bookingsOfVersion(
                    this.bookings,
                    this.subscriptions,
                    retiredId,
                );
                for (const notice of notices) {
                    const booking = bookings.get(notice.subscriptionBundleId);
                    const sub = owners.get(notice.subscriptionId)?.subscription;
                    if (!booking || !sub) continue;
                    const subscriptionEndsAt = cancellationLandsAt(sub);
                    if (bookingOverBy(booking, subscriptionEndsAt, now)) {
                        // Over by its date, nothing is left to move; over
                        // since, it ran on the version retired until then.
                        const ranPastItsDate = !bookingOverBy(
                            booking,
                            subscriptionEndsAt,
                            new Date(notice.effectiveAt),
                        );
                        if (ranPastItsDate) await this.endedBeforeItsMove(notice, sub);
                        continue;
                    }
                    const outcome = await this.move(notice, booking, now);
                    if (outcome === 'moved') moved += 1;
                    if (outcome === 'failed') failed += 1;
                }
            }
            return { moved, failed };
        });
    }

    private async move(
        notice: BundleVersionRetiredNotice,
        booking: SubscriptionBundleRecord,
        now: Date,
    ): Promise<'moved' | 'failed' | 'changed'> {
        const { tenantId } = notice;
        // Asked first, as every platform change asks it: a move written and a
        // contract that cannot name its party would leave the booking on one
        // version and its contract on the other.
        try {
            await this.contractFreeze?.assertPartyFor(tenantId);
        } catch {
            return this.failed(notice, 'no-party');
        }
        // `moveToVersion` is required where retiring is on. Nothing claimed:
        // the booking left the version between the read and the write, and the
        // next run decides afresh.
        const moved = await this.bookings.moveToVersion!(
            booking.id,
            notice.retired.bundleVersionId,
            notice.replacement.bundleVersionId,
        );
        if (!moved) return 'changed';
        this.entitlements.invalidateTenant(tenantId);
        // The subscription as it stands now that the booking is claimed, not
        // as the run read it, possibly minutes before: a cancellation declared
        // since has ended the contract in force on its date, and the contract
        // the move writes has to end on the same one; a trial may have
        // converted since, and needs that contract now.
        const sub = await this.subscriptions.findForTenant(tenantId);
        if (
            sub?.id !== notice.subscriptionId ||
            bookingOverBy(moved, cancellationLandsAt(sub), now)
        ) {
            // Over since the run read it: nothing is left to move, and the
            // next run finds it ended on the version retired.
            if (await this.putBack(notice)) return 'changed';
            return this.failed(notice, 'contract-not-written', { putBack: false });
        }
        // A trial commits to no period and is charged nothing; its contract is
        // frozen when it converts, from the bookings as they stand by then.
        const isTrial = sub.status === 'TRIAL';
        if (!isTrial && !(await this.writeContract(notice, sub, now))) {
            // Left half made, the booking would run on the replacement under a
            // contract naming the version retired, and every period from its
            // date would wait for a contract no run writes.
            return this.failed(notice, 'contract-not-written', {
                putBack: await this.putBack(notice),
            });
        }
        await this.auditMove(notice, 'BUNDLE_VERSION_RETIREMENT_MOVE');
        if (!isTrial) {
            await recordChargesAfter(
                this.charges,
                tenantId,
                'an add-on retirement move',
                this.logger,
            );
        }
        return 'moved';
    }

    /**
     * A booking that ran past its date and ended before a run moved it. Its
     * periods from the date waited for the move while it ran, and wait no more
     * now that it has ended; the journal is asked for them here, since nothing
     * else need ask it again for a subscription that has ended.
     */
    private async endedBeforeItsMove(
        notice: BundleVersionRetiredNotice,
        sub: SubscriptionUsageRecord,
    ): Promise<void> {
        const key = `${notice.subscriptionBundleId}:${notice.retirementId}`;
        if (this.endedUnmoved.has(key)) return;
        // A trial is charged nothing.
        if (sub.status !== 'TRIAL' && this.charges) {
            try {
                await this.charges.recordDueCharges(notice.tenantId);
            } catch (error) {
                // Not marked: the next run asks again.
                this.logger.error(
                    `Recording the charges of booking ${notice.subscriptionBundleId}, which ended ` +
                        `before its move (tenant ${notice.tenantId}), failed: ${String(error)}`,
                );
                return;
            }
        }
        this.endedUnmoved.add(key);
        this.logger.warn(
            `Booking ${notice.subscriptionBundleId} of tenant ${notice.tenantId} ended before it ` +
                `moved to version ${notice.replacement.version} of ` +
                `${notice.replacement.bundleKey}. It is charged at the version it ran on.`,
        );
    }

    /**
     * Moves the booking back onto the version retired, where the move cannot
     * stand; whether that was written. Where it was not — the booking changed
     * in between, or the store failed — the booking is on the replacement
     * without its contract, the log says so, and the run goes on with the next.
     */
    private async putBack(notice: BundleVersionRetiredNotice): Promise<boolean> {
        let why: string;
        try {
            const back = await this.bookings.moveToVersion!(
                notice.subscriptionBundleId,
                notice.replacement.bundleVersionId,
                notice.retired.bundleVersionId,
            );
            if (back) return true;
            why = 'it changed in between';
        } catch (error) {
            why = String(error);
        } finally {
            this.entitlements.invalidateTenant(notice.tenantId);
        }
        this.logger.error(
            `Booking ${notice.subscriptionBundleId} of tenant ${notice.tenantId} is on the ` +
                `replacement without its contract, and could not be put back: ${why}.`,
        );
        return false;
    }

    /**
     * Freezes the move's contract, its add-on line marked with the retirement;
     * whether it was written.
     */
    private async writeContract(
        notice: BundleVersionRetiredNotice,
        sub: SubscriptionUsageRecord,
        now: Date,
    ): Promise<boolean> {
        if (!this.contractFreeze) return true;
        try {
            // The plan stays as it is: the usage port types the rhythm as a
            // string, and the column behind it holds the two values.
            await this.contractFreeze.freezeOnPlanChange(
                notice.tenantId,
                sub.planVersion.planId,
                sub.billingCycle as BillingCycle,
                now,
                sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
                {
                    retirementId: notice.retirementId,
                    addOn: { bundleVersionId: notice.replacement.bundleVersionId },
                },
            );
            return true;
        } catch (error) {
            this.logger.error(
                `The contract for the move of booking ${notice.subscriptionBundleId} could not ` +
                    `be written (tenant ${notice.tenantId}): ${String(error)}`,
            );
            return false;
        }
    }

    private async failed(
        notice: BundleVersionRetiredNotice,
        reason: MoveFailure,
        extra: Record<string, unknown> = {},
    ): Promise<'failed'> {
        this.logger.error(
            `Booking ${notice.subscriptionBundleId} of tenant ${notice.tenantId} could not be ` +
                `moved to version ${notice.replacement.version} of ` +
                `${notice.replacement.bundleKey}: ${reason}. The next run tries again while it ` +
                'is on the version retired.',
        );
        const key = `${notice.subscriptionBundleId}:${notice.retirementId}:${reason}`;
        if (!this.auditedFailures.has(key)) {
            this.auditedFailures.add(key);
            await this.auditMove(notice, 'BUNDLE_VERSION_RETIREMENT_MOVE_FAILED', {
                reason,
                ...extra,
            });
        }
        return 'failed';
    }

    private async auditMove(
        notice: BundleVersionRetiredNotice,
        action: string,
        extra: Record<string, unknown> = {},
    ): Promise<void> {
        try {
            await this.audit?.log({
                actor: platformJobActor(JOB),
                entity: 'SubscriptionBundle',
                entityId: notice.subscriptionBundleId,
                action,
                changes: {
                    tenantId: notice.tenantId,
                    subscriptionId: notice.subscriptionId,
                    retirementId: notice.retirementId,
                    fromBundleVersionId: notice.retired.bundleVersionId,
                    toBundleVersionId: notice.replacement.bundleVersionId,
                    effectiveAt: notice.effectiveAt,
                    ...extra,
                },
            });
        } catch (error) {
            // The move stands either way; the lost record of it is said loudly.
            this.logger.error(
                `Writing the audit entry ${action} for booking ${notice.subscriptionBundleId} failed.`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}
