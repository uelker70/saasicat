// PublicMarketingCatalog — auth-freie Marketing-Projektion für die Webseite
// (Pricing-Page). Merged marketed Plans + MarketingProjection + aktive
// Promotions zu fertig gerenderten Plan-Karten.
//
// Im Gegensatz zu `/billing/plans` (nackte Plan-Liste) trägt dieses
// Wire-Format die im SuperAdmin gepflegten Marketing-Daten: Badge, Teaser,
// Top-Features, Highlight, CTA, Trial — plus die aktuell aktive Aktion mit
// bereits ausgerechnetem Rabattpreis.
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §9 + §9a + §6.5

import type { MarketingTopFeature } from './catalog-entry.types.js';
import type { PromotionType } from './promotion.types.js';

/** Aktive Promotion einer Plan-Karte — Rabatt bereits ausgerechnet. */
export interface PublicMarketingPromo {
    type: PromotionType;
    /** Locale-aufgelöstes Badge (z. B. „Frühjahrs-Aktion"). */
    badge: string;
    /** Locale-aufgelöster Fineprint unter dem CTA. */
    fineprint: string;
    /** UI-Akzentfarbe (Ribbon). */
    color: string;
    /** Rabattierter Monats-Nettopreis; null wenn nicht anwendbar. */
    discountedMonthlyNet: number | null;
    /** Rabattierter Jahres-Nettopreis; null wenn nicht anwendbar. */
    discountedYearlyNet: number | null;
}

/** Eine fertig vermarktete Plan-Karte. */
export interface PublicMarketingPlan {
    planKey: string;
    label: string;
    /** Live-PlanVersion-ID — für den CheckoutOffer beim Klick. */
    planVersionId: string;
    monthlyNet: number | null;
    yearlyNet: number | null;
    /** Editorial-Badge (leer = kein Badge). */
    badge: string;
    /** Teaser-/Beschreibungstext. */
    description: string;
    highlight: boolean;
    /**
     * Formatiertes Pricing-Tag aus der MarketingProjection (#47, z. B.
     * "€ 9,90 / Monat" oder "auf Anfrage"). null/fehlend = Frontends
     * formatieren automatisch aus monthlyNet/yearlyNet.
     */
    priceTag?: string | null;
    /** CTA-Override; null = automatischer Text. */
    ctaLabel: string | null;
    trialEnabled: boolean;
    trialDays: number;
    topFeatures: MarketingTopFeature[];
    /** Sortier-Priorität DESC. */
    priority: number;
    /** Aktuell aktive Aktion oder null. */
    promo: PublicMarketingPromo | null;
    /** Im Plan enthaltene Feature-Keys — für die Vergleichs-Matrix. */
    features: string[];
    /** Quota-Limits des Plans (`-1` = unbegrenzt) — für die Matrix. */
    quotas: Record<string, number>;
}

/**
 * Eine vermarktete Bundle-Karte für den Public-Catalog (P11.7.3 +
 * P11.7.4). Bundles werden als eigenständige Add-ons zu Plänen
 * angeboten; `compatiblePlanKeys` listet die Pläne, in denen das Bundle
 * gebucht werden darf (leer = alle Pläne erlaubt).
 */
export interface PublicMarketingBundle {
    bundleKey: string;
    label: string;
    /** Live-BundleVersion-ID — für das `add`-Request des Tenant-Self-Service. */
    bundleVersionId: string;
    monthlyNet: number | null;
    yearlyNet: number | null;
    /** Beschreibungstext (Locale-aufgelöst, Fallback auf Bundle-Stamm). */
    description: string;
    /**
     * Formatiertes Pricing-Tag aus der MarketingProjection (#47) — analog
     * `PublicMarketingPlan.priceTag`. null/fehlend = automatische
     * Formatierung aus monthlyNet/yearlyNet.
     */
    priceTag?: string | null;
    /** Im Bundle enthaltene Feature-Keys. */
    features: string[];
    /** Quota-Aufschläge des Bundles (`-1` = unbegrenzt). */
    quotas: Record<string, number>;
    /** Aktuell aktive Bundle-Aktion oder null. */
    promo: PublicMarketingPromo | null;
    /**
     * Plan-Keys, mit denen das Bundle kompatibel ist. Leeres Array =
     * universell für alle Pläne. UI filtert die Anzeige danach.
     */
    compatiblePlanKeys: string[];
    /**
     * Ungedeckte Feature-Abhängigkeiten (#35): Union der `requires` der
     * enthaltenen Features minus der im Bundle selbst enthaltenen.
     * Der Konfigurator graut das Bundle aus, wenn diese Keys weder im
     * gewählten Plan noch in der aktuellen Auswahl liegen. Fehlend/leer =
     * self-contained bzw. keine requires-Daten verfügbar.
     */
    requiresFeatures?: string[];
    /**
     * Locale-aufgelöste Anzeige-Labels für `features` ∪ `requiresFeatures`
     * (#48). `comparison.features` deckt nur die Plan-Feature-Union ab —
     * Bundle-only-Features (z. B. RESOURCE_MANAGEMENT) bekämen sonst kein
     * Label. Quelle: kuratierte FeatureCatalogEntries inkl. i18n. Nur Keys
     * mit kuratiertem Eintrag sind enthalten; Frontends fallen für fehlende
     * Keys auf den Key selbst zurück. Fehlend/leer = kein
     * CatalogEntryRepository registriert.
     */
    featureLabels?: Record<string, string>;
}

/** Eine Zeile der Vergleichs-Matrix (Feature oder Quota). */
export interface PublicComparisonRow {
    key: string;
    /** Locale-aufgelöstes Anzeige-Label. */
    label: string;
    /** Nur bei Quotas: Anzeige-Einheit. */
    unit?: string;
}

/** Antwort von `GET /public/marketing-catalog`. */
export interface PublicMarketingCatalogResponse {
    projectKey: string;
    locale: string;
    currency: string;
    /** USt-Satz in Prozent — für die CheckoutOffer-Preis-Aufschlüsselung. */
    vatRate: number;
    /** Sichtbare, marketed Pläne — nach `priority` DESC sortiert. */
    plans: PublicMarketingPlan[];
    /**
     * Sichtbare, marketed Bundles (P11.7.3 + P11.7.4) — als eigenständige
     * Add-ons zu den Plänen. Tenant-Self-Service-UI filtert client-seitig
     * via `compatiblePlanKeys` gegen den eigenen Plan; das Backend
     * filtert hier nicht, damit die Marketing-Vergleichsseite alle
     * Bundles zeigt.
     */
    bundles: PublicMarketingBundle[];
    /**
     * Zeilen-Definitionen der Vergleichs-Matrix — Vereinigung aller
     * Feature-/Quota-Keys über die sichtbaren Pläne, mit Labels.
     */
    comparison: {
        features: PublicComparisonRow[];
        quotas: PublicComparisonRow[];
    };
}
