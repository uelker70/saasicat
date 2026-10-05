// A newer version of an add-on a booking is on, read as an offer to that
// booking (`SC-BUN-057`).
//
// A booking keeps the version it was made on; a version of the add-on
// published since is offered beside it, never applied. What kind of offer it is
// decides how it can be taken, and it is judged against the version the
// booking is on, at the add-on's prices for the plan the subscription is on, in
// the rhythm the booking is billed in: a price the booking does not pay is not
// one it is offered more or less of. Taking it is `BundleVersionSwitchService`'s;
// this reads what it would be.
//
// The version offered is the one a booking made now would take — on sale by
// its window, as the store sells it — and only where it is newer than the
// version booked. An offer is made only where it could be taken: not on a
// subscription or a booking that has ended, nor on one with a switch already
// scheduled; not while the plan the add-on runs beside or its rhythm is set to
// change, since the price and the fit are that plan's; not where the version
// cannot run beside the plan in the booking's rhythm; not for an add-on kept
// for special contracts; and not where the booking could not be moved at all.
// Beside a retirement told for the version booked, the replacement is the
// early switch's to offer and one that takes something away waits for the move
// (`leftToTheRetirement`); a newer version that applies at once stands beside
// the notice.
//
// One that takes something away waits for the end of the booking's running
// term: the later of the end of the period it is in and its minimum term,
// never after the subscription ends. It is offered only where it would happen —
// the booking and the subscription still run then, the version is still sold
// then, and something here makes the switch at that moment.

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
    classifyVersionOffer,
    type BillingCycle,
    type BundleRepository,
    type BundleRow,
    type BundleVersionOfferView,
    type BundleVersionRow,
    type SubscriptionBundleRecord,
    type SubscriptionBundleRepository,
    type SubscriptionUsageRecord,
} from '@saasicat/core';

import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { cancellationHasLanded, cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { addOnMisfits, type AddOnsAhead, type PlanBeside } from './add-on-fits-plan.js';
import { bookingOverBy, bookingPeriodEndOf } from './bundle-retirement-reach.js';
import { bundleVersionNotOnSale } from './bundle-version-not-on-sale.js';
import { bundleVersionSide, comparedFieldsOfSide } from './bundle-version-sides.js';
import { BundleVersionSwitchRunService } from './bundle-version-switch-run.service.js';
import { leftToTheRetirement } from './offer-beside-a-retirement.js';
import type { PlansAhead } from './plans-ahead.js';
import {
    SELF_SERVICE_BLOCKED_BUNDLES_TOKEN,
    type SelfServiceBlockedBundles,
} from './self-service-policy.js';
import { resolveBundleCancelEffectiveAt } from './subscription-bundles.service.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import { ADD_ONS_AHEAD_TOKEN, PLANS_AHEAD_TOKEN } from './tenant-billing.tokens.js';

@Injectable()
export class BundleVersionOfferService {
    private readonly logger = new Logger(BundleVersionOfferService.name);

    constructor(
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository,
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository,
        @Inject(PLANS_AHEAD_TOKEN)
        private readonly plansAhead: PlansAhead,
        @Optional()
        @Inject(SELF_SERVICE_BLOCKED_BUNDLES_TOKEN)
        private readonly blockedBundles: SelfServiceBlockedBundles | null = null,
        // Present where the quarter-hourly run is: without it, nothing would
        // make a switch scheduled for the end of a term, so none is offered.
        @Optional()
        @Inject(BundleVersionSwitchRunService)
        private readonly scheduledSwitches: BundleVersionSwitchRunService | null = null,
        // Present where add-on versions are retired; without it no retirement
        // is told, and none has a way of its own to leave an offer to.
        @Optional()
        @Inject(ADD_ONS_AHEAD_TOKEN)
        private readonly addOnsAhead: AddOnsAhead | null = null,
    ) {}

    /** The offer beside `booking`, or null where there is none it could take. */
    async offerFor(
        sub: SubscriptionUsageRecord,
        booking: SubscriptionBundleRecord,
        now: Date,
    ): Promise<BundleVersionOfferView | null> {
        if (!this.couldSwitch(sub, booking, now) || (await this.planChangesAhead(sub))) {
            return null;
        }
        const read = await this.readVersions(booking, now);
        if (!read) return null;
        const { bound, offered, bundle } = read;

        const plan: PlanBeside = {
            planKey: sub.plan,
            billingCycle: sub.billingCycle as BillingCycle,
        };
        const rhythm = (booking.billingCycle as BillingCycle | null) ?? plan.billingCycle;
        if (addOnMisfits(offered, plan, rhythm).length > 0) return null;

        const boundSide = bundleVersionSide(bound, plan.planKey);
        const offeredSide = bundleVersionSide(offered, plan.planKey);
        const verdict = classifyVersionOffer(
            comparedFieldsOfSide(boundSide, rhythm),
            comparedFieldsOfSide(offeredSide, rhythm),
        );
        if (verdict.class === 'same') return null;
        const told = (await this.addOnsAhead?.of(booking.subscriptionId)) ?? [];
        const replacementsTold = told
            .filter(
                (one) =>
                    one.subscriptionBundleId === booking.id &&
                    one.retiredBundleVersionId === booking.bundleVersionId,
            )
            .map((one) => one.replacementBundleVersionId);
        if (leftToTheRetirement({ versionId: offered.id, kind: verdict.class }, replacementsTold)) {
            return null;
        }

        const takesEffectAt =
            verdict.class === 'takes-something-away'
                ? this.scheduledFor(sub, booking, offered, bundle, now)
                : now;
        if (!takesEffectAt) return null;

        return {
            subscriptionBundleId: booking.id,
            planKey: plan.planKey,
            billingCycle: rhythm,
            bound: boundSide,
            offered: offeredSide,
            class: verdict.class,
            changes: [...verdict.changes],
            takesEffectAt: takesEffectAt.toISOString(),
        };
    }

    /**
     * Whether the booking could change its version at all: it and its
     * subscription still run, no switch is scheduled for it, and the store can
     * move it.
     */
    private couldSwitch(
        sub: SubscriptionUsageRecord,
        booking: SubscriptionBundleRecord,
        now: Date,
    ): boolean {
        return (
            booking.subscriptionId === sub.id &&
            !cancellationHasLanded(sub, now) &&
            !cancellationHasLanded(booking, now) &&
            !booking.pendingBundleVersionId &&
            Boolean(this.bookings.moveToVersion)
        );
    }

    /**
     * Whether the plan the add-on runs beside, or its rhythm, is set to change:
     * by a change scheduled, or by a retirement told that moves the
     * subscription to another plan. A newer version of the same plan in the
     * same rhythm changes neither.
     */
    private async planChangesAhead(sub: SubscriptionUsageRecord): Promise<boolean> {
        const ahead = await this.plansAhead.of(sub);
        return ahead.some(
            (plan) => plan.planKey !== sub.plan || plan.billingCycle !== sub.billingCycle,
        );
    }

    /**
     * The version booked, the one on sale now and the add-on they belong to;
     * null where nothing newer is on sale, or the add-on is kept for special
     * contracts. A booked version the catalogue cannot read is logged: a
     * booked version cannot be deleted.
     */
    private async readVersions(
        booking: SubscriptionBundleRecord,
        now: Date,
    ): Promise<{ bound: BundleVersionRow; offered: BundleVersionRow; bundle: BundleRow } | null> {
        const bound = await this.bundles.findVersionById(booking.bundleVersionId);
        if (!bound) {
            this.logger.warn(
                `Booking ${booking.id} is on add-on version ${booking.bundleVersionId}, which ` +
                    'the catalogue does not read. No newer version is offered to it.',
            );
            return null;
        }
        if (this.blockedBundles?.bundleKeys?.includes(bound.bundleKey)) return null;
        const [offered, bundle] = await Promise.all([
            this.bundles.findActiveBundleVersion(bound.bundleId, now),
            this.bundles.findById(bound.bundleId),
        ]);
        if (!offered || !bundle || offered.bundleId !== bound.bundleId) return null;
        if (offered.version <= bound.version) return null;
        // The repository answers by window already; this holds a repository
        // of the application's own to the same rule, and to the add-on's own
        // deletion, which no window says.
        if (bundleVersionNotOnSale(offered, bundle, now)) return null;
        return { bound, offered, bundle };
    }

    /**
     * When a switch that takes something away would take effect — the end of
     * the booking's running term — or null where it would not happen: the
     * booking or the subscription ends by then, the version is no longer sold
     * then, or nothing could schedule it.
     */
    private scheduledFor(
        sub: SubscriptionUsageRecord,
        booking: SubscriptionBundleRecord,
        offered: BundleVersionRow,
        bundle: BundleRow,
        now: Date,
    ): Date | null {
        if (!this.scheduledSwitches?.canRun()) return null;
        const at = bookingTermEndOf(booking, sub, now);
        if (!at || bookingOverBy(booking, cancellationLandsAt(sub), at)) return null;
        return bundleVersionNotOnSale(offered, bundle, at) ? null : at;
    }
}

/**
 * The end of the booking's running term at `now`: the later of the end of the
 * period it is in and its minimum term, never after the subscription ends —
 * the moment a cancellation declared now would take effect. Null where the
 * booking carries no period an end can be counted from.
 */
export function bookingTermEndOf(
    booking: SubscriptionBundleRecord,
    sub: SubscriptionUsageRecord,
    now: Date,
): Date | null {
    const periodEnd = bookingPeriodEndOf(booking, sub, now);
    if (!periodEnd) return null;
    return resolveBundleCancelEffectiveAt({
        canceledAt: now,
        currentPeriodEnd: periodEnd,
        minimumTermEndsAt: booking.minimumTermEndsAt,
        parentEndsAt: cancellationLandsAt(sub),
    });
}
