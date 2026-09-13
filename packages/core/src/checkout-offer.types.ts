// CheckoutOffer — immutable package snapshot from the website through to the
// subscription.
//
// On a package click on the pricing page a CheckoutOffer is created; its
// `id` travels as `?offer=<id>` into onboarding. There the tenant may
// customize the package (bundles, a promo code) — the change is written into
// the same offer. When the subscription is created the final offer is
// frozen as `packageSnapshot`.
//
// A caller chooses and the server prices: `CheckoutOfferSelection` is all the
// public routes accept, and every amount on the stored row comes from the
// catalogue.

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
    /** VAT rate in percent, as the plan catalogue names it (19 = 19 %). */
    vatRate: number;
    /** Gross total after promo. */
    effectiveGross: number;
}

export type CheckoutOfferStatus = 'open' | 'consumed' | 'expired';

/** Wire format of a `checkout_offers` row. */
export interface CheckoutOfferRow {
    id: string;

    /** Plan selected on the website. */
    planKey: string;
    /** Resolved plan version, if known. */
    planVersionId: string | null;
    billingCycle: 'monthly' | 'yearly';

    /** Applied promotion (active at offer time). */
    promotionId: string | null;
    /** Promo code applied to the offer, as the promo module normalised it. */
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
    status?: CheckoutOfferStatus;
}

/**
 * What a caller chooses: the body of `POST /public/checkout-offer`, and the
 * input of `CheckoutOfferService.create`.
 *
 * No amount is part of it. The plan version, the bundle prices, the promotion
 * and the promo code discount are resolved on the server, so the offer costs
 * what the catalogue says rather than what a request says.
 */
export interface CheckoutOfferSelection {
    planKey: string;
    billingCycle: 'monthly' | 'yearly';
    /** Concrete BundleVersion IDs to book with the plan. */
    bundleVersionIds?: string[];
    /** A promo code to apply; refused when the promo module cannot accept it. */
    promoCode?: string | null;
    locale?: string;
    validUntil?: string | null;
}

/**
 * What a caller may change while an offer is open: the body of
 * `PATCH /public/checkout-offer/:id`. The plan is fixed; everything given here
 * is priced again.
 */
export interface CheckoutOfferSelectionUpdate {
    billingCycle?: 'monthly' | 'yearly';
    bundleVersionIds?: string[];
    /** `null` removes a code applied before. */
    promoCode?: string | null;
    locale?: string;
    validUntil?: string | null;
}

/**
 * A new offer as the repository stores it — the selection with the amounts
 * the server computed for it (`CheckoutOfferRepository.create`).
 */
export interface CreateCheckoutOfferData {
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
 * A change to an open offer as the repository stores it, with the amounts
 * priced again (`CheckoutOfferRepository.update`). `status`/`consumedAt` are
 * not editable — `consume()` sets them server-side.
 */
export interface UpdateCheckoutOfferData {
    /** The plan version active when the change was priced. */
    planVersionId?: string | null;
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
