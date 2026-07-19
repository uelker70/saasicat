import type {
    CheckoutOfferLineItem,
    CheckoutOfferPriceBreakdown,
    CheckoutOfferPromoCodeSnapshot,
    CheckoutOfferPromotionSnapshot,
} from '@saasicat/types';

export interface AppendImplicitDiscountLineItemInput {
    billingCycle: 'monthly' | 'yearly';
    priceBreakdown: CheckoutOfferPriceBreakdown;
    lineItems: readonly CheckoutOfferLineItem[];
    promotionSnapshots?: readonly CheckoutOfferPromotionSnapshot[];
    promoCodeSnapshot?: CheckoutOfferPromoCodeSnapshot | null;
}

export function appendImplicitDiscountLineItem(
    input: AppendImplicitDiscountLineItemInput,
): CheckoutOfferLineItem[] {
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

    return [...lineItemsWithoutGeneratedDiscount, createDiscountLineItem(input, discountNet)];
}

export function cloneCheckoutOfferLineItem(item: CheckoutOfferLineItem): CheckoutOfferLineItem {
    return {
        ...item,
        featuresSnapshot: [...(item.featuresSnapshot ?? [])],
        quotaEffectsSnapshot: { ...(item.quotaEffectsSnapshot ?? {}) },
        metadata: cloneRecord(item.metadata),
    };
}

function createDiscountLineItem(
    input: AppendImplicitDiscountLineItemInput,
    discountNet: number,
): CheckoutOfferLineItem {
    const promoCode = input.promoCodeSnapshot ?? null;
    const firstPromotion = input.promotionSnapshots?.[0] ?? null;
    const discountGross = roundMoney(discountNet * (1 + input.priceBreakdown.vatRate));

    return {
        kind: 'discount',
        sourceKey: promoCode?.code ?? firstPromotion?.id ?? 'price-discount',
        sourceVersionId: null,
        titleSnapshot: promoCode?.label ?? firstPromotion?.label ?? 'Rabatt',
        descriptionSnapshot: promoCode ? `Promo-Code ${promoCode.code}` : null,
        quantity: 1,
        unit: null,
        priceNet: -discountNet,
        priceGross: -discountGross,
        billingCycle: input.billingCycle,
        featuresSnapshot: [],
        quotaEffectsSnapshot: {},
        metadata: {
            generated: true,
            source: promoCode ? 'promo_code' : firstPromotion ? 'promotion' : 'price_breakdown',
            discountNet,
            discountGross,
            promotionSnapshots: cloneArray(input.promotionSnapshots ?? []),
            promoCodeSnapshot: cloneJsonValue(promoCode),
        },
    };
}

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isGeneratedDiscount(item: CheckoutOfferLineItem): boolean {
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
