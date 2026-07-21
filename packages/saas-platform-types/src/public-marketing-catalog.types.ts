// PublicMarketingCatalog — auth-free marketing projection for the website
// (pricing page). Merges marketed Plans + MarketingProjection + active
// promotions into fully rendered plan cards.
//
// Unlike `/billing/plans` (bare plan list), this wire format carries the
// marketing data maintained in the SuperAdmin: badge, teaser, top features,
// highlight, CTA, trial — plus the currently active promotion with an
// already-computed discount price.

import type { MarketingTopFeature } from './catalog-entry.types.js';
import type { PromotionType } from './promotion.types.js';

/** Active promotion of a plan card — discount already computed. */
export interface PublicMarketingPromo {
    type: PromotionType;
    /** Locale-resolved badge (e.g. "Frühjahrs-Aktion"). */
    badge: string;
    /** Locale-resolved fineprint below the CTA. */
    fineprint: string;
    /** UI accent color (ribbon). */
    color: string;
    /** Discounted net monthly price; null if not applicable. */
    discountedMonthlyNet: number | null;
    /** Discounted net yearly price; null if not applicable. */
    discountedYearlyNet: number | null;
}

/** A fully marketed plan card. */
export interface PublicMarketingPlan {
    planKey: string;
    label: string;
    /** Live PlanVersion ID — for the CheckoutOffer on click. */
    planVersionId: string;
    monthlyNet: number | null;
    yearlyNet: number | null;
    /** Editorial badge (empty = no badge). */
    badge: string;
    /** Teaser / description text. */
    description: string;
    highlight: boolean;
    /**
     * Formatted pricing tag from the MarketingProjection (#47, e.g.
     * "€ 9,90 / Monat" or "auf Anfrage"). null/missing = frontends
     * format automatically from monthlyNet/yearlyNet.
     */
    priceTag?: string | null;
    /** CTA override; null = automatic text. */
    ctaLabel: string | null;
    trialEnabled: boolean;
    trialDays: number;
    topFeatures: MarketingTopFeature[];
    /** Sort priority DESC. */
    priority: number;
    /** Currently active promotion or null. */
    promo: PublicMarketingPromo | null;
    /** Feature keys included in the plan — for the comparison matrix. */
    features: string[];
    /** Quota limits of the plan (`-1` = unlimited) — for the matrix. */
    quotas: Record<string, number>;
}

/**
 * A marketed bundle card for the public catalog (P11.7.3 +
 * P11.7.4). Bundles are offered as standalone add-ons to plans;
 * `compatiblePlanKeys` lists the plans in which the bundle may be
 * booked (empty = all plans allowed).
 */
export interface PublicMarketingBundle {
    bundleKey: string;
    label: string;
    /** Live BundleVersion ID — for the `add` request of the tenant self-service. */
    bundleVersionId: string;
    monthlyNet: number | null;
    yearlyNet: number | null;
    /** Description text (locale-resolved, falls back to bundle base). */
    description: string;
    /**
     * Formatted pricing tag from the MarketingProjection (#47) — analogous
     * to `PublicMarketingPlan.priceTag`. null/missing = automatic
     * formatting from monthlyNet/yearlyNet.
     */
    priceTag?: string | null;
    /** Feature keys included in the bundle. */
    features: string[];
    /** Quota top-ups of the bundle (`-1` = unlimited). */
    quotas: Record<string, number>;
    /** Currently active bundle promotion or null. */
    promo: PublicMarketingPromo | null;
    /**
     * Plan keys the bundle is compatible with. Empty array =
     * universal for all plans. The UI filters the display accordingly.
     */
    compatiblePlanKeys: string[];
    /**
     * Uncovered feature dependencies (#35): union of the `requires` of the
     * contained features minus those contained in the bundle itself.
     * The configurator greys out the bundle when these keys lie neither in
     * the selected plan nor in the current selection. Missing/empty =
     * self-contained or no requires data available.
     */
    requiresFeatures?: string[];
    /**
     * Locale-resolved display labels for `features` ∪ `requiresFeatures`
     * (#48). `comparison.features` only covers the plan feature union —
     * bundle-only features (e.g. RESOURCE_MANAGEMENT) would otherwise get no
     * label. Source: curated FeatureCatalogEntries incl. i18n. Only keys
     * with a curated entry are included; frontends fall back to the key
     * itself for missing keys. Missing/empty = no
     * CatalogEntryRepository registered.
     */
    featureLabels?: Record<string, string>;
}

/** A row of the comparison matrix (feature or quota). */
export interface PublicComparisonRow {
    key: string;
    /** Locale-resolved display label. */
    label: string;
    /** Quotas only: display unit. */
    unit?: string;
}

/** Response of `GET /public/marketing-catalog`. */
export interface PublicMarketingCatalogResponse {
    projectKey: string;
    locale: string;
    currency: string;
    /** VAT rate in percent — for the CheckoutOffer price breakdown. */
    vatRate: number;
    /** Visible, marketed plans — sorted by `priority` DESC. */
    plans: PublicMarketingPlan[];
    /**
     * Visible, marketed bundles (P11.7.3 + P11.7.4) — as standalone
     * add-ons to the plans. The tenant self-service UI filters client-side
     * via `compatiblePlanKeys` against its own plan; the backend
     * does not filter here, so the marketing comparison page shows all
     * bundles.
     */
    bundles: PublicMarketingBundle[];
    /**
     * Row definitions of the comparison matrix — union of all
     * feature/quota keys across the visible plans, with labels.
     */
    comparison: {
        features: PublicComparisonRow[];
        quotas: PublicComparisonRow[];
    };
}
