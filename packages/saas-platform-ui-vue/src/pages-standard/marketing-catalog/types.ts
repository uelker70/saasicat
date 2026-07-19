import type {
    MarketingProjectionRow,
    MarketingTopFeature,
    PlanRow,
    PlanVersionRow,
} from '@saasicat/types';

export type MarketingCatalogTab = 'preview' | 'admin' | 'promos';

/** Aufgelöste Marketing-Werte — aus der Projektion oder Plan-Defaults. */
export interface ResolvedMarketing {
    /** Locale-spezifischer Plan-Name; leer = Fallback auf `plan.label` (DE-Stammdaten). */
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
    /** Aktuell im UI ausgewählte Version (Default: today-active). */
    liveVersion: PlanVersionRow | null;
    /** Alle published Versions des Plans, sortiert nach validFrom asc. */
    publishedVersions: PlanVersionRow[];
    projection: MarketingProjectionRow | null;
    m: ResolvedMarketing;
}

export interface FeatureSuggestion {
    /** Feature-/Quota-Key — wird auf dem Top-Feature persistiert. */
    key: string;
    /** Übersetztes Anzeige-Label (nur für den Vorschlags-Chip). */
    label: string;
    strong: string;
}
