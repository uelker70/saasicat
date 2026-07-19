// CheckoutOffer — unveränderlicher Paket-Snapshot von der Webseite bis zur
// Subscription (METAMODELL §17a).
//
// Beim Paket-Klick auf der Pricing-Page wird ein CheckoutOffer angelegt; sein
// `id` wandert als `?offer=<id>` ins Onboarding. Dort darf der Tenant das
// Paket individualisieren (Bundles/Quotas) — das Delta wird in
// denselben Offer geschrieben. Bei Subscription-Anlage wird der finale Offer
// als `packageSnapshot` eingefroren.
//
// Spec: yada-services/handoff/superadmin/SUPERADMIN_TENANT_METAMODELL.md §17a

export type CheckoutOfferLineItemKind = 'plan' | 'bundle' | 'discount';

/** Eingefrorene abrechenbare Position im Offer. */
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

/** Eingefrorene angewendete Katalog-Promotion. */
export interface CheckoutOfferPromotionSnapshot {
    id: string | null;
    type: string;
    value: unknown;
    label: string;
    resolvedAmountNet: number;
    appliesTo: string[];
    billingCycle: 'monthly' | 'yearly' | 'both';
}

/** Eingefrorene PromoCode-Vorschau vor Vertragsabschluss. */
export interface CheckoutOfferPromoCodeSnapshot {
    code: string;
    label: string;
    valueType: string;
    value: number;
    resolvedAmountNet: number;
    durationType?: string | null;
    durationValue?: number | null;
}

/** Strukturierte Preis-Aufschlüsselung — eingefroren zum Offer-Zeitpunkt. */
export interface CheckoutOfferPriceBreakdown {
    currency: string;
    billingCycle: 'monthly' | 'yearly';
    /** Netto-Grundpreis des Plans. */
    planNet: number;
    /** Netto-Aufschlag durch Bundles. */
    bundlesNet: number;
    /** Netto-Gesamt vor Promo. */
    regularNet: number;
    /** Netto-Gesamt nach Promo. */
    effectiveNet: number;
    vatRate: number;
    /** Brutto-Gesamt nach Promo. */
    effectiveGross: number;
}

export type CheckoutOfferStatus = 'open' | 'consumed' | 'expired';

/** Wire-Format einer `checkout_offers`-Row. */
export interface CheckoutOfferRow {
    id: string;
    projectKey: string;

    /** Auf der Webseite gewählter Plan. */
    planKey: string;
    /** Aufgelöste Plan-Version, falls bekannt. */
    planVersionId: string | null;
    billingCycle: 'monthly' | 'yearly';

    /** Angewandte Promotion (zum Offer-Zeitpunkt aktiv). */
    promotionId: string | null;
    /** Eingelöster Promo-Code, falls die Promotion `requiresCoupon` war. */
    promoCode: string | null;

    /** Zugebuchte Bundle-Keys. Legacy-Anzeige; V3 nutzt `bundleVersionIds` + `lineItems`. */
    bundles: string[];
    /** Konkrete BundleVersion-IDs, die der Offer bindet. */
    bundleVersionIds?: string[];

    priceBreakdown: CheckoutOfferPriceBreakdown;
    /** V3-Vertragspositionen, bereits zum Offer-Zeitpunkt aufgelöst. */
    lineItems?: CheckoutOfferLineItem[];
    /** Aktive automatische Promotions als Snapshot. */
    promotionSnapshots?: CheckoutOfferPromotionSnapshot[];
    /** Eingelöster PromoCode als Snapshot. */
    promoCodeSnapshot?: CheckoutOfferPromoCodeSnapshot | null;
    locale: string;
    /** Zeitliche Gültigkeit des Offers; null = Repository/Consumer-Policy. */
    validUntil?: string | null;

    status: CheckoutOfferStatus;
    /** Gesetzt, sobald aus dem Offer eine Subscription entstanden ist. */
    consumedAt: string | null;

    createdAt: string;
    updatedAt: string;
}

export interface CheckoutOfferFilter {
    projectKey: string;
    status?: CheckoutOfferStatus;
}

/** Body von `POST /public/checkout-offer` — von der Webseite gerufen. */
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
 * Body von `PATCH /public/checkout-offer/:id` — Individualisierung im
 * Onboarding. `status`/`consumedAt` sind nicht editierbar — `consume()`
 * setzt sie serverseitig.
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
