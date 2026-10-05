// The switches a subscriber took for the end of a booking's term, made at that
// moment (`SC-BUN-059`).
//
// A newer add-on version that takes something away is taken for the end of the
// booking's running term (`SC-BUN-058`), and nothing moves the booking at that
// moment: a run every quarter of an hour finds every booking whose switch is
// due and makes it, so a run that did not happen is caught up by the next.
// What the booking pays from that moment is the new version's price all the
// same: the charge journal prices no period of it from then until the switch
// has written its contract.
//
// The switch keeps what was agreed. It moves the booking onto the version
// taken whatever its sale since, because moving a booking books nothing new,
// and the booking keeps its row, its period, its terms and its rhythm. A
// booking an add-on retirement moved in the meantime is carried along, from
// the version it is on, as a subscription's scheduled change is (`SC-SUB-031`).
// The switch is claimed with a write conditional on that version, so a second
// run never writes over it, and the switch and the contract it writes are one:
// where the contract cannot be written, the booking goes back, and the next run
// makes both.
//
// A booking that has ended by the time the run comes — or whose subscription
// has — never reaches the version taken, even where the run missed the moment:
// its switch is cleared, and the run asks the journal to charge it at the
// version it ran on. One that ends after the moment is switched, and ends on
// the new version.

import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import type {
    BillingCycle,
    RlsBypassPort,
    SubscriptionBundleRecord,
    SubscriptionBundleRepository,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
    TenantSubscriptionUsage,
} from '@saasicat/core';

import { AdminAuditService, platformJobActor } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { isTaxNotSupported } from '../tax/tax-treatments.js';
import { chargeWhatItRanOn, putBookingBack, type BookingMove } from './booking-move-guards.js';
import { ownersOf } from './bundle-bookings-of-version.js';
import { bookingOverBy } from './bundle-retirement-reach.js';
import { recordChargesAfter } from './charges/record-charges-after.js';
import { SubscriberChargeService } from './charges/subscriber-charge.service.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import { contractUnlessTrialOf } from './freeze-contract-after.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import { SUBSCRIPTION_USAGE_PORT_TOKEN } from './tenant-billing.tokens.js';

/** What one run did: switches made, and switches that failed and wait for the next run. */
export interface BundleVersionSwitchRun {
    readonly switched: number;
    readonly failed: number;
}

/** The name the run writes its audit entries under: `job:platform:add-on-version-switches`. */
const JOB = 'add-on-version-switches';

/** Why a switch was not made, as its audit entry and the log say it. */
type SwitchFailure = 'no-party' | 'tax-not-supported' | 'contract-not-written';

/** A switch due: the booking's move, and the moment it was taken for. */
interface DueSwitch extends BookingMove {
    readonly subscriptionId: string;
    readonly effectiveAt: Date;
}

@Injectable()
export class BundleVersionSwitchRunService implements OnModuleInit {
    private readonly logger = new Logger(BundleVersionSwitchRunService.name);
    /**
     * The failures already written to the audit log by this process, so a
     * switch that fails on every run is recorded once rather than every quarter
     * of an hour. A restart records it once more.
     */
    private readonly auditedFailures = new Set<string>();

    constructor(
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
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

    /**
     * Says once, at start-up, why no switch for the end of a term is offered
     * where the ports cannot carry one. Not a refusal: an installation whose
     * own ports lack the methods keeps every other offer.
     */
    onModuleInit(): void {
        if (this.canRun()) return;
        this.logger.warn(
            'Newer add-on versions that take something away are not offered: the ' +
                'SubscriptionBundleRepository needs `moveToVersion`, `scheduleVersion`, ' +
                '`unscheduleVersion` and `listScheduledVersionsDue`, and the ' +
                'SubscriptionUsagePort `listByIds`. Both shipped adapters have them.',
        );
    }

    /** Whether the ports hold what a switch for the end of a term needs. */
    canRun(): boolean {
        return Boolean(
            this.bookings.moveToVersion &&
            this.bookings.scheduleVersion &&
            this.bookings.unscheduleVersion &&
            this.bookings.listScheduledVersionsDue &&
            this.subscriptions.listByIds,
        );
    }

    /** Makes every switch due by `now`. */
    async switchDue(now: Date): Promise<BundleVersionSwitchRun> {
        if (!this.canRun()) return { switched: 0, failed: 0 };
        return readAcrossTenants(this.rlsBypass, async () => {
            const due = await this.bookings.listScheduledVersionsDue!(now);
            const owners = await ownersOf(this.subscriptions, due);
            let switched = 0;
            let failed = 0;
            for (const booking of due) {
                const owner = owners.get(booking.subscriptionId);
                if (!owner) continue;
                const outcome = await this.switchOne(booking, owner, now);
                if (outcome === 'switched') switched += 1;
                if (outcome === 'failed') failed += 1;
            }
            return { switched, failed };
        });
    }

    private async switchOne(
        booking: SubscriptionBundleRecord,
        { tenantId, subscription: readByTheRun }: TenantSubscriptionUsage,
        now: Date,
    ): Promise<'switched' | 'failed' | 'changed' | 'cleared'> {
        // Listed because it has a switch scheduled, which sets both.
        const due: DueSwitch = {
            tenantId,
            subscriptionId: booking.subscriptionId,
            subscriptionBundleId: booking.id,
            from: booking.bundleVersionId,
            to: booking.pendingBundleVersionId!,
            effectiveAt: booking.pendingVersionEffectiveAt!,
        };
        // Over by now — and so by its moment, which has come — it never moves:
        // the source of a contract hands no line for a booking that has ended.
        // One that ran past the moment had its periods from then held back
        // for the switch: the journal is asked for them before the switch is
        // cleared, and where it could not record them the switch stays, so
        // the next run asks again.
        if (endsBy(booking, readByTheRun, now)) {
            if (!endsBy(booking, readByTheRun, due.effectiveAt)) {
                const charged = await chargeWhatItRanOn(
                    this.subscriptions,
                    this.charges,
                    this.logger,
                    due,
                );
                if (charged === 'failed') return 'failed';
            }
            return this.clear(due, 'BUNDLE_VERSION_SWITCH_LAPSED');
        }
        // On it already: a run made the switch and its contract and could
        // not clear what was scheduled.
        if (due.from === due.to) return this.clear(due, null);
        try {
            await this.contractFreeze?.assertPartyFor(
                tenantId,
                contractUnlessTrialOf(readByTheRun, now),
            );
        } catch (error) {
            return this.failed(due, isTaxNotSupported(error) ? 'tax-not-supported' : 'no-party');
        }
        // `canRun` holds the store to having it. Nothing claimed: the booking
        // moved between the read and the write, and the next run decides afresh.
        const moved = await this.bookings.moveToVersion!(
            due.subscriptionBundleId,
            due.from,
            due.to,
        );
        if (!moved) return 'changed';
        this.entitlements.invalidateTenant(tenantId);
        // The subscription as it stands now that the booking is claimed: a
        // cancellation declared since ends the contract the switch writes, and
        // a trial may have converted.
        const sub = await this.subscriptions.findForTenant(tenantId);
        if (sub?.id !== due.subscriptionId || endsBy(moved, sub, now)) {
            // Over since the run read it: the next run clears it.
            if (await putBookingBack(this.bookings, this.entitlements, this.logger, due)) {
                return 'changed';
            }
            return this.failed(due, 'contract-not-written', { putBack: false });
        }
        // A trial commits to no period and is charged nothing; its contract is
        // frozen when it converts, from the bookings as they stand by then.
        const isTrial = sub.status === 'TRIAL';
        if (!isTrial && !(await this.writeContract(due, sub, now))) {
            return this.failed(due, 'contract-not-written', {
                putBack: await putBookingBack(this.bookings, this.entitlements, this.logger, due),
            });
        }
        await this.clear(due, 'BUNDLE_VERSION_SWITCH');
        if (!isTrial) {
            await recordChargesAfter(
                this.charges,
                tenantId,
                'an add-on version switch',
                this.logger,
            );
        }
        return 'switched';
    }

    /**
     * Freezes the switch's contract, the booking's new line marked with it;
     * whether it was written.
     */
    private async writeContract(
        due: DueSwitch,
        sub: SubscriptionUsageRecord,
        now: Date,
    ): Promise<boolean> {
        if (!this.contractFreeze) return true;
        try {
            await this.contractFreeze.freezeOnPlanChange(
                due.tenantId,
                sub.planVersion.planId,
                sub.billingCycle as BillingCycle,
                now,
                cancellationLandsAt(sub),
                {
                    addOnSwitch: {
                        subscriptionBundleId: due.subscriptionBundleId,
                        fromBundleVersionId: due.from,
                        bundleVersionId: due.to,
                        effectiveAt: due.effectiveAt,
                    },
                },
            );
            return true;
        } catch (error) {
            this.logger.error(
                `The contract for the switch of booking ${due.subscriptionBundleId} could not ` +
                    `be written (tenant ${due.tenantId}): ${String(error)}`,
            );
            return false;
        }
    }

    /**
     * Clears the switch scheduled, where it is still the one read, and records
     * why under `action` where one is given.
     */
    private async clear(due: DueSwitch, action: string | null): Promise<'cleared'> {
        const cleared = await this.bookings.unscheduleVersion!(due.subscriptionBundleId, due.to);
        if (!cleared) {
            this.logger.warn(
                `The switch of booking ${due.subscriptionBundleId} (tenant ${due.tenantId}) to ` +
                    `version ${due.to} was no longer scheduled when the run came to clear it.`,
            );
        }
        if (action) await this.record(due, action);
        return 'cleared';
    }

    private async failed(
        due: DueSwitch,
        reason: SwitchFailure,
        extra: Record<string, unknown> = {},
    ): Promise<'failed'> {
        // A booking that could not be put back is no longer on the version it
        // left, so the next run finds it on the version taken and only clears.
        const next =
            extra.putBack === false
                ? 'It is on the version taken without its contract.'
                : 'The next run tries again.';
        this.logger.error(
            `Booking ${due.subscriptionBundleId} of tenant ${due.tenantId} could not be ` +
                `switched to version ${due.to}: ${reason}. ${next}`,
        );
        const key = `${due.subscriptionBundleId}:${due.to}:${reason}`;
        if (!this.auditedFailures.has(key)) {
            this.auditedFailures.add(key);
            await this.record(due, 'BUNDLE_VERSION_SWITCH_FAILED', { reason, ...extra });
        }
        return 'failed';
    }

    private async record(
        due: DueSwitch,
        action: string,
        extra: Record<string, unknown> = {},
    ): Promise<void> {
        try {
            await this.audit?.log({
                actor: platformJobActor(JOB),
                entity: 'SubscriptionBundle',
                entityId: due.subscriptionBundleId,
                action,
                changes: {
                    tenantId: due.tenantId,
                    subscriptionId: due.subscriptionId,
                    fromBundleVersionId: due.from,
                    toBundleVersionId: due.to,
                    effectiveAt: due.effectiveAt.toISOString(),
                    ...extra,
                },
            });
        } catch (error) {
            // The switch stands either way; the lost record of it is said loudly.
            this.logger.error(
                `Writing the audit entry ${action} for booking ${due.subscriptionBundleId} failed.`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}

/** Whether the booking, or the subscription paying for it, has ended or ends by `at`. */
function endsBy(
    booking: SubscriptionBundleRecord,
    sub: SubscriptionUsageRecord,
    at: Date,
): boolean {
    return sub.status === 'CANCELED' || bookingOverBy(booking, cancellationLandsAt(sub), at);
}
