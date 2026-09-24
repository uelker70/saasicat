// An installation that sells a plan with a promo code, and checks out offers
// for it: the real checkout offer service and promo service over the in-memory
// stores of `promo-slots.js`, with the helpers an application's own code would
// be — concluding an offer and redeeming its code in the same step, or
// redeeming a code outside any checkout.

import { SubscriberService } from '../../dist/subscriber/index.js';
import { SubscriptionContractService } from '../../dist/subscription-contract/index.js';

import { CATALOG, buildOfferService, fakeOfferRepo } from './checkout-catalogue.js';
import { fakeContractRepo, fakeSubscriberRepo } from './conclusion.js';
import {
    MemoryPromoCodes,
    MemoryRedemptions,
    MemorySubscriptions,
    PROMO_CATALOG,
    promoCodesOver,
} from './promo-slots.js';
import { RollbackRunner } from './payments.js';

/** The plan the offers are priced for, at the price the offer catalogue sells it. */
export const OFFER_PLANS = {
    ...PROMO_CATALOG,
    plans: [{ ...PROMO_CATALOG.plans[1], monthlyNet: 49, yearlyNet: 490 }],
};

const CUSTOMERS = ['tenant-anna', 'tenant-ben', 'tenant-cleo'];

/**
 * An installation selling STANDARD with the code `LAST-SLOT` (ten per cent,
 * `code` overriding it), and an offer service able to hold and conclude.
 */
export function installation({ code = {}, holds = true } = {}) {
    const codes = new MemoryPromoCodes();
    const promo = codes.add({ code: 'LAST-SLOT', maxRedemptions: 1, ...code });
    const redemptions = new MemoryRedemptions();
    const subscriptions = new MemorySubscriptions();
    const offers = fakeOfferRepo();
    const contractRepo = fakeContractRepo();
    const subscriberRepo = fakeSubscriberRepo(CUSTOMERS);
    const transactions = new RollbackRunner([
        codes,
        redemptions,
        offers,
        contractRepo,
        subscriberRepo,
    ]);
    const { service: promoCodes } = promoCodesOver({
        codes,
        redemptions,
        subscriptions,
        transactions,
        catalog: OFFER_PLANS,
        holds,
    });
    const subscribers = new SubscriberService(subscriberRepo, CATALOG);
    const { service } = buildOfferService({
        repo: offers,
        promoCodes,
        contracts: new SubscriptionContractService(contractRepo, subscribers),
        transactions,
        subscribers,
    });
    const counts = async () => {
        const row = await codes.findById(promo.id);
        return { held: row.heldCount, redeemed: row.redemptionsCount, status: row.status };
    };
    const offerWithCode = () =>
        service.create({ planKey: 'STANDARD', billingCycle: 'monthly', promoCode: 'LAST-SLOT' });
    return {
        service,
        promoCodes,
        codes,
        promo,
        redemptions,
        subscriptions,
        counts,
        offerWithCode,
        /** What a transaction that fails has to put back. */
        stores: [codes, redemptions, offers, contractRepo, subscriberRepo],
    };
}

/**
 * Concludes the offer for `tenantId` the way an application does: its own
 * subscription is started in `within`, and the offer's code redeemed there.
 * `conclusion` adds to what `conclude` is given — a sign-up's subscriber and
 * the transaction of its activation.
 */
export async function concludeFor(
    ctx,
    offerId,
    tenantId,
    { redeem = true, thenFail = false, conclusion = {}, email } = {},
) {
    const subscriptionId = `subscription-of-${tenantId}`;
    const concluded = await ctx.service.conclude(
        offerId,
        { tenantId, effectiveFrom: new Date(), ...conclusion },
        async (tx, { offer }) => {
            ctx.subscriptions.add({ id: subscriptionId, tenantId });
            if (redeem && offer.promoCode) {
                await ctx.promoCodes.redeemInTransaction(
                    { code: offer.promoCode, subscriptionId, tenantId, email },
                    tx,
                );
            }
            if (thenFail) throw new Error('the application could not start its subscription');
        },
    );
    return { ...concluded, subscriptionId };
}

/** A redemption outside any checkout — the tenant onboarding route redeems this way. */
export function redeemDirectly(ctx, tenantId) {
    const subscriptionId = `subscription-of-${tenantId}`;
    ctx.subscriptions.add({ id: subscriptionId, tenantId });
    return ctx.promoCodes.redeem({ code: 'LAST-SLOT', subscriptionId, tenantId });
}
