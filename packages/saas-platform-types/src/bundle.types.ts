// BundleRow / BundleVersionRow — wire format of the Bundle table rows.
//
// These types are the HTTP projection of the Prisma models from
// `saas-platform-spec/prisma-fragments/05-bundle.prisma`. They are delivered
// by the AdminController for the SuperAdmin page "Bundles" and consumed by
// the platform UI (`saas-platform-ui-vue`).
//
// Conventions:
// - Monetary amounts are `string | null` (Prisma Decimal serialized as a
//   string, not as a number — otherwise loss). UI parses via `Number(s)`.
// - Versioned rows extend `VersionedEntityBase` (analogous to
//   PlanVersionRow).
// - Bundle master rows have no version fields.

import type { CatalogEntryI18n } from './catalog-entry.types.js';
import type { FeatureKey, QuotaKey } from './plan-catalog.types.js';
import type { VersionedEntityBase } from './subscription.types.js';

// =============================================================================
// Helper types
// =============================================================================

/**
 * Usage whitelist for a bundle. An empty/missing list means the bundle may
 * be used with any plan.
 */
export interface BundleCompatibility {
    /**
     * Whitelist of plan IDs; only these may use the bundle.
     * Empty/missing = all plans allowed.
     */
    planIds?: string[];
}

/**
 * Pricing override for a plan context.
 *
 * - `monthlyNet` / `yearlyNet` as string (Decimal wire format)
 * - `null` = explicit "free in this context"
 * - undefined / field missing = no override for this cycle
 */
export interface BundlePricingOverride {
    /** If set: override applies only with this plan. */
    planId?: string;
    monthlyNet?: string | null;
    yearlyNet?: string | null;
}

// =============================================================================
// Bundle (master + version)
// =============================================================================

/**
 * Bundle — reusable component of Features + Quotas + Pricing.
 * Master entity without content; the purchasable fields live on BundleVersionRow.
 */
export interface BundleRow {
    id: string;
    projectKey: string;
    bundleKey: string;
    label: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    /** Locale translations of `label`/`description` (SPEC_V2 §6.4). */
    i18n: CatalogEntryI18n;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

/**
 * BundleVersion — versioned composition (Features, Quotas, Pricing).
 * `quotas` is `Record<QuotaKey, number>`; `-1` = unlimited; a missing key
 * contributes 0.
 */
export interface BundleVersionRow extends VersionedEntityBase {
    bundleId: string;
    /** Denormalized for UI (avoids an extra lookup). */
    bundleKey: string;
    /** Denormalized for UI. */
    label: string;
    features: FeatureKey[];
    quotas: Record<QuotaKey, number>;
    compatibility: BundleCompatibility;
    pricingOverrides: BundlePricingOverride[];
    /** Default price; null = only via override pricing. */
    monthlyNet: string | null;
    yearlyNet: string | null;
    marketed: boolean;
}

// =============================================================================
// Service DTOs (Create/Update) — input format of the BundlesService methods
// =============================================================================

/**
 * Fields that must be set when creating a new bundle master.
 * `id`, `createdAt`, `updatedAt`, `deletedAt` are assigned by the repository.
 * Version-specific fields (Features, Quotas, Pricing) belong in the
 * first BundleVersion via `CreateBundleVersionDraftData`.
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
 * Fields that may be changed on the bundle master. `bundleKey` and
 * `projectKey` are intentionally not here — master identity is immutable;
 * whoever wants to change them creates a new bundle and retires the old one.
 */
export interface UpdateBundleData {
    label?: string;
    description?: string | null;
    icon?: string | null;
    sortOrder?: number;
    i18n?: CatalogEntryI18n;
}

/**
 * Fields of a new BundleVersion in draft status (`publishedAt = null`).
 * Created by the SuperAdmin, later published via `publishBundleVersion()`.
 * Only **one** draft version per bundle allowed
 * (see partial unique index in the migration).
 */
export interface CreateBundleVersionDraftData {
    bundleId: string;
    /** Predecessor version the diff is computed against (null for v1). */
    baseVersionId?: string | null;
    features: FeatureKey[];
    quotas?: Record<QuotaKey, number>;
    compatibility?: BundleCompatibility;
    pricingOverrides?: BundlePricingOverride[];
    monthlyNet?: string | null;
    yearlyNet?: string | null;
    marketed?: boolean;
    /** Required at publish (see contract protection P3 in SPEC_V2 §7). */
    changeNote?: string;
    /**
     * From when this version should be active for *new* bookings. Required
     * at the latest at publish (see `PublishBundleVersionData`); can
     * already be pre-noted in the draft. Format: ISO-8601 (`YYYY-MM-DD`).
     */
    validFrom?: string | null;
    /**
     * Optional; null = unlimited until superseded by a successor
     * version (auto succession). When a successor version is published it is
     * automatically set by the service to `successor.validFrom - 1 day`.
     */
    validUntil?: string | null;
    createdByUserId?: string | null;
}

/**
 * Fields of a draft BundleVersion that may still be changed.
 * With SPEC_V2 §11.1 M6 Pack 2c also for published-but-future versions
 * (latest-in-chain, 0 subs, validFrom > now) — see
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
     * New `validFrom` for the version. Freely settable when updating a
     * draft; for a published-but-future version the new date must still
     * lie in the future — the service checks that with
     * `isVersionEditable` against the freshly loaded state.
     */
    validFrom?: string | null;
    validUntil?: string | null;
}

/**
 * Input for `publishBundleVersion()`. `nonRegressive` and
 * `publishedChanges` are computed by the service from the diff against the
 * predecessor version (see SPEC_V2 §7); the caller supplies only confirmation
 * + user tag + validity dates.
 *
 * `validFrom` is **required** at publish (analogous to `PublishPlanVersionData`).
 * If the draft already carries a `validFrom`, it is optional here. The
 * service validates strictly > `validFrom` of the predecessor version and sets
 * its `validUntil` via auto succession to `validFrom - 1 day`.
 */
export interface PublishBundleVersionData {
    publishedByUserId: string | null;
    /**
     * If true and the diff classifies the version as regressive,
     * it is published anyway — relevant for bulk-publish MFA confirmation
     * (see SPEC_V2 §7 editor-UI obligations).
     */
    forceRegressive?: boolean;
    /**
     * Allows publish despite an explicit price of 0.00. Default false: an
     * explicit 0.00 publish is blocked (protection against seed placeholders).
     * `null` prices (override resolution) are not affected.
     */
    allowZeroPrice?: boolean;
    /**
     * Required at publish if the draft has no `validFrom`. Must lie
     * strictly after `validFrom` of the predecessor version. ISO-8601
     * (`YYYY-MM-DD` or full timestamp).
     */
    validFrom?: string | null;
    /**
     * Optional; null = valid indefinitely (fits the last version
     * of a bundle). When a successor version is created it is automatically
     * overwritten by the service.
     */
    validUntil?: string | null;
}

// =============================================================================
// Strict-mode check — drift between DB catalog and discovery snapshot
// =============================================================================

/**
 * Code of a strict-mode violation. SPEC_V2 §8.2 lists the eight rules
 * that are checked; each rule has its own code so the UI can show
 * focused help texts.
 */
export type StrictModeWarningCode =
    | 'CAPABILITY_MISSING' // Code capability does not exist in the DiscoverySnapshot
    | 'CAPABILITY_RETIRED' // Code capability was retired
    | 'FEATURE_MISSING' // Feature is not aggregated in the Discovery
    | 'FEATURE_PLANNED_ONLY' // Feature is marked plannedOnly (no code)
    | 'BUNDLE_FEATURE_UNKNOWN' // BundleVersion references a feature that does not exist
    | 'BUNDLE_PLAN_KEY_UNKNOWN' // BundleVersion.compatibility.planIds references a non-existent plan
    | 'PLAN_FEATURE_UNKNOWN' // PlanVersion references a feature that does not exist
    | 'PLAN_FEATURE_NOT_APPROVED' // PlanVersion references a non-approved feature (#20)
    | 'BUNDLE_FEATURE_NOT_APPROVED' // BundleVersion references a non-approved feature (#20)
    | 'PLAN_FEATURE_DEPENDENCY_UNSATISFIED' // Plan feature has a requires that the plan does not contain (#35, advisory)
    | 'BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED' // Bundle feature has a requires that the bundle does not contain (#35, advisory)
    | 'QUOTA_MISSING' // QuotaKey without @DefinesQuota in the code
    | 'QUOTA_NOT_APPROVED' // Quota exists but is not approved (#20)
    | 'VERSION_PUBLISH_OVERLAP'; // Multiple marketed versions with overlapping periods

/**
 * A strict-mode violation. `field` points to the violating field
 * (e.g. `'features[3]'`), `value` is the concrete value (e.g. `'INVENTORY'`).
 */
export interface StrictModeWarning {
    code: StrictModeWarningCode;
    /** Human-readable reason (German). */
    message: string;
    /** Path to the violating field; optional. */
    field?: string;
    /** The concrete violating value; optional. */
    value?: string;
}

/**
 * Service result for mutating Bundle operations
 * (createDraft, updateDraft, publish): returns the persisted row plus
 * a list of strict-mode warnings. In `warn-only` mode the
 * warnings go into the UI as a banner; in `blocking` mode the service throws
 * HTTP 422 instead, with the same warning list as the body.
 */
export interface BundleVersionMutationResult {
    bundleVersion: BundleVersionRow;
    warnings: StrictModeWarning[];
}
