// CheckoutOffer — immutable package snapshot from the website through to the
// subscription (METAMODELL §17a).
//
// On a package click on the pricing page a CheckoutOffer is created; its
// `id` travels as `?offer=<id>` into onboarding. There the tenant may
// customize the package (bundles/quotas) — the delta is written into
// the same offer. When the subscription is created the final offer is
// frozen as `packageSnapshot`.

export type CheckoutOfferLineItemKind = 'plan' | 'bundle' | 'discount';

/** Frozen billable line item in the offer. */
export interface CheckoutOfferLineItem {
    kind: CheckoutOfferLineItemKind;
    sourceKey: string;
    sourceVersionId?: string | null;
    titleSnapshot: string;
    descriptionSnapshot?: string | null;
    quantity: number;
    unit?: string | null;
    priceNet: number;
    priceGross: number;
    billingCycle: 'monthly' | 'yearly';
    minimumTermUntil?: string | Date | null;
    featuresSnapshot?: string[];
    quotaEffectsSnapshot?: Record<string, number>;
    metadata?: Record<string, unknown> | null;
}

/** Frozen applied catalog promotion. */
export interface CheckoutOfferPromotionSnapshot {
    id: string | null;
    type: string;
    value: unknown;
    label: string;
    resolvedAmountNet: number;
    appliesTo: string[];
    billingCycle: 'monthly' | 'yearly' | 'both';
}

/** Frozen promo-code preview before contract conclusion. */
export interface CheckoutOfferPromoCodeSnapshot {
    code: string;
    label: string;
    valueType: string;
    value: number;
    resolvedAmountNet: number;
    durationType?: string | null;
    durationValue?: number | null;
}

/** Structured price breakdown — frozen at offer time. */
export interface CheckoutOfferPriceBreakdown {
    currency: string;
    billingCycle: 'monthly' | 'yearly';
    /** Net base price of the plan. */
    planNet: number;
    /** Net surcharge from bundles. */
    bundlesNet: number;
    /** Net total before promo. */
    regularNet: number;
    /** Net total after promo. */
    effectiveNet: number;
    vatRate: number;
    /** Gross total after promo. */
    effectiveGross: number;
}

export type CheckoutOfferStatus = 'open' | 'consumed' | 'expired';

/** Wire format of a `checkout_offers` row. */
export interface CheckoutOfferRow {
    id: string;
    projectKey: string;

    /** Plan selected on the website. */
    planKey: string;
    /** Resolved plan version, if known. */
    planVersionId: string | null;
    billingCycle: 'monthly' | 'yearly';

    /** Applied promotion (active at offer time). */
    promotionId: string | null;
    /** Redeemed promo code, if the promotion was `requiresCoupon`. */
    promoCode: string | null;

    /** Added bundle keys. Legacy display; V3 uses `bundleVersionIds` + `lineItems`. */
    bundles: string[];
    /** Concrete BundleVersion IDs that the offer binds. */
    bundleVersionIds?: string[];

    priceBreakdown: CheckoutOfferPriceBreakdown;
    /** V3 contract line items, already resolved at offer time. */
    lineItems?: CheckoutOfferLineItem[];
    /** Active automatic promotions as snapshot. */
    promotionSnapshots?: CheckoutOfferPromotionSnapshot[];
    /** Redeemed promo code as snapshot. */
    promoCodeSnapshot?: CheckoutOfferPromoCodeSnapshot | null;
    locale: string;
    /** Temporal validity of the offer; null = repository/consumer policy. */
    validUntil?: string | null;

    status: CheckoutOfferStatus;
    /** Set as soon as a subscription has arisen from the offer. */
    consumedAt: string | null;

    createdAt: string;
    updatedAt: string;
}

export interface CheckoutOfferFilter {
    projectKey: string;
    status?: CheckoutOfferStatus;
}

/** Body of `POST /public/checkout-offer` — called from the website. */
export interface CreateCheckoutOfferData {
    projectKey: string;
    planKey: string;
    planVersionId?: string | null;
    billingCycle: 'monthly' | 'yearly';
    promotionId?: string | null;
    promoCode?: string | null;
    bundles?: string[];
    bundleVersionIds?: string[];
    priceBreakdown: CheckoutOfferPriceBreakdown;
    lineItems?: CheckoutOfferLineItem[];
    promotionSnapshots?: CheckoutOfferPromotionSnapshot[];
    promoCodeSnapshot?: CheckoutOfferPromoCodeSnapshot | null;
    locale?: string;
    validUntil?: string | null;
}

/**
 * Body of `PATCH /public/checkout-offer/:id` — customization during
 * onboarding. `status`/`consumedAt` are not editable — `consume()`
 * sets them server-side.
 */
export interface UpdateCheckoutOfferData {
    billingCycle?: 'monthly' | 'yearly';
    promotionId?: string | null;
    promoCode?: string | null;
    bundles?: string[];
    bundleVersionIds?: string[];
    priceBreakdown?: CheckoutOfferPriceBreakdown;
    lineItems?: CheckoutOfferLineItem[];
    promotionSnapshots?: CheckoutOfferPromotionSnapshot[];
    promoCodeSnapshot?: CheckoutOfferPromoCodeSnapshot | null;
    locale?: string;
    validUntil?: string | null;
}
