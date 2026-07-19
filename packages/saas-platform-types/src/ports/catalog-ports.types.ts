import type { TransactionContext } from './core-ports.types.js';
import type {
    BundleRow,
    BundleVersionRow,
    BusinessTypeRow,
    BusinessTypeVersionRow,
    CreateBundleData,
    CreateBundleVersionDraftData,
    CreateBusinessTypeData,
    CreateBusinessTypeVersionDraftData,
    UpdateBundleData,
    UpdateBundleVersionDraftData,
    UpdateBusinessTypeData,
    UpdateBusinessTypeVersionDraftData,
} from '../bundle-business-type.types.js';
import type {
    CapabilityCatalogEntryRow,
    CapabilityCodeStatus,
    CatalogEntryFilter,
    CatalogEntryI18n,
    CreateMarketingProjectionData,
    DiscoveryStatus,
    FeatureCatalogEntryRow,
    MarketingProjectionFilter,
    MarketingProjectionRow,
    QuotaCatalogEntryRow,
    UpdateCatalogEntryBaseData,
    UpdateMarketingProjectionData,
} from '../catalog-entry.types.js';
import type {
    MarketingSettingsRow,
    UpdateMarketingSettingsData,
} from '../marketing-settings.types.js';
import type { CreatePlanData, PlanRow, UpdatePlanData } from '../plan-stem.types.js';
import type {
    CreatePlanVersionDraftData,
    UpdatePlanVersionDraftData,
} from '../plan-version-lifecycle.types.js';
import type { PlanVersionRow } from '../plan-version-row.types.js';
import type {
    CreatePromotionData,
    PromotionFilter,
    PromotionRow,
    UpdatePromotionData,
} from '../promotion.types.js';
import type { VersionChange } from '../subscription.types.js';

// =============================================================================
// Bundle / BundleVersion — Persistenz-Adapter (SPEC_V2 §5 + §11.1 M3)
// =============================================================================

/** Filter für `PlanRepository.list()`. */
export interface PlanListFilter {
    projectKey: string;
    /** Soft-deleted Pläne ausschließen — Default `true`. */
    excludeDeleted?: boolean;
    /**
     * Nur Pläne mit mindestens einer live geschalteten Version
     * (`publishedAt` gesetzt, `supersededAt` null). Default `false` — die
     * Plan-Verwaltung listet weiterhin auch Drafts. Auswahl-Masken (z. B.
     * Pilot-Anlage) setzen `true`, damit keine unbuchbaren Pläne erscheinen.
     */
    onlyPublished?: boolean;
}

/**
 * Adapter für `Plan`-Stamm + `PlanVersion`-Lifecycle-Persistenz
 * (SPEC_V2 §11.1 M6). Konsumenten implementieren das gegen die Prisma-
 * Tabellen `plans` + `plan_versions`.
 *
 * Pack 1 (CRUD-Stamm) und Pack 2a (Lifecycle) sind in einem Interface,
 * analog `BundleRepository` — die Lifecycle-Methoden sind aber **optional**
 * (Apps ohne SuperAdmin-Editor implementieren sie nicht; CatalogModule
 * registriert dann `PlanVersionsService` nicht).
 *
 * Verbindlich für Lifecycle:
 * - `createDraft` darf nur erfolgreich sein, wenn keine andere Draft-Version
 *   für denselben `planId` existiert (Partial-Unique-Index in der SQL-
 *   Migration).
 * - `publishDraft` setzt `publishedAt = NOW()`, `publishedChanges`,
 *   `nonRegressive`, `publishedByUserId` an der Draft — und versettst die
 *   zuvor live Version (gleicher `planId`, `publishedAt IS NOT NULL`,
 *   `supersededAt IS NULL`) auf `supersededAt = NOW()`. Beides in einer
 *   Transaktion.
 */
export interface PlanRepository {
    // ─── Stamm-Operationen (Pack 1) ───
    list(filter: PlanListFilter): Promise<PlanRow[]>;
    findById(planId: string): Promise<PlanRow | null>;
    findByKey(projectKey: string, planKey: string): Promise<PlanRow | null>;
    create(data: CreatePlanData): Promise<PlanRow>;
    update(planId: string, data: UpdatePlanData): Promise<PlanRow>;
    /** Setzt `deletedAt` auf NOW(); soft-deleted Pläne werden in `list` per Default gefiltert. */
    softDelete(planId: string): Promise<void>;

    /**
     * Entfernt den Plan-Stamm hart aus der DB (kein `deletedAt`, kein
     * Recovery-Pfad). Der Service ruft die Methode erst auf, nachdem er
     * geprüft hat, dass keine `PlanVersion` mehr existiert — Konsumenten
     * dürfen sich darauf verlassen, dass die Tabelle leer ist. Wenn die
     * Methode nicht implementiert ist, antwortet der Service mit 422
     * `PLAN_HARD_DELETE_NOT_IMPLEMENTED`.
     */
    hardDelete?(planId: string): Promise<void>;

    // ─── Lifecycle-Operationen (Pack 2a, optional) ───
    //
    // **Wichtig:** Die Lifecycle-Methoden nehmen den **planKey** entgegen
    // (z. B. "STARTER"), nicht die Plan-UUID. Grund: die Greenfield-
    // Bindung läuft über `PlanVersion.planId === Plan.planKey` als
    // String-Match (siehe SPEC_V2 §11.1 M6: kein FK bis zum Importer-
    // Cutover). Der `PlanVersionsService` resolvert die Plan-UUID des
    // Controller-Path-Param via `findById(planUuid).planKey`, bevor er
    // diese Methoden aufruft.

    /**
     * Liefert alle Versions eines Plan-Stamms (Drafts + published +
     * superseded), sortiert nach `version` aufsteigend.
     */
    listVersions?(planKey: string): Promise<PlanVersionRow[]>;
    findVersionById?(versionId: string): Promise<PlanVersionRow | null>;
    findCurrentDraft?(planKey: string): Promise<PlanVersionRow | null>;
    /**
     * Aktuell veröffentlichte (= live) PlanVersion eines Plans:
     * `publishedAt IS NOT NULL AND supersededAt IS NULL`.
     *
     * Hinweis: liefert die *neueste* publishierte Version per
     * `version`-Nummer und ignoriert `validFrom`/`validUntil`. Für
     * zeit-bewusste Reads (Onboarding, Marketing-Catalog, Entitlement-
     * Fallback) `findActivePlanVersion(planKey, asOf)` verwenden, das
     * die *zu einem Zeitpunkt aktive* Version liefert.
     */
    findLatestLivePlanVersion?(
        planKey: string,
        tx?: TransactionContext,
    ): Promise<PlanVersionRow | null>;

    /**
     * Zu `asOf` aktive PlanVersion eines Plans (SPEC_V2 §4.2 erweitert):
     *   `publishedAt IS NOT NULL`
     *   `(validFrom IS NULL OR validFrom <= asOf)`
     *   `(validUntil IS NULL OR validUntil >= startOfUtcDay(asOf))`  — tag-inklusiv
     *
     * `validFrom IS NULL` wird wie „gilt seit jeher" behandelt, damit Altdaten
     * ohne Startdatum (publiziert vor der §4.2-Publish-Pflicht) nicht aus dem
     * Katalog fallen. `validUntil` ist tag-inklusiv (Tagesdatum): die Version
     * gilt bis zum Ende ihres validUntil-Tages, nicht nur bis Mitternacht.
     * Adapter bauen die WHERE über `buildActivePlanVersionWhere`.
     *
     * Wenn mehrere matchen: die mit dem höchsten `validFrom` (= die
     * "letzte aktive"); NULL sortiert zuletzt, bleibt also echter Fallback.
     * Default-`asOf` ist der Aufruf-Zeitpunkt.
     *
     * Verwendung: alles, was *neue* Buchungen/Plan-Wechsel betrifft
     * (Onboarding, Public-Marketing, Entitlement-Fallback bei TRIAL).
     * Bestehende Subscriptions bleiben auf ihrer gebundenen `planVersionId`
     * (P1-Vertragsschutz).
     */
    findActivePlanVersion?(
        planKey: string,
        asOf?: Date,
        tx?: TransactionContext,
    ): Promise<PlanVersionRow | null>;

    /**
     * Legt eine neue Draft-Version an (`publishedAt = null`). Wirft, wenn
     * bereits eine Draft existiert (Partial-Unique-Index-Verletzung).
     * Berechnet `version` als `MAX(version) + 1` über alle Versionen des
     * `planId`.
     */
    createPlanVersionDraft?(data: CreatePlanVersionDraftData): Promise<PlanVersionRow>;
    updatePlanVersionDraft?(
        versionId: string,
        data: UpdatePlanVersionDraftData,
    ): Promise<PlanVersionRow>;
    /**
     * Veröffentlicht eine Draft-Version atomar (SPEC_V2 §4.2 + §11.1 M6 Pack 2a):
     * 1. Setzt `publishedAt = NOW()`, `publishedChanges`, `nonRegressive`,
     *    `publishedByUserId`, `validFrom` an der Draft.
     * 2. Setzt `supersededAt = NOW()` an der bisher live Version UND
     *    `validUntil = validFrom - 1 Tag` (Auto-Sukzession).
     * 3. Setzt `validUntil` an der neuen Version (optional, default null = unbegrenzt).
     */
    publishPlanVersionDraft?(
        versionId: string,
        publishMeta: {
            publishedByUserId: string | null;
            publishedChanges: VersionChange[];
            nonRegressive: boolean;
            /** Pflicht — wird vom Service vor Repository-Call validiert. */
            validFrom: Date;
            validUntil: Date | null;
        },
        tx?: TransactionContext,
    ): Promise<PlanVersionRow>;

    /**
     * Verwirft eine Draft-Version (`publishedAt === null`) hart aus der DB.
     * Wirft, wenn die Version bereits published wurde — published Versions
     * bleiben unveränderlich erhalten (audit + Bestand-Subscriptions
     * referenzieren sie). Wenn die Version nicht existiert, ist Discard
     * ein no-op (Caller hat ggf. parallel schon einen anderen Pfad genutzt).
     */
    deletePlanVersionDraft?(versionId: string): Promise<void>;

    /**
     * Setzt das vom SuperAdmin gewählte `endsAt`-Datum auf eine **published**
     * PlanVersion (`publishedAt != null && supersededAt == null`). Idempotent —
     * ein zweiter Aufruf mit anderem Datum überschreibt das Feld.
     *
     * Service-seitige Vorbedingungen (live + future-date) werden vom
     * `PlanVersionsService` geprüft; der Adapter persistiert nur. Wenn die
     * Methode nicht implementiert ist, antwortet der Service mit 422
     * `PLAN_TERMINATE_NOT_IMPLEMENTED`.
     */
    terminate?(versionId: string, endsAt: Date): Promise<PlanVersionRow>;
}

/** Filter für `BundleRepository.list()`. */
export interface BundleListFilter {
    projectKey: string;
    /** Soft-deleted Bundles ausschließen — Default `true`. */
    excludeDeleted?: boolean;
}

/**
 * Adapter für `Bundle` + `BundleVersion`-Persistenz. Konsumenten implementieren
 * das gegen ihre Prisma-Tabellen (`bundles` + `bundle_versions`).
 *
 * Verbindlich:
 * - `createDraft` darf nur erfolgreich sein, wenn keine andere Draft-Version
 *   für denselben `bundleId` existiert (Partial-Unique-Index in der SQL-
 *   Migration; siehe README im Prisma-Fragment).
 * - `publishDraft` setzt `publishedAt = NOW()`, `publishedChanges`,
 *   `nonRegressive`, `publishedByUserId` — und versettst die zuvor live
 *   Version (gleicher `bundleId`, `publishedAt IS NOT NULL`,
 *   `supersededAt IS NULL`) auf `supersededAt = NOW()`.
 * - Operationen, die Atomarität brauchen, dürfen optional einen
 *   `TransactionContext` übernehmen.
 */
export interface BundleRepository {
    // ─── Stamm-Operationen ───
    list(filter: BundleListFilter): Promise<BundleRow[]>;
    findById(bundleId: string): Promise<BundleRow | null>;
    findByKey(projectKey: string, bundleKey: string): Promise<BundleRow | null>;
    create(data: CreateBundleData): Promise<BundleRow>;
    update(bundleId: string, data: UpdateBundleData): Promise<BundleRow>;
    /** Setzt `deletedAt` auf NOW(); soft-deleted Bundles werden in `list` per Default gefiltert. */
    softDelete(bundleId: string): Promise<void>;

    // ─── Version-Operationen ───
    listVersions(bundleId: string): Promise<BundleVersionRow[]>;
    findVersionById(versionId: string): Promise<BundleVersionRow | null>;
    findCurrentDraft(bundleId: string): Promise<BundleVersionRow | null>;
    /**
     * Aktuell veröffentlichte (= live) BundleVersion eines Bundles:
     * `publishedAt IS NOT NULL AND supersededAt IS NULL`.
     */
    findLatestLive(bundleId: string, tx?: TransactionContext): Promise<BundleVersionRow | null>;

    /**
     * Legt eine neue Draft-Version an (`publishedAt = null`). Wirft, wenn
     * bereits eine Draft existiert (Partial-Unique-Index-Verletzung).
     * Berechnet `version` als `MAX(version) + 1` über alle Versionen des
     * `bundleId`.
     */
    createDraft(data: CreateBundleVersionDraftData): Promise<BundleVersionRow>;
    updateDraft(versionId: string, data: UpdateBundleVersionDraftData): Promise<BundleVersionRow>;

    /**
     * Veröffentlicht eine Draft-Version atomar (SPEC_V2 §4.2 + §11.1 M6
     * Pack 2c, analog `PlanRepository.publishPlanVersionDraft`):
     * 1. Setzt `publishedAt = NOW()`, `publishedChanges`, `nonRegressive`,
     *    `publishedByUserId`, `validFrom` an der Draft.
     * 2. Setzt `supersededAt = NOW()` an der bisher live Version (falls
     *    vorhanden) UND deren `validUntil = validFrom - 1 Tag`
     *    (Auto-Sukzession).
     * 3. Setzt `validUntil` an der neuen Version (optional, default null
     *    = unbegrenzt).
     *
     * Alle Schritte laufen in einer Transaktion (Konsumenten reichen
     * üblicherweise einen `TransactionRunner` durch). Service-seitig
     * vorgeprüft: `validFrom > previous.validFrom`, Gapless-Constraint
     * falls Vorgänger ein `validUntil` trägt — der Adapter persistiert
     * nur, validiert nicht erneut.
     */
    publishDraft(
        versionId: string,
        publishMeta: {
            publishedByUserId: string | null;
            publishedChanges: VersionChange[];
            nonRegressive: boolean;
            /** Pflicht — wird vom Service vor Repository-Call validiert. */
            validFrom: Date;
            validUntil: Date | null;
        },
        tx?: TransactionContext,
    ): Promise<BundleVersionRow>;

    /**
     * Verwirft eine Draft-Version (`publishedAt === null`) hart aus der DB.
     * Wirft, wenn die Version bereits published wurde — published Versions
     * bleiben unveränderlich erhalten (Vertragsschutz P1). Wenn die Version
     * nicht existiert, ist Discard ein no-op (Caller hat ggf. parallel
     * schon einen anderen Pfad genutzt).
     *
     * Optional aus Backwards-Compat-Gründen — wenn der Adapter sie nicht
     * implementiert, antwortet der Service mit 422
     * `BUNDLE_VERSION_DISCARD_NOT_IMPLEMENTED`.
     */
    deleteDraft?(versionId: string): Promise<void>;
}

// =============================================================================
// BusinessType / BusinessTypeVersion — Persistenz-Adapter (SPEC_V2 §11.1 M3)
// =============================================================================

/** Filter für `BusinessTypeRepository.list()`. */
export interface BusinessTypeListFilter {
    projectKey: string;
    excludeDeleted?: boolean;
}

/**
 * Adapter für `BusinessType` + `BusinessTypeVersion` + `BusinessTypeBundle`-
 * Persistenz. Konsumenten implementieren das gegen ihre Prisma-Tabellen
 * (`business_types`, `business_type_versions`, `business_type_bundles`).
 *
 * Wie `BundleRepository`: max. 1 Draft pro businessTypeId; `publishDraft`
 * setzt vorherige Live-Version auf `supersededAt`. Bundles-Komposition
 * wird mit jeder BusinessTypeVersion atomar mit­geschrieben (Junction-Rows).
 */
export interface BusinessTypeRepository {
    // ─── Stamm-Operationen ───
    list(filter: BusinessTypeListFilter): Promise<BusinessTypeRow[]>;
    findById(businessTypeId: string): Promise<BusinessTypeRow | null>;
    findByKey(projectKey: string, businessTypeKey: string): Promise<BusinessTypeRow | null>;
    create(data: CreateBusinessTypeData): Promise<BusinessTypeRow>;
    update(businessTypeId: string, data: UpdateBusinessTypeData): Promise<BusinessTypeRow>;
    softDelete(businessTypeId: string): Promise<void>;

    // ─── Version-Operationen ───
    listVersions(businessTypeId: string): Promise<BusinessTypeVersionRow[]>;
    findVersionById(versionId: string): Promise<BusinessTypeVersionRow | null>;
    findCurrentDraft(businessTypeId: string): Promise<BusinessTypeVersionRow | null>;
    findLatestLive(
        businessTypeId: string,
        tx?: TransactionContext,
    ): Promise<BusinessTypeVersionRow | null>;

    /**
     * Legt eine neue Draft-Version an. Wirft, wenn bereits eine Draft
     * existiert. Berechnet `version` als MAX+1. Schreibt die
     * BusinessTypeBundle-Junction-Rows in derselben Transaktion.
     */
    createDraft(data: CreateBusinessTypeVersionDraftData): Promise<BusinessTypeVersionRow>;
    updateDraft(
        versionId: string,
        data: UpdateBusinessTypeVersionDraftData,
    ): Promise<BusinessTypeVersionRow>;

    publishDraft(
        versionId: string,
        publishMeta: {
            publishedByUserId: string | null;
            publishedChanges: VersionChange[];
            nonRegressive: boolean;
        },
        tx?: TransactionContext,
    ): Promise<BusinessTypeVersionRow>;
}

// =============================================================================
// MarketingProjection — Persistenz-Adapter (SPEC_V2 §11.1 M3)
// =============================================================================

/**
 * Adapter für `marketing_projections`. **Keine Versionierung** — pro
 * (`targetType`, `targetVersionId`, `locale`) gibt es genau eine Row,
 * die direkt geändert wird. Marketing-Edits gehen sofort live, weil sie
 * nur die Public-Catalog-Anzeige steuern, keine Bestand-Subscriptions.
 *
 * Eindeutigkeit über (`targetType`, `targetVersionId`, `locale`) ist
 * im DB-Schema als Unique-Index erzwungen — `create` mit Konflikt wirft.
 */
export interface MarketingProjectionRepository {
    list(filter: MarketingProjectionFilter): Promise<MarketingProjectionRow[]>;
    findById(id: string): Promise<MarketingProjectionRow | null>;
    /**
     * Findet eine Projection durch das Tripel
     * (`targetType`, `targetVersionId`, `locale`).
     */
    findByTarget(
        targetType: string,
        targetVersionId: string,
        locale: string,
    ): Promise<MarketingProjectionRow | null>;

    create(data: CreateMarketingProjectionData): Promise<MarketingProjectionRow>;
    update(id: string, data: UpdateMarketingProjectionData): Promise<MarketingProjectionRow>;
    /** Hard-Delete — keine Soft-Delete-Spalte (nicht versioniert). */
    delete(id: string): Promise<void>;
}

// =============================================================================
// CatalogEntry — Persistenz-Adapter (SPEC_V2 §6.3 — Discovery-Review)
// =============================================================================

/** Upsert-Input für eine Capability aus dem Discovery-Sync. */
export interface UpsertCapabilityEntryData {
    projectKey: string;
    capabilityKey: string;
    label: string;
    description: string | null;
    featureKey: string | null;
    bundleKey: string | null;
    /** Read-only Code-Fakt aus dem Snapshot (#20) — der Sync überschreibt immer. */
    codeStatus: CapabilityCodeStatus;
    owner: string | null;
    kind: CapabilityCatalogEntryRow['kind'];
    replacementKey: string | null;
    deprecatedAt: string | null;
    removalPlannedAt: string | null;
    reason: string | null;
}

/** Upsert-Input für ein Feature aus dem Discovery-Sync. */
export interface UpsertFeatureEntryData {
    projectKey: string;
    featureKey: string;
    label: string;
    description: string | null;
    discoveryStatus: DiscoveryStatus;
    /** Code-discoverte Feature-Abhängigkeiten (#35) — der Sync überschreibt immer. */
    requires: string[];
    /** Alte Feature-Keys, die dieses Feature ablöst (#39) — der Sync überschreibt immer. */
    replaces: string[];
    /** true = Basis/immer enthalten (nicht pro Plan buchbar). Deterministisch aus der Registry. */
    core?: boolean;
}

/** Upsert-Input für eine Quota aus dem Discovery-Sync. */
export interface UpsertQuotaEntryData {
    projectKey: string;
    quotaKey: string;
    label: string;
    description: string | null;
    unit: string;
    featureKey: string | null;
    usageProvider: string | null;
    enforcementMode: QuotaCatalogEntryRow['enforcementMode'];
    discoveryStatus: DiscoveryStatus;
    /** Alte QuotaKeys, die diese Quota ablöst (#39) — der Sync überschreibt immer. */
    replaces: string[];
}

/**
 * Review-Update eines Features/einer Quota (`setFeatureReview`/
 * `setQuotaReview`). Der Service hat den Übergang bereits validiert und die
 * Approval-Felder aufgelöst — der Adapter persistiert alle vier Felder 1:1
 * (`null` löscht).
 */
export interface SetCatalogEntryReviewData {
    discoveryStatus: DiscoveryStatus;
    approvedAt: string | null;
    approvedBy: string | null;
    approvedSignature: string | null;
}

/**
 * Adapter für `capability_catalog_entries`, `feature_catalog_entries` und
 * `quota_catalog_entries`. Konsumenten implementieren das gegen ihre
 * Prisma-Tabellen.
 *
 * Verbindlich:
 * - `upsert*` matcht auf (`projectKey`, `<key>`) und lässt `i18n`,
 *   `sortOrder`, `createdAt` sowie die Approval-Felder (`approvedAt`/
 *   `approvedBy`/`approvedSignature`) bei einem Update **unangetastet** —
 *   nur die code-abgeleiteten Felder + der Status (vom Service aufgelöst)
 *   werden geschrieben.
 * - `retireMissing` markiert alle nicht soft-deleteten Einträge, deren Key
 *   nicht in `presentKeys` steht: Capabilities → `codeStatus = 'retired'`,
 *   Features/Quotas → `discoveryStatus = 'obsolete'`. Gibt die Anzahl zurück.
 */
export interface CatalogEntryRepository {
    listCapabilities(filter: CatalogEntryFilter): Promise<CapabilityCatalogEntryRow[]>;
    listFeatures(filter: CatalogEntryFilter): Promise<FeatureCatalogEntryRow[]>;
    listQuotas(filter: CatalogEntryFilter): Promise<QuotaCatalogEntryRow[]>;

    upsertCapability(data: UpsertCapabilityEntryData): Promise<CapabilityCatalogEntryRow>;
    upsertFeature(data: UpsertFeatureEntryData): Promise<FeatureCatalogEntryRow>;
    upsertQuota(data: UpsertQuotaEntryData): Promise<QuotaCatalogEntryRow>;

    retireMissing(
        projectKey: string,
        type: 'capability' | 'feature' | 'quota',
        presentKeys: string[],
    ): Promise<number>;

    /**
     * Setzt bzw. löscht den Nachfolger-Pointer eines Features/einer Quota
     * (#39). Der Sync ruft das auf, wenn ein Key aus dem Snapshot verschwindet
     * und ein anderer Key ihn via `replaces` beansprucht (`successorKey`
     * gesetzt) bzw. wenn der Key wieder im Code auftaucht (`null`). Optional —
     * Adapter ohne `successor_key`-Spalte lassen die Methoden weg, der Sync
     * überspringt die Pointer dann mit Warn-Log.
     */
    setFeatureSuccessor?(
        projectKey: string,
        featureKey: string,
        successorKey: string | null,
    ): Promise<FeatureCatalogEntryRow>;
    setQuotaSuccessor?(
        projectKey: string,
        quotaKey: string,
        successorKey: string | null,
    ): Promise<QuotaCatalogEntryRow>;

    findFeature(projectKey: string, featureKey: string): Promise<FeatureCatalogEntryRow | null>;
    findQuota(projectKey: string, quotaKey: string): Promise<QuotaCatalogEntryRow | null>;

    setFeatureReview(
        projectKey: string,
        featureKey: string,
        data: SetCatalogEntryReviewData,
    ): Promise<FeatureCatalogEntryRow>;
    setQuotaReview(
        projectKey: string,
        quotaKey: string,
        data: SetCatalogEntryReviewData,
    ): Promise<QuotaCatalogEntryRow>;

    setFeatureI18n(
        projectKey: string,
        featureKey: string,
        i18n: CatalogEntryI18n,
    ): Promise<FeatureCatalogEntryRow>;
    setQuotaI18n(
        projectKey: string,
        quotaKey: string,
        i18n: CatalogEntryI18n,
    ): Promise<QuotaCatalogEntryRow>;

    /** Setzt die editierbaren Basis-Felder (Default-Locale `label`/`description`). */
    setFeatureBase(
        projectKey: string,
        featureKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<FeatureCatalogEntryRow>;
    setQuotaBase(
        projectKey: string,
        quotaKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<QuotaCatalogEntryRow>;
}

// =============================================================================
// Promotion — Persistenz-Adapter (SPEC_V2 §9a — zeitgesteuerte Preis-Aktionen)
// =============================================================================

/**
 * Adapter für `promotions`. **Keine Versionierung** — Aktionen werden direkt
 * geändert (analog MarketingProjectionRepository). Konsumenten implementieren
 * das gegen ihre `promotions`-Prisma-Tabelle.
 */
export interface PromotionRepository {
    list(filter: PromotionFilter): Promise<PromotionRow[]>;
    findById(id: string): Promise<PromotionRow | null>;
    create(data: CreatePromotionData): Promise<PromotionRow>;
    update(id: string, data: UpdatePromotionData): Promise<PromotionRow>;
    /** Hard-Delete — keine Soft-Delete-Spalte (nicht versioniert). */
    delete(id: string): Promise<void>;
}

// =============================================================================
// MarketingSettings — Persistenz-Adapter (SPEC_V2 §6.5 — activeLocales)
// =============================================================================

/**
 * Adapter für `marketing_settings` — eine Row pro Projekt. `get` liefert
 * `null`, solange der SuperAdmin nichts gespeichert hat (dann gilt der volle
 * `availableLocales`-Pool als aktiv). `upsert` legt die Row an oder ersetzt sie.
 */
export interface MarketingSettingsRepository {
    get(projectKey: string): Promise<MarketingSettingsRow | null>;
    upsert(projectKey: string, data: UpdateMarketingSettingsData): Promise<MarketingSettingsRow>;
}
