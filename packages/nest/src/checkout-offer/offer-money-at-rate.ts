// An offer is priced before the subscriber's origin is known, at the rate for
// a subscriber in the issuer's country; the contract it becomes is concluded at
// the rate decided for the subscriber who takes it. What changes between the
// two is the tax, and through it a promo code with a fixed amount: that amount
// comes off what the subscriber pays, so at 0 % it is the net discount and at
// 19 % its net share. Every net price, every promotion and the code itself stay
// as offered.

import { grossFromNet, sumToCents } from '@saasicat/core';
import type {
    CheckoutOfferPriceBreakdown,
    CheckoutOfferPromoCodeSnapshot,
    CheckoutOfferPromotionSnapshot,
} from '@saasicat/core';

import { promoCodeDiscountNet } from '../promo/calculator.js';

/** What an offer comes to after its promotions and its code: never below zero. */
export function effectiveNetOf(
    regularNet: number,
    promotionDiscountNet: number,
    promoCodeNet: number,
): number {
    return Math.max(0, sumToCents(regularNet, -promotionDiscountNet, -promoCodeNet));
}

/** The money of an offer, as it stands at one rate. */
export interface OfferMoney {
    priceBreakdown: CheckoutOfferPriceBreakdown;
    promoCodeSnapshot: CheckoutOfferPromoCodeSnapshot | null;
}

/** The parts of an offer its money is made of. */
export interface OfferMoneySource {
    planKey: string;
    priceBreakdown: CheckoutOfferPriceBreakdown;
    promotionSnapshots?: CheckoutOfferPromotionSnapshot[] | null;
    promoCodeSnapshot?: CheckoutOfferPromoCodeSnapshot | null;
}

/**
 * The offer's money restated at `rate`. At the rate it was offered at it is the
 * offer's own, unchanged; at another the promo code is resolved again on the
 * plan's net after its promotion, and the total and its gross follow.
 */
export function offerMoneyAtRate(offer: OfferMoneySource, rate: number): OfferMoney {
    const breakdown = offer.priceBreakdown;
    const code = offer.promoCodeSnapshot ?? null;
    if (rate === breakdown.vatRate) return { priceBreakdown: breakdown, promoCodeSnapshot: code };
    const promotions = offer.promotionSnapshots ?? [];
    const planPromotion = promotions.find((promotion) =>
        promotion.appliesTo.includes(offer.planKey),
    );
    const planNetAfterPromotion = sumToCents(
        breakdown.planNet,
        -(planPromotion?.resolvedAmountNet ?? 0),
    );
    const restated = code && {
        ...code,
        resolvedAmountNet: promoCodeDiscountNet(planNetAfterPromotion, rate, code),
    };
    const effectiveNet = effectiveNetOf(
        breakdown.regularNet,
        sumToCents(...promotions.map((promotion) => promotion.resolvedAmountNet)),
        restated?.resolvedAmountNet ?? 0,
    );
    return {
        priceBreakdown: {
            ...breakdown,
            vatRate: rate,
            effectiveNet,
            effectiveGross: grossFromNet(effectiveNet, rate),
        },
        promoCodeSnapshot: restated,
    };
}
