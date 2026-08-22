import type {
    MarketingProjectionRow,
    MarketingTopFeature,
    PlanRow,
    PlanVersionRow,
} from '@saasicat/types';

export type MarketingCatalogTab = 'preview' | 'admin' | 'promos';

/** Resolved marketing values — from the projection or plan defaults. */
export interface ResolvedMarketing {
    /** Locale-specific plan name; empty = fallback to `plan.label` (DE master data). */
    displayLabel: string;
    visible: boolean;
    highlight: boolean;
    badge: string;
    priority: number;
    description: string;
    trialEnabled: boolean;
    trialDays: number;
    ctaLabel: string | null;
    topFeatures: MarketingTopFeature[];
    priceTag: string | null;
}

export interface MarketingRow {
    plan: PlanRow;
    accent: string;
    /** Version currently selected in the UI (default: today-active). */
    liveVersion: PlanVersionRow | null;
    /** All published versions of the plan, sorted by validFrom asc. */
    publishedVersions: PlanVersionRow[];
    projection: MarketingProjectionRow | null;
    m: ResolvedMarketing;
}

export interface FeatureSuggestion {
    /** Feature/quota key — persisted on the top feature. */
    key: string;
    /** Translated display label (only for the suggestion chip). */
    label: string;
    strong: string;
}
