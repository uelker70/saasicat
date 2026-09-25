import type {
    CheckoutOfferLineItem,
    CheckoutOfferPriceBreakdown,
    CheckoutOfferPromoCodeSnapshot,
    CheckoutOfferPromotionSnapshot,
} from '@saasicat/core';

import { grossSharesOf } from '../subscription-contract/contract-line-item-money.js';

type LineWithoutGross = Omit<CheckoutOfferLineItem, 'priceGross'>;

export interface AppendImplicitDiscountLineItemInput {
    billingCycle: 'monthly' | 'yearly';
    priceBreakdown: CheckoutOfferPriceBreakdown;
    lineItems: readonly CheckoutOfferLineItem[];
    promotionSnapshots?: readonly CheckoutOfferPromotionSnapshot[];
    promoCodeSnapshot?: CheckoutOfferPromoCodeSnapshot | null;
}

/**
 * The lines an offer is concluded with: its own lines, the discount its
 * breakdown implies as a line of its own, and every line's gross as its share of
 * the tax on the total — so the lines add up to `effectiveNet` and
 * `effectiveGross` to the cent.
 */
export function appendImplicitDiscountLineItem(
    input: AppendImplicitDiscountLineItemInput,
): CheckoutOfferLineItem[] {
    return withGrossShares(linesWithDiscount(input), input.priceBreakdown.vatRate);
}

function linesWithDiscount(input: AppendImplicitDiscountLineItemInput): LineWithoutGross[] {
    const lineItems = input.lineItems.map((item) => cloneCheckoutOfferLineItem(item));
    const discountNet = roundMoney(
        input.priceBreakdown.regularNet - input.priceBreakdown.effectiveNet,
    );
    if (lineItems.some((item) => item.kind === 'discount' && !isGeneratedDiscount(item))) {
        return lineItems;
    }

    const lineItemsWithoutGeneratedDiscount = lineItems.filter(
        (item) => !isGeneratedDiscount(item),
    );
    if (discountNet <= 0) {
        return lineItemsWithoutGeneratedDiscount;
    }

    return [...lineItemsWithoutGeneratedDiscount, generatedDiscountLine(input, discountNet)];
}

export function cloneCheckoutOfferLineItem(item: CheckoutOfferLineItem): CheckoutOfferLineItem {
    return {
        ...item,
        featuresSnapshot: [...(item.featuresSnapshot ?? [])],
        quotaEffectsSnapshot: { ...(item.quotaEffectsSnapshot ?? {}) },
        metadata: cloneRecord(item.metadata),
    };
}

function withGrossShares(lines: LineWithoutGross[], vatRate: number): CheckoutOfferLineItem[] {
    const shares = grossSharesOf(lines, vatRate);
    return lines.map((line, index) => {
        const priceGross = shares[index] as number;
        if (!isGeneratedDiscount(line)) return { ...line, priceGross };
        return { ...line, priceGross, metadata: { ...line.metadata, discountGross: -priceGross } };
    });
}

/**
 * The discount line a promo code or a promotion becomes, marked as generated
 * and carrying the snapshots it was built from — which say how long the
 * discount runs. One form, whether an offer or a contract freeze writes it.
 */
export function generatedDiscountLine(
    input: Pick<
        AppendImplicitDiscountLineItemInput,
        'billingCycle' | 'promotionSnapshots' | 'promoCodeSnapshot'
    >,
    discountNet: number,
): Omit<CheckoutOfferLineItem, 'priceGross'> {
    const promoCode = input.promoCodeSnapshot ?? null;
    const firstPromotion = input.promotionSnapshots?.[0] ?? null;

    return {
        kind: 'discount',
        sourceKey: promoCode?.code ?? firstPromotion?.id ?? 'price-discount',
        sourceVersionId: null,
        titleSnapshot: promoCode?.label ?? firstPromotion?.label ?? 'Discount',
        descriptionSnapshot: promoCode ? `Promo-Code ${promoCode.code}` : null,
        quantity: 1,
        unit: null,
        priceNet: -discountNet,
        billingCycle: input.billingCycle,
        featuresSnapshot: [],
        quotaEffectsSnapshot: {},
        metadata: {
            generated: true,
            source: promoCode ? 'promo_code' : firstPromotion ? 'promotion' : 'price_breakdown',
            discountNet,
            promotionSnapshots: cloneArray(input.promotionSnapshots ?? []),
            promoCodeSnapshot: cloneJsonValue(promoCode),
        },
    };
}

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isGeneratedDiscount(item: LineWithoutGross): boolean {
    return item.kind === 'discount' && item.metadata?.generated === true;
}

function cloneRecord(
    value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
    if (!value) return null;
    return cloneJsonValue(value);
}

function cloneArray<T>(value: readonly T[]): T[] {
    return cloneJsonValue(value as T[]);
}

function cloneJsonValue<T>(value: T): T {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}
