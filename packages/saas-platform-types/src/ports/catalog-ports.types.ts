import type { TransactionContext } from './core-ports.types.js';
import type {
    BundleRow,
    BundleVersionRow,
    CreateBundleData,
    CreateBundleVersionDraftData,
    UpdateBundleData,
    UpdateBundleVersionDraftData,
} from '../bundle.types.js';
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
// Bundle / BundleVersion — persistence adapter (SPEC_V2 §5 + §11.1 M3)
// =============================================================================

/** Filter for `PlanRepository.list()`. */
export interface PlanListFilter {
    projectKey: string;
    /** Exclude soft-deleted plans — default `true`. */
    excludeDeleted?: boolean;
    /**
     * Only plans with at least one live version
     * (`publishedAt` set, `supersededAt` null). Default `false` — plan
     * management still lists drafts as well. Selection masks (e.g.
     * pilot setup) set `true` so that no unbookable plans appear.
     */
    onlyPublished?: boolean;
}

/**
 * Adapter for `Plan` stem + `PlanVersion` lifecycle persistence
 * (SPEC_V2 §11.1 M6). Consumers implement this against the Prisma
 * tables `plans` + `plan_versions`.
 *
 * Pack 1 (CRUD stem) and Pack 2a (lifecycle) live in one interface,
 * analogous to `BundleRepository` — but the lifecycle methods are **optional**
 * (apps without a SuperAdmin editor do not implement them; CatalogModule
 * then does not register `PlanVersionsService`).
 *
 * Binding for lifecycle:
 * - `createDraft` may only succeed if no other draft version
 *   exists for the same `planId` (partial unique index in the SQL
 *   migration).
 * - `publishDraft` sets `publishedAt = NOW()`, `publishedChanges`,
 *   `nonRegressive`, `publishedByUserId` on the draft — and supersedes the
 *   previously live version (same `planId`, `publishedAt IS NOT NULL`,
 *   `supersededAt IS NULL`) to `supersededAt = NOW()`. Both in one
 *   transaction.
 */
export interface PlanRepository {
    // ─── Stem operations (Pack 1) ───
    list(filter: PlanListFilter): Promise<PlanRow[]>;
    findById(planId: string): Promise<PlanRow | null>;
    findByKey(projectKey: string, planKey: string): Promise<PlanRow | null>;
    create(data: CreatePlanData): Promise<PlanRow>;
    update(planId: string, data: UpdatePlanData): Promise<PlanRow>;
    /** Sets `deletedAt` to NOW(); soft-deleted plans are filtered from `list` by default. */
    softDelete(planId: string): Promise<void>;

    /**
     * Hard-removes the plan stem from the DB (no `deletedAt`, no
     * recovery path). The service only calls this method after it has
     * verified that no `PlanVersion` still exists — consumers
     * may rely on the table being empty. If the
     * method is not implemented, the service responds with 422
     * `PLAN_HARD_DELETE_NOT_IMPLEMENTED`.
     */
    hardDelete?(planId: string): Promise<void>;

    // ─── Lifecycle operations (Pack 2a, optional) ───
    //
    // **Important:** The lifecycle methods take the **planKey**
    // (e.g. "STARTER"), not the plan UUID. Reason: the greenfield
    // binding runs via `PlanVersion.planId === Plan.planKey` as a
    // string match (see SPEC_V2 §11.1 M6: no FK until the importer
    // cutover). The `PlanVersionsService` resolves the plan UUID of the
    // controller path param via `findById(planUuid).planKey` before it
    // calls these methods.

    /**
     * Returns all versions of a plan stem (drafts + published +
     * superseded), sorted by `version` ascending.
     */
    listVersions?(planKey: string): Promise<PlanVersionRow[]>;
    findVersionById?(versionId: string): Promise<PlanVersionRow | null>;
    findCurrentDraft?(planKey: string): Promise<PlanVersionRow | null>;
    /**
     * Currently published (= live) PlanVersion of a plan:
     * `publishedAt IS NOT NULL AND supersededAt IS NULL`.
     *
     * Note: returns the *newest* published version by
     * `version` number and ignores `validFrom`/`validUntil`. For
     * time-aware reads (onboarding, marketing catalog, entitlement
     * fallback) use `findActivePlanVersion(planKey, asOf)`, which returns
     * the version *active at a point in time*.
     */
    findLatestLivePlanVersion?(
        planKey: string,
        tx?: TransactionContext,
    ): Promise<PlanVersionRow | null>;

    /**
     * PlanVersion of a plan active at `asOf` (SPEC_V2 §4.2 extended):
     *   `publishedAt IS NOT NULL`
     *   `(validFrom IS NULL OR validFrom <= asOf)`
     *   `(validUntil IS NULL OR validUntil >= startOfUtcDay(asOf))`  — day-inclusive
     *
     * `validFrom IS NULL` is treated like "valid since forever" so that legacy data
     * without a start date (published before the §4.2 publish requirement) does not
     * fall out of the catalog. `validUntil` is day-inclusive (calendar day): the version
     * is valid until the end of its validUntil day, not just until midnight.
     * Adapters build the WHERE via `buildActivePlanVersionWhere`.
     *
     * If multiple match: the one with the highest `validFrom` (= the
     * "last active"); NULL sorts last, so it remains a genuine fallback.
     * Default `asOf` is the call time.
     *
     * Usage: everything that concerns *new* bookings/plan changes
     * (onboarding, public marketing, entitlement fallback on TRIAL).
     * Existing subscriptions stay on their bound `planVersionId`
     * (P1 contract protection).
     */
    findActivePlanVersion?(
        planKey: string,
        asOf?: Date,
        tx?: TransactionContext,
    ): Promise<PlanVersionRow | null>;

    /**
     * Creates a new draft version (`publishedAt = null`). Throws if
     * a draft already exists (partial unique index violation).
     * Computes `version` as `MAX(version) + 1` over all versions of the
     * `planId`.
     */
    createPlanVersionDraft?(data: CreatePlanVersionDraftData): Promise<PlanVersionRow>;
    updatePlanVersionDraft?(
        versionId: string,
        data: UpdatePlanVersionDraftData,
    ): Promise<PlanVersionRow>;
    /**
     * Publishes a draft version atomically (SPEC_V2 §4.2 + §11.1 M6 Pack 2a):
     * 1. Sets `publishedAt = NOW()`, `publishedChanges`, `nonRegressive`,
     *    `publishedByUserId`, `validFrom` on the draft.
     * 2. Sets `supersededAt = NOW()` on the previously live version AND
     *    `validUntil = validFrom - 1 day` (auto-succession).
     * 3. Sets `validUntil` on the new version (optional, default null = unbounded).
     */
    publishPlanVersionDraft?(
        versionId: string,
        publishMeta: {
            publishedByUserId: string | null;
            publishedChanges: VersionChange[];
            nonRegressive: boolean;
            /** Required — validated by the service before the repository call. */
            validFrom: Date;
            validUntil: Date | null;
        },
        tx?: TransactionContext,
    ): Promise<PlanVersionRow>;

    /**
     * Hard-discards a draft version (`publishedAt === null`) from the DB.
     * Throws if the version was already published — published versions
     * remain immutable (audit + existing subscriptions
     * reference them). If the version does not exist, discard is
     * a no-op (the caller may have already used a different path in parallel).
     */
    deletePlanVersionDraft?(versionId: string): Promise<void>;

    /**
     * Sets the `endsAt` date chosen by the SuperAdmin on a **published**
     * PlanVersion (`publishedAt != null && supersededAt == null`). Idempotent —
     * a second call with a different date overwrites the field.
     *
     * Service-side preconditions (live + future date) are checked by the
     * `PlanVersionsService`; the adapter only persists. If the
     * method is not implemented, the service responds with 422
     * `PLAN_TERMINATE_NOT_IMPLEMENTED`.
     */
    terminate?(versionId: string, endsAt: Date): Promise<PlanVersionRow>;
}

/** Filter for `BundleRepository.list()`. */
export interface BundleListFilter {
    projectKey: string;
    /** Exclude soft-deleted bundles — default `true`. */
    excludeDeleted?: boolean;
}

/**
 * Adapter for `Bundle` + `BundleVersion` persistence. Consumers implement
 * this against their Prisma tables (`bundles` + `bundle_versions`).
 *
 * Binding:
 * - `createDraft` may only succeed if no other draft version
 *   exists for the same `bundleId` (partial unique index in the SQL
 *   migration; see the README in the Prisma fragment).
 * - `publishDraft` sets `publishedAt = NOW()`, `publishedChanges`,
 *   `nonRegressive`, `publishedByUserId` — and supersedes the previously live
 *   version (same `bundleId`, `publishedAt IS NOT NULL`,
 *   `supersededAt IS NULL`) to `supersededAt = NOW()`.
 * - Operations that need atomicity may optionally accept a
 *   `TransactionContext`.
 */
export interface BundleRepository {
    // ─── Stem operations ───
    list(filter: BundleListFilter): Promise<BundleRow[]>;
    findById(bundleId: string): Promise<BundleRow | null>;
    findByKey(projectKey: string, bundleKey: string): Promise<BundleRow | null>;
    create(data: CreateBundleData): Promise<BundleRow>;
    update(bundleId: string, data: UpdateBundleData): Promise<BundleRow>;
    /** Sets `deletedAt` to NOW(); soft-deleted bundles are filtered from `list` by default. */
    softDelete(bundleId: string): Promise<void>;

    // ─── Version operations ───
    listVersions(bundleId: string): Promise<BundleVersionRow[]>;
    findVersionById(versionId: string): Promise<BundleVersionRow | null>;
    findCurrentDraft(bundleId: string): Promise<BundleVersionRow | null>;
    /**
     * Currently published (= live) BundleVersion of a bundle:
     * `publishedAt IS NOT NULL AND supersededAt IS NULL`.
     */
    findLatestLive(bundleId: string, tx?: TransactionContext): Promise<BundleVersionRow | null>;

    /**
     * Creates a new draft version (`publishedAt = null`). Throws if
     * a draft already exists (partial unique index violation).
     * Computes `version` as `MAX(version) + 1` over all versions of the
     * `bundleId`.
     */
    createDraft(data: CreateBundleVersionDraftData): Promise<BundleVersionRow>;
    updateDraft(versionId: string, data: UpdateBundleVersionDraftData): Promise<BundleVersionRow>;

    /**
     * Publishes a draft version atomically (SPEC_V2 §4.2 + §11.1 M6
     * Pack 2c, analogous to `PlanRepository.publishPlanVersionDraft`):
     * 1. Sets `publishedAt = NOW()`, `publishedChanges`, `nonRegressive`,
     *    `publishedByUserId`, `validFrom` on the draft.
     * 2. Sets `supersededAt = NOW()` on the previously live version (if
     *    present) AND its `validUntil = validFrom - 1 day`
     *    (auto-succession).
     * 3. Sets `validUntil` on the new version (optional, default null
     *    = unbounded).
     *
     * All steps run in one transaction (consumers usually pass
     * through a `TransactionRunner`). Pre-checked on the service side:
     * `validFrom > previous.validFrom`, gapless constraint
     * if the predecessor carries a `validUntil` — the adapter only
     * persists, it does not validate again.
     */
    publishDraft(
        versionId: string,
        publishMeta: {
            publishedByUserId: string | null;
            publishedChanges: VersionChange[];
            nonRegressive: boolean;
            /** Required — validated by the service before the repository call. */
            validFrom: Date;
            validUntil: Date | null;
        },
        tx?: TransactionContext,
    ): Promise<BundleVersionRow>;

    /**
     * Hard-discards a draft version (`publishedAt === null`) from the DB.
     * Throws if the version was already published — published versions
     * remain immutable (contract protection P1). If the version
     * does not exist, discard is a no-op (the caller may have already used
     * a different path in parallel).
     *
     * Optional for backwards-compat reasons — if the adapter does not
     * implement it, the service responds with 422
     * `BUNDLE_VERSION_DISCARD_NOT_IMPLEMENTED`.
     */
    deleteDraft?(versionId: string): Promise<void>;
}

// =============================================================================
// MarketingProjection — persistence adapter (SPEC_V2 §11.1 M3)
// =============================================================================

/**
 * Adapter for `marketing_projections`. **No versioning** — per
 * (`targetType`, `targetVersionId`, `locale`) there is exactly one row
 * that is edited directly. Marketing edits go live immediately, because they
 * only control the public catalog display, not existing subscriptions.
 *
 * Uniqueness over (`targetType`, `targetVersionId`, `locale`) is
 * enforced as a unique index in the DB schema — `create` with a conflict throws.
 */
export interface MarketingProjectionRepository {
    list(filter: MarketingProjectionFilter): Promise<MarketingProjectionRow[]>;
    findById(id: string): Promise<MarketingProjectionRow | null>;
    /**
     * Finds a projection by the triple
     * (`targetType`, `targetVersionId`, `locale`).
     */
    findByTarget(
        targetType: string,
        targetVersionId: string,
        locale: string,
    ): Promise<MarketingProjectionRow | null>;

    create(data: CreateMarketingProjectionData): Promise<MarketingProjectionRow>;
    update(id: string, data: UpdateMarketingProjectionData): Promise<MarketingProjectionRow>;
    /** Hard delete — no soft-delete column (not versioned). */
    delete(id: string): Promise<void>;
}

// =============================================================================
// CatalogEntry — persistence adapter (SPEC_V2 §6.3 — discovery review)
// =============================================================================

/** Upsert input for a capability from the discovery sync. */
export interface UpsertCapabilityEntryData {
    projectKey: string;
    capabilityKey: string;
    label: string;
    description: string | null;
    featureKey: string | null;
    bundleKey: string | null;
    /** Read-only code fact from the snapshot (#20) — the sync always overwrites. */
    codeStatus: CapabilityCodeStatus;
    owner: string | null;
    kind: CapabilityCatalogEntryRow['kind'];
    replacementKey: string | null;
    deprecatedAt: string | null;
    removalPlannedAt: string | null;
    reason: string | null;
}

/** Upsert input for a feature from the discovery sync. */
export interface UpsertFeatureEntryData {
    projectKey: string;
    featureKey: string;
    label: string;
    description: string | null;
    discoveryStatus: DiscoveryStatus;
    /** Code-discovered feature dependencies (#35) — the sync always overwrites. */
    requires: string[];
    /** Old feature keys that this feature replaces (#39) — the sync always overwrites. */
    replaces: string[];
    /** true = base/always included (not bookable per plan). Deterministic from the registry. */
    core?: boolean;
}

/** Upsert input for a quota from the discovery sync. */
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
    /** Old quotaKeys that this quota replaces (#39) — the sync always overwrites. */
    replaces: string[];
}

/**
 * Review update of a feature/quota (`setFeatureReview`/
 * `setQuotaReview`). The service has already validated the transition and
 * resolved the approval fields — the adapter persists all four fields 1:1
 * (`null` clears).
 */
export interface SetCatalogEntryReviewData {
    discoveryStatus: DiscoveryStatus;
    approvedAt: string | null;
    approvedBy: string | null;
    approvedSignature: string | null;
}

/**
 * Adapter for `capability_catalog_entries`, `feature_catalog_entries` and
 * `quota_catalog_entries`. Consumers implement this against their
 * Prisma tables.
 *
 * Binding:
 * - `upsert*` matches on (`projectKey`, `<key>`) and leaves `i18n`,
 *   `sortOrder`, `createdAt` as well as the approval fields (`approvedAt`/
 *   `approvedBy`/`approvedSignature`) **untouched** on an update —
 *   only the code-derived fields + the status (resolved by the service)
 *   are written.
 * - `retireMissing` marks all non-soft-deleted entries whose key
 *   is not in `presentKeys`: capabilities → `codeStatus = 'retired'`,
 *   features/quotas → `discoveryStatus = 'obsolete'`. Returns the count.
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
     * Sets or clears the successor pointer of a feature/quota
     * (#39). The sync calls this when a key disappears from the snapshot
     * and another key claims it via `replaces` (`successorKey`
     * set), or when the key reappears in the code (`null`). Optional —
     * adapters without a `successor_key` column omit the methods, and the sync
     * then skips the pointers with a warn log.
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

    /** Sets the editable base fields (default locale `label`/`description`). */
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
// Promotion — persistence adapter (SPEC_V2 §9a — time-scheduled price promotions)
// =============================================================================

/**
 * Adapter for `promotions`. **No versioning** — promotions are edited
 * directly (analogous to MarketingProjectionRepository). Consumers implement
 * this against their `promotions` Prisma table.
 */
export interface PromotionRepository {
    list(filter: PromotionFilter): Promise<PromotionRow[]>;
    findById(id: string): Promise<PromotionRow | null>;
    create(data: CreatePromotionData): Promise<PromotionRow>;
    update(id: string, data: UpdatePromotionData): Promise<PromotionRow>;
    /** Hard delete — no soft-delete column (not versioned). */
    delete(id: string): Promise<void>;
}

// =============================================================================
// MarketingSettings — persistence adapter (SPEC_V2 §6.5 — activeLocales)
// =============================================================================

/**
 * Adapter for `marketing_settings` — one row per project. `get` returns
 * `null` as long as the SuperAdmin has saved nothing (then the full
 * `availableLocales` pool counts as active). `upsert` creates the row or replaces it.
 */
export interface MarketingSettingsRepository {
    get(projectKey: string): Promise<MarketingSettingsRow | null>;
    upsert(projectKey: string, data: UpdateMarketingSettingsData): Promise<MarketingSettingsRow>;
}
