// The one reminder an add-on retirement sends (`SC-BUN-056`).
//
// A booking told that its add-on version is being retired is reminded once,
// 14 days before its date, where staying put costs it something: the
// replacement takes a feature or a quota away, or is dearer for the plan the
// add-on runs beside at the date in the rhythm the booking is billed in then —
// or is not sold in it. Both versions are priced from the catalogue as it
// stands for that plan, not as the notice said: a plan changed since the notice
// moves the price. The quarter-hourly run finds every booking whose reminder is
// due and that is still on the retired version, so a run that did not happen
// is caught up by the next — until the date, after which there is nothing to
// remind of.
//
// Not reminded: a booking that switched, which is no longer on the version;
// one that has declared a cancellation, whose end is declared and which
// cancelling again cannot move; one that or whose subscription ends by the
// date, which never moves; and one whose notice never reached the subscriber,
// which has no date to remind of. A booking whose subscription is cancelled to
// end after the date can still cancel itself without its minimum term, or
// switch, and is reminded. A reminder is a
// notice like the others: the application sends it to the tenant's
// administrators, and the record keeps to whom and how, once per booking.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    retirementCostsTheSubscription,
    retirementReminderIsDue,
    type BillingCycle,
    type BundleRepository,
    type BundleVersionRetiredNotice,
    type BundleVersionRetirementReminder,
    type RlsBypassPort,
    type SubscriptionBundleRecord,
    type SubscriptionBundleRepository,
    type SubscriptionNoticePort,
    type SubscriptionNoticeRepository,
    type SubscriptionUsagePort,
    type SubscriptionUsageRecord,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { bookingsOfVersion } from './bundle-bookings-of-version.js';
import { bookingOverBy, planAt } from './bundle-retirement-reach.js';
import { bundleRetirementSidesFor } from './bundle-retirement-sides.js';
import { BundleRetirementSwitchService } from './bundle-retirement-switch.service.js';
import { NOTICE_DELIVERY_TIMEOUT_MS, NoticeSender, type NoticeOutcome } from './notice-sender.js';
import type { PlansAhead } from './plans-ahead.js';
import { bundleRetirementNoticesTold, groupByRetiredBundleVersion } from './retirement-notices.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import {
    PLANS_AHEAD_TOKEN,
    SUBSCRIPTION_NOTICE_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
} from './tenant-billing.tokens.js';
import type { RetirementNoticeRun } from './version-retirement.service.js';
import { onceEach } from './versions-read-once.js';

const KIND = 'bundle-version-retirement-reminder';

@Injectable()
export class BundleRetirementReminderService {
    private readonly logger = new Logger(BundleRetirementReminderService.name);
    private readonly deliveryTimeoutMs = NOTICE_DELIVERY_TIMEOUT_MS;
    private readonly sender: NoticeSender;

    constructor(
        @Inject(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN)
        private readonly notices: SubscriptionNoticeRepository,
        @Inject(SUBSCRIPTION_NOTICE_PORT_TOKEN)
        port: SubscriptionNoticePort,
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository,
        @Inject(PLANS_AHEAD_TOKEN)
        private readonly plansAhead: PlansAhead,
        @Inject(BundleRetirementSwitchService)
        private readonly switches: BundleRetirementSwitchService,
        // The run is the installation's, not a tenant's.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {
        this.sender = new NoticeSender(notices, port);
    }

    /** Reminds every booking whose reminder is due at `now` and has not gone out. */
    async remindDue(now: Date): Promise<RetirementNoticeRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const due = (await bundleRetirementNoticesTold(this.notices)).filter((notice) =>
                retirementReminderIsDue(notice, now),
            );
            // Read once per run: a booking that costs nothing is judged again
            // by every run until the date, and its versions are its group's.
            const versions = onceEach(this.bundles);
            let told = 0;
            let failed = 0;
            for (const [retiredId, notices] of groupByRetiredBundleVersion(due)) {
                const reminded = new Set(
                    await this.notices.listDeliveredSubscriptionIds(KIND, retiredId),
                );
                // `listOfVersion` and `listByIds` are required where retiring is
                // on, and a notice exists only where it was. A booking that
                // switched is on the replacement, and not among them.
                const { bookings, owners } = await bookingsOfVersion(
                    this.bookings,
                    this.subscriptions,
                    retiredId,
                );
                for (const notice of notices) {
                    const booking = bookings.get(notice.subscriptionBundleId);
                    const sub = owners.get(notice.subscriptionId)?.subscription;
                    if (!booking || !sub || reminded.has(notice.subscriptionId)) continue;
                    if (!isToBeReminded(booking, sub, notice)) continue;
                    const outcome = await this.remind(notice, booking, sub, versions, now);
                    if (outcome === 'told') told += 1;
                    if (outcome === 'failed') failed += 1;
                }
            }
            return { told, failed };
        });
    }

    /**
     * Sends the booking its reminder where staying put costs it something. One
     * that cannot be put together fails for this booking alone, as one the
     * application could not send does, and the next run tries again.
     */
    private async remind(
        notice: BundleVersionRetiredNotice,
        booking: SubscriptionBundleRecord,
        sub: SubscriptionUsageRecord,
        versions: Pick<BundleRepository, 'findVersionById'>,
        now: Date,
    ): Promise<NoticeOutcome> {
        let reminder: BundleVersionRetirementReminder | null;
        try {
            reminder = await this.reminderOf(notice, booking, sub, versions, now);
        } catch (error) {
            this.logger.error(
                `The reminder for booking ${notice.subscriptionBundleId} of tenant ` +
                    `${notice.tenantId} could not be put together; the next run tries again.`,
                error instanceof Error ? error.stack : String(error),
            );
            return 'failed';
        }
        if (!reminder) return null;
        return this.sender.tell(reminder, notice.retired.bundleVersionId, this.deliveryTimeoutMs);
    }

    /**
     * The reminder for the booking, or null where staying put costs it nothing:
     * both versions priced for the plan the add-on runs beside at the date, in
     * the rhythm the booking is billed in then — its own, or else that plan's.
     */
    private async reminderOf(
        notice: BundleVersionRetiredNotice,
        booking: SubscriptionBundleRecord,
        sub: SubscriptionUsageRecord,
        versions: Pick<BundleRepository, 'findVersionById'>,
        now: Date,
    ): Promise<BundleVersionRetirementReminder | null> {
        const plan = planAt(sub, new Date(notice.effectiveAt), await this.plansAhead.of(sub));
        const billingCycle = (booking.billingCycle as BillingCycle | null) ?? plan.billingCycle;
        const [retired, replacement] = await Promise.all([
            versions.findVersionById(notice.retired.bundleVersionId),
            versions.findVersionById(notice.replacement.bundleVersionId),
        ]);
        const priced = {
            ...notice,
            ...bundleRetirementSidesFor(notice, plan.planKey, retired, replacement),
            billingCycle,
        };
        if (!retirementCostsTheSubscription(priced, billingCycle)) return null;
        return {
            ...priced,
            kind: KIND,
            switchTerms: await this.switches.openFor(sub, booking, now),
        };
    }
}

/**
 * Whether the reminder is the platform's to send. Not where the booking has
 * declared a cancellation: its end is declared, and cancelling again cannot
 * move it, so a reminder would ask it to act where it cannot. Not where the
 * subscription has ended or ends by the date, which the booking then never
 * reaches. A subscription cancelled to end after the date leaves the booking
 * free to cancel itself or switch until then, and it is reminded.
 */
function isToBeReminded(
    booking: SubscriptionBundleRecord,
    sub: SubscriptionUsageRecord,
    notice: BundleVersionRetiredNotice,
): boolean {
    if (sub.status === 'CANCELED' || cancellationLandsAt(booking) !== null) return false;
    return !bookingOverBy(booking, cancellationLandsAt(sub), new Date(notice.effectiveAt));
}
