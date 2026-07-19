// BundleRow / BundleVersionRow / BusinessTypeRow / BusinessTypeVersionRow /
// BusinessTypeBundleRow — Wire-Format der Bundle-/BusinessType-Tabellen-Rows.
//
// Diese Typen sind die HTTP-Projektion der Prisma-Models aus
// `saas-platform-spec/prisma-fragments/05-bundle-business-type.prisma`. Sie
// werden vom AdminController für die SuperAdmin-Pages „Bundles" und
// „BusinessTypes" geliefert und vom Plattform-UI (`saas-platform-ui-vue`)
// konsumiert.
//
// Konventionen:
// - Geld-Beträge sind `string | null` (Prisma-Decimal serialisiert als
//   String, nicht als Number — sonst Verlust). UI parst via `Number(s)`.
// - Versionierte Rows extenden `VersionedEntityBase` (analog
//   PlanVersionRow).
// - Stamm-Rows (Bundle / BusinessType) haben keine Versions-Felder.
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §5
//        + GESCHAEFTSTYP_SPEC.md §3.3 (Wire-Format-Vorlagen)

import type { CatalogEntryI18n } from './catalog-entry.types.js';
import type { FeatureKey, QuotaKey } from './plan-catalog.types.js';
import type { VersionedEntityBase } from './subscription.types.js';

// =============================================================================
// Hilfstypen
// =============================================================================

/**
 * Einsatz-Whitelist für einen Bundle. Beide Felder leer/fehlend = der Bundle
 * darf in jedem Geschäftstyp und mit jedem Plan eingesetzt werden. Sind beide
 * gesetzt, gilt AND-Verknüpfung.
 */
export interface BundleCompatibility {
    /**
     * Whitelist von Geschäftstyp-Keys; nur diese dürfen den Bundle einsetzen.
     * Leer/fehlend = alle Geschäftstypen erlaubt.
     */
    businessTypeKeys?: string[];
    /**
     * Whitelist von Plan-IDs; nur diese dürfen den Bundle einsetzen.
     * Relevant für Apps, die parallel Plan + BusinessType nutzen
     * (siehe SPEC_V2 §5 / GESCHAEFTSTYP_SPEC §3.2 App-Modell-Matrix).
     * Leer/fehlend = alle Plans erlaubt.
     */
    planIds?: string[];
}

/**
 * Pricing-Override pro Kontext. Resolution: most-specific wins
 * (siehe GESCHAEFTSTYP_SPEC §6.1).
 *
 * - `monthlyNet` / `yearlyNet` als String (Decimal-Wire-Format)
 * - `null` = expliziter „kostenlos in diesem Kontext"
 * - undefined / Feld fehlt = kein Override für dieses Cycle
 */
export interface BundlePricingOverride {
    /** Wenn gesetzt: Override gilt nur in diesem Geschäftstyp. */
    businessTypeKey?: string;
    /** Wenn gesetzt: Override gilt nur mit diesem Plan. */
    planId?: string;
    monthlyNet?: string | null;
    yearlyNet?: string | null;
}

// =============================================================================
// Bundle (Stamm + Version)
// =============================================================================

/**
 * Bundle — wiederverwendbare Komponente aus Features + Quotas + Pricing.
 * Stamm-Entität ohne Inhalt; die kaufbaren Felder liegen auf BundleVersionRow.
 */
export interface BundleRow {
    id: string;
    projectKey: string;
    bundleKey: string;
    label: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    /** Locale-Übersetzungen von `label`/`description` (SPEC_V2 §6.4). */
    i18n: CatalogEntryI18n;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

/**
 * BundleVersion — versionierte Komposition (Features, Quotas, Pricing).
 * `quotas` ist `Record<QuotaKey, number>`; `-1` = unbegrenzt; fehlender Key
 * trägt 0 bei. Die Aggregations-Logik (Σ über alle Bundles eines
 * BusinessType) ist in GESCHAEFTSTYP_SPEC §6.2 spezifiziert.
 */
export interface BundleVersionRow extends VersionedEntityBase {
    bundleId: string;
    /** Denormalisiert für UI (vermeidet zusätzlichen Lookup). */
    bundleKey: string;
    /** Denormalisiert für UI. */
    label: string;
    features: FeatureKey[];
    quotas: Record<QuotaKey, number>;
    compatibility: BundleCompatibility;
    pricingOverrides: BundlePricingOverride[];
    /** Default-Preis; null = nur via Override pricing. */
    monthlyNet: string | null;
    yearlyNet: string | null;
    marketed: boolean;
}

// =============================================================================
// BusinessType (Stamm + Version)
// =============================================================================

/**
 * BusinessType — fachliche Vertikale (Vereinstyp, Branchen-Variante).
 * Stamm-Entität; die effektiven Bundles + Pricing liegen auf
 * BusinessTypeVersionRow.
 */
export interface BusinessTypeRow {
    id: string;
    projectKey: string;
    businessTypeKey: string;
    label: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

/**
 * BusinessTypeVersion — versionierte Komposition aus referenzierten Bundles.
 *
 * - `quotaOverrides` ist `Partial<Record<QuotaKey, number>>`; fehlender Key
 *   bedeutet „nimm Σ(Bundle-Quotas)", gesetzter Key ersetzt die Summe
 *   (`-1` = unbegrenzt).
 * - `monthlyNet` null bedeutet „effektiver Preis = Σ(Bundle-Preise nach
 *   Pricing-Override-Resolution)". Gesetzt = expliziter BusinessType-Preis.
 * - `bundles` enthält die referenzierten BundleVersion-IDs in Sortier-
 *   reihenfolge (siehe BusinessTypeBundleRow).
 */
export interface BusinessTypeVersionRow extends VersionedEntityBase {
    businessTypeId: string;
    /** Denormalisiert für UI. */
    businessTypeKey: string;
    /** Denormalisiert für UI. */
    label: string;
    quotaOverrides: Partial<Record<QuotaKey, number>>;
    /** null = Σ(Bundle-Preise); gesetzt = Override. */
    monthlyNet: string | null;
    yearlyNet: string | null;
    marketed: boolean;
    /** In Sortier-Reihenfolge (sortOrder asc). */
    bundles: BusinessTypeBundleRow[];
}

/**
 * Junction zwischen BusinessTypeVersion und BundleVersion. Speichert die
 * *konkrete* BundleVersion (nicht nur den Stamm), damit ein publizierter
 * BusinessType deterministisch bleibt — auch wenn der Bundle später eine
 * neuere Version bekommt.
 */
export interface BusinessTypeBundleRow {
    bundleVersionId: string;
    /** Denormalisiert für UI: Key + Label des referenzierten Bundles. */
    bundleKey: string;
    bundleLabel: string;
    /** Version-Nummer der referenzierten BundleVersion. */
    bundleVersion: number;
    sortOrder: number;
}

// =============================================================================
// Service-DTOs (Create/Update) — Eingabe-Format der BundlesService-Methoden
// =============================================================================

/**
 * Felder, die beim Anlegen eines neuen Bundle-Stamms gesetzt werden müssen.
 * `id`, `createdAt`, `updatedAt`, `deletedAt` werden vom Repository vergeben.
 * Versions-spezifische Felder (Features, Quotas, Pricing) gehören in die
 * erste BundleVersion via `CreateBundleVersionDraftData`.
 */
export interface CreateBundleData {
    projectKey: string;
    bundleKey: string;
    label: string;
    description?: string | null;
    icon?: string | null;
    sortOrder?: number;
    i18n?: CatalogEntryI18n;
}

/**
 * Felder, die am Bundle-Stamm geändert werden dürfen. `bundleKey` und
 * `projectKey` sind absichtlich nicht hier — Stamm-Identität ist immutable;
 * wer sie ändern will, legt einen neuen Bundle an und retired den alten.
 */
export interface UpdateBundleData {
    label?: string;
    description?: string | null;
    icon?: string | null;
    sortOrder?: number;
    i18n?: CatalogEntryI18n;
}

/**
 * Felder einer neuen BundleVersion im Draft-Status (`publishedAt = null`).
 * Wird vom SuperAdmin angelegt, später per `publishBundleVersion()`
 * veröffentlicht. Nur **eine** Draft-Version pro Bundle erlaubt
 * (siehe Partial-Unique-Index in der Migration).
 */
export interface CreateBundleVersionDraftData {
    bundleId: string;
    /** Vorgänger-Version, gegen die der Diff berechnet wird (null bei v1). */
    baseVersionId?: string | null;
    features: FeatureKey[];
    quotas?: Record<QuotaKey, number>;
    compatibility?: BundleCompatibility;
    pricingOverrides?: BundlePricingOverride[];
    monthlyNet?: string | null;
    yearlyNet?: string | null;
    marketed?: boolean;
    /** Pflicht beim Publish (siehe Vertragsschutz P3 in SPEC_V2 §7). */
    changeNote?: string;
    /**
     * Ab wann diese Version für *neue* Buchungen aktiv sein soll. Pflicht
     * spätestens beim Publish (siehe `PublishBundleVersionData`); kann
     * schon im Draft vorgemerkt werden. Format: ISO-8601 (`YYYY-MM-DD`).
     */
    validFrom?: string | null;
    /**
     * Optional; null = unbegrenzt bis zur Ablösung durch eine Nachfolge-
     * Version (Auto-Sukzession). Wird beim Publish einer Nachfolge-Version
     * vom Service automatisch auf `nachfolger.validFrom - 1 Tag` gesetzt.
     */
    validUntil?: string | null;
    createdByUserId?: string | null;
}

/**
 * Felder einer Draft-BundleVersion, die noch geändert werden dürfen.
 * Mit SPEC_V2 §11.1 M6 Pack 2c auch für published-but-future Versionen
 * (latest-in-chain, 0 Subs, validFrom > now) — siehe
 * `isVersionEditable`.
 */
export interface UpdateBundleVersionDraftData {
    features?: FeatureKey[];
    quotas?: Record<QuotaKey, number>;
    compatibility?: BundleCompatibility;
    pricingOverrides?: BundlePricingOverride[];
    monthlyNet?: string | null;
    yearlyNet?: string | null;
    marketed?: boolean;
    changeNote?: string;
    /**
     * Neues `validFrom` für die Version. Beim Update einer Draft frei
     * setzbar; bei einer published-but-future Version muss das neue Datum
     * weiterhin in der Zukunft liegen — der Service prüft das mit
     * `isVersionEditable` gegen den frisch geladenen Stand.
     */
    validFrom?: string | null;
    validUntil?: string | null;
}

/**
 * Eingabe für `publishBundleVersion()`. `nonRegressive` und
 * `publishedChanges` werden vom Service aus dem Diff zur Vorgänger-Version
 * berechnet (siehe SPEC_V2 §7); der Aufrufer liefert nur Bestätigung
 * + User-Tag + Gültigkeitsdaten.
 *
 * `validFrom` ist beim Publish **Pflicht** (analog `PublishPlanVersionData`).
 * Wenn der Draft bereits ein `validFrom` trägt, ist es hier optional. Der
 * Service validiert strikt > `validFrom` der Vorgänger-Version und setzt
 * deren `validUntil` per Auto-Sukzession auf `validFrom - 1 Tag`.
 */
export interface PublishBundleVersionData {
    publishedByUserId: string | null;
    /**
     * Wenn true und der Diff klassifiziert die Version als regressiv,
     * wird trotzdem published — relevant für Bulk-Publish-MFA-Bestätigung
     * (siehe SPEC_V2 §7 Editor-UI-Pflichten).
     */
    forceRegressive?: boolean;
    /**
     * Erlaubt Publish trotz explizitem Preis 0,00. Standard false: ein
     * explizites 0,00-Publish wird geblockt (Schutz gegen Seed-Platzhalter).
     * `null`-Preise (Override-Resolution) sind davon nicht betroffen.
     */
    allowZeroPrice?: boolean;
    /**
     * Pflicht beim Publish, falls der Draft kein `validFrom` hat. Muss
     * strikt nach `validFrom` der Vorgänger-Version liegen. ISO-8601
     * (`YYYY-MM-DD` oder voller Timestamp).
     */
    validFrom?: string | null;
    /**
     * Optional; null = unbegrenzt gültig (passt für die letzte Version
     * eines Bundles). Wird bei Anlage einer Nachfolge-Version automatisch
     * vom Service überschrieben.
     */
    validUntil?: string | null;
}

// =============================================================================
// Strict-Mode-Check — Drift zwischen DB-Catalog und Discovery-Snapshot
// =============================================================================

/**
 * Code eines Strict-Mode-Verstoßes. SPEC_V2 §8.2 listet die acht Regeln,
 * gegen die geprüft wird; jede Regel hat einen eigenen Code, damit das UI
 * fokussierte Hilfe-Texte anzeigen kann.
 */
export type StrictModeWarningCode =
    | 'CAPABILITY_MISSING' // Code-Capability existiert nicht im DiscoverySnapshot
    | 'CAPABILITY_RETIRED' // Code-Capability wurde retired
    | 'FEATURE_MISSING' // Feature wird im Discovery nicht aggregiert
    | 'FEATURE_PLANNED_ONLY' // Feature ist als plannedOnly markiert (kein Code)
    | 'BUNDLE_FEATURE_UNKNOWN' // BundleVersion referenziert Feature, das nicht existiert
    | 'BUNDLE_PLAN_KEY_UNKNOWN' // BundleVersion.compatibility.planIds referenziert nicht-existenten Plan
    | 'PLAN_FEATURE_UNKNOWN' // PlanVersion referenziert Feature, das nicht existiert
    | 'PLAN_FEATURE_NOT_APPROVED' // PlanVersion referenziert nicht freigegebenes Feature (#20)
    | 'BUNDLE_FEATURE_NOT_APPROVED' // BundleVersion referenziert nicht freigegebenes Feature (#20)
    | 'PLAN_FEATURE_DEPENDENCY_UNSATISFIED' // Plan-Feature hat requires, das der Plan nicht enthält (#35, advisory)
    | 'BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED' // Bundle-Feature hat requires, das das Bundle nicht enthält (#35, advisory)
    | 'QUOTA_MISSING' // QuotaKey ohne @DefinesQuota im Code
    | 'QUOTA_NOT_APPROVED' // Quota existiert, ist aber nicht freigegeben (#20)
    | 'VERSION_PUBLISH_OVERLAP' // Mehrere marketed-Versionen mit überlappendem Zeitraum
    | 'BUNDLE_DISJOINTNESS' // Zwei Bundles in BusinessType aktivieren dasselbe Feature
    | 'BUNDLE_COMPATIBILITY'; // Bundle nicht mit BusinessType-Whitelist konform

/**
 * Ein Strict-Mode-Verstoß. `field` zeigt auf das verletzende Feld
 * (z. B. `'features[3]'`), `value` ist der konkrete Wert (z. B. `'INVENTORY'`).
 */
export interface StrictModeWarning {
    code: StrictModeWarningCode;
    /** Menschenlesbare Begründung (Deutsch). */
    message: string;
    /** Pfad zum verletzenden Feld; optional. */
    field?: string;
    /** Konkreter Wert, der verletzt; optional. */
    value?: string;
}

/**
 * Service-Result für mutierende Bundle-/BusinessType-Operationen
 * (createDraft, updateDraft, publish): liefert die persistierte Row plus
 * eine Liste Strict-Mode-Warnings. In `warn-only`-Modus gehen
 * Warnings als Banner ins UI; in `blocking`-Modus wirft der Service
 * stattdessen HTTP 422 mit derselben Warning-Liste als Body.
 */
export interface BundleVersionMutationResult {
    bundleVersion: BundleVersionRow;
    warnings: StrictModeWarning[];
}

/** Analog zu BundleVersionMutationResult, aber für BusinessTypeVersion. */
export interface BusinessTypeVersionMutationResult {
    businessTypeVersion: BusinessTypeVersionRow;
    warnings: StrictModeWarning[];
}

// =============================================================================
// BusinessType-Service-DTOs (Create/Update)
// =============================================================================

export interface CreateBusinessTypeData {
    projectKey: string;
    businessTypeKey: string;
    label: string;
    description?: string | null;
    icon?: string | null;
    sortOrder?: number;
}

export interface UpdateBusinessTypeData {
    label?: string;
    description?: string | null;
    icon?: string | null;
    sortOrder?: number;
}

/**
 * Junction-Eintrag (BusinessTypeBundle) als Eingabe — referenziert eine
 * konkrete BundleVersion-ID, nicht den Bundle-Stamm. Damit bleibt die
 * Komposition deterministisch.
 */
export interface BusinessTypeBundleInput {
    bundleVersionId: string;
    sortOrder?: number;
}

export interface CreateBusinessTypeVersionDraftData {
    businessTypeId: string;
    baseVersionId?: string | null;
    /**
     * Bundles als geordnete Liste der referenzierten BundleVersion-IDs.
     * Pflicht: mindestens **eine** Bundle-Referenz (siehe
     * GESCHAEFTSTYP_SPEC §10 „BusinessTypeVersion-Publish-Hard-Block").
     */
    bundles: BusinessTypeBundleInput[];
    /**
     * Quota-Overrides — fehlender Key bedeutet „nimm Σ(Bundle-Quotas)",
     * gesetzter Key ersetzt die Summe (-1 = unbegrenzt).
     */
    quotaOverrides?: Record<string, number>;
    /** Override-Pricing; null = Σ(Bundle-Preise nach Pricing-Override-Resolution). */
    monthlyNet?: string | null;
    yearlyNet?: string | null;
    marketed?: boolean;
    changeNote?: string;
    createdByUserId?: string | null;
}

export interface UpdateBusinessTypeVersionDraftData {
    bundles?: BusinessTypeBundleInput[];
    quotaOverrides?: Record<string, number>;
    monthlyNet?: string | null;
    yearlyNet?: string | null;
    marketed?: boolean;
    changeNote?: string;
}

export interface PublishBusinessTypeVersionData {
    publishedByUserId: string | null;
    forceRegressive?: boolean;
}
