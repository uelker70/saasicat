// Taking an add-on offer: the switch of a booking to a newer version of its
// add-on (`SC-BUN-058`).
//
// The offer decides and this carries it out. The offer is read again here
// rather than taken from the page: the caller names the version it was shown,
// and the switch goes ahead only while that is still the version offered — a
// version published, ended or taken in between, or a booking that moved, is
// refused with the offer as it now stands. The write is conditional on the
// version the booking is on, so a change landing between the read and the
// write is refused rather than written over.
//
// What kind of offer it is decides how it is taken. An improvement and one that
// costs more for more apply at once and keep the booking — its period, its
// terms, its rhythm and its minimum term. What that costs is the charge
// journal's to say: the contract the switch writes marks the booking's new
// line, and where it is dearer than the line before, the journal charges the
// difference for the rest of the booking's period, and nothing where it is not
// (`SC-PRIC-003`). The switch and that contract are one: where the contract
// cannot be written, or the subscription moved meanwhile, the booking goes back
// and the switch is refused. A trial commits to no period: there the booking
// moves, and its contract is frozen when the trial converts.
//
// One that takes something away is scheduled for the end of the booking's
// running term, and the quarter-hourly run makes it then
// (`BundleVersionSwitchRunService`). Nothing is checked against today's usage:
// cancelling the add-on is not either, and a switch takes away less than that.

import {
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import {
    BILLING_ERROR_CODES,
    type BillingCycle,
    type BundleVersionOfferView,
    type BundleVersionSwitchResult,
    type SubscriptionBundleRecord,
    type SubscriptionBundleRepository,
    type SubscriptionUsagePort,
    type SubscriptionUsageRecord,
} from '@saasicat/core';

import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { decidedAlike, putBookingBack, subscriptionChanged } from './booking-move-guards.js';
import { BundleVersionOfferService } from './bundle-version-offer.service.js';
import { recordChargesAfter } from './charges/record-charges-after.js';
import { SubscriberChargeService } from './charges/subscriber-charge.service.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import { contractUnlessTrialOf, intendedContractOf } from './freeze-contract-after.js';
import { subscriptionNotFound } from './subscription-not-found.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import { SUBSCRIPTION_USAGE_PORT_TOKEN } from './tenant-billing.tokens.js';

@Injectable()
export class BundleVersionSwitchService {
    private readonly logger = new Logger(BundleVersionSwitchService.name);

    constructor(
        @Inject(BundleVersionOfferService) private readonly offers: BundleVersionOfferService,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository,
        @Inject(ENTITLEMENT_SERVICE_TOKEN) private readonly entitlements: EntitlementService,
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
        @Optional()
        @Inject(SubscriberChargeService)
        private readonly charges: SubscriberChargeService | null = null,
    ) {}

    /**
     * Takes the offer of `bundleVersionId` beside the booking
     * `subscriptionBundleId`, provided it is still the one offered.
     */
    async take(
        tenantId: string,
        subscriptionBundleId: string,
        bundleVersionId: string,
        now = new Date(),
    ): Promise<BundleVersionSwitchResult> {
        const sub = await this.subscriptions.findForTenant(tenantId);
        if (!sub?.id) throw subscriptionNotFound(tenantId);
        const booking = await this.ownBooking(sub, subscriptionBundleId);
        const offer = await this.offers.offerFor(sub, booking, now);
        if (offer?.offered.bundleVersionId !== bundleVersionId) {
            throw offerChanged(bundleVersionId, offer);
        }
        return offer.class === 'takes-something-away'
            ? this.schedule(tenantId, sub, booking, offer, now)
            : this.switchNow(tenantId, sub, booking, offer, now);
    }

    private async switchNow(
        tenantId: string,
        sub: SubscriptionUsageRecord,
        booking: SubscriptionBundleRecord,
        offer: BundleVersionOfferView,
        now: Date,
    ): Promise<BundleVersionSwitchResult> {
        // Where contracts are frozen, the switch ends in one naming the
        // tenant's subscriber: refused here, while nothing has moved.
        await this.contractFreeze?.assertPartyFor(tenantId, contractUnlessTrialOf(sub, now));
        const from = offer.bound.bundleVersionId;
        const to = offer.offered.bundleVersionId;
        // `offerFor` offers nothing where the store cannot move a booking.
        const moved = await this.bookings.moveToVersion!(booking.id, from, to);
        if (!moved) throw await this.refusedAfterTheRead(tenantId, booking.id, to, now);
        this.entitlements.invalidateTenant(tenantId);
        if (sub.status === 'TRIAL') return resultOf(offer, true, now);
        try {
            // Decided on the subscription read before the claim: a cancellation
            // declared or a change scheduled in between would leave the
            // contract an end, or the add-on a price, the subscription no
            // longer has. Read again, and refused where it changed.
            const reread = await this.subscriptions.findForTenant(tenantId);
            if (!reread || !decidedAlike(sub, reread)) throw subscriptionChanged();
            await this.contractFreeze?.freezeOnPlanChange(
                tenantId,
                sub.planVersion.planId,
                sub.billingCycle as BillingCycle,
                now,
                cancellationLandsAt(sub),
                {
                    addOnSwitch: {
                        subscriptionBundleId: booking.id,
                        fromBundleVersionId: from,
                        bundleVersionId: to,
                        effectiveAt: now,
                    },
                },
            );
        } catch (error) {
            // Without its contract the booking would run on the new version
            // under a contract naming the old one, and nothing would charge
            // it: put back, and refused as it came.
            await putBookingBack(this.bookings, this.entitlements, this.logger, {
                tenantId,
                subscriptionBundleId: booking.id,
                from,
                to,
            });
            throw error;
        }
        await recordChargesAfter(this.charges, tenantId, 'an add-on version switch', this.logger);
        return resultOf(offer, true, now);
    }

    private async schedule(
        tenantId: string,
        sub: SubscriptionUsageRecord,
        booking: SubscriptionBundleRecord,
        offer: BundleVersionOfferView,
        now: Date,
    ): Promise<BundleVersionSwitchResult> {
        const takesEffectAt = new Date(offer.takesEffectAt);
        // The switch ends in a contract from its moment: its party is asked
        // now, while nothing is scheduled, rather than by the run at the date.
        await this.contractFreeze?.assertPartyFor(tenantId, intendedContractOf(sub, takesEffectAt));
        // `offerFor` offers no switch for the end of the term where the store
        // cannot schedule one.
        const scheduled = await this.bookings.scheduleVersion!(booking.id, {
            from: offer.bound.bundleVersionId,
            to: offer.offered.bundleVersionId,
            effectiveAt: takesEffectAt,
        });
        if (!scheduled) {
            throw await this.refusedAfterTheRead(
                tenantId,
                booking.id,
                offer.offered.bundleVersionId,
                now,
            );
        }
        return resultOf(offer, false, takesEffectAt);
    }

    /**
     * The booking `subscriptionBundleId` of the subscription. A booking of
     * another subscription reads as not found, as a missing one does, so a
     * request learns nothing about bookings not its own.
     */
    private async ownBooking(
        sub: SubscriptionUsageRecord,
        subscriptionBundleId: string,
    ): Promise<SubscriptionBundleRecord> {
        const booking = await this.bookings.findById(subscriptionBundleId);
        if (!booking || booking.subscriptionId !== sub.id) {
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_NOT_FOUND,
                message: `SubscriptionBundle '${subscriptionBundleId}' not found`,
                params: { subscriptionBundleId },
            });
        }
        return booking;
    }

    /**
     * Why a write claimed nothing, as far as can be told afterwards: where the
     * version named is no longer the one offered, that is the answer, with the
     * offer as it now stands; otherwise the booking moved.
     */
    private async refusedAfterTheRead(
        tenantId: string,
        subscriptionBundleId: string,
        named: string,
        now: Date,
    ): Promise<ConflictException> {
        const sub = await this.subscriptions.findForTenant(tenantId);
        const booking = sub ? await this.bookings.findById(subscriptionBundleId) : null;
        const offer = sub && booking ? await this.offers.offerFor(sub, booking, now) : null;
        return offer?.offered.bundleVersionId === named
            ? subscriptionChanged()
            : offerChanged(named, offer);
    }
}

function resultOf(
    offer: BundleVersionOfferView,
    immediate: boolean,
    takesEffectAt: Date,
): BundleVersionSwitchResult {
    return {
        class: offer.class,
        subscriptionBundleId: offer.subscriptionBundleId,
        fromBundleVersionId: offer.bound.bundleVersionId,
        bundleVersionId: offer.offered.bundleVersionId,
        immediate,
        takesEffectAt: takesEffectAt.toISOString(),
    };
}

function offerChanged(
    bundleVersionId: string,
    offer: BundleVersionOfferView | null,
): ConflictException {
    return new ConflictException({
        code: BILLING_ERROR_CODES.BUNDLE_VERSION_OFFER_CHANGED,
        message: 'The offer changed since it was shown. Look at the current one before switching.',
        params: { bundleVersionId },
        offer,
    });
}
