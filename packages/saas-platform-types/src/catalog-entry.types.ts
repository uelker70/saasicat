// CapabilityCatalogEntryRow / FeatureCatalogEntryRow / MarketingProjectionRow
// — Wire format of the catalog-entries tables.
//
// These types are the HTTP projection of the Prisma models from
// `saas-platform-spec/prisma-fragments/06-catalog-entries.prisma`. They are
// served by the AdminController for the SuperAdmin pages "Discovery" +
// "Marketing Catalog", and by the Public-Catalog-Controller for `/public/catalog`.

// =============================================================================
// Discovery lifecycle (approval per feature + quota, #20)
// =============================================================================

/**
 * Approval lifecycle of a feature or a quota. Approval happens per
 * FEATURE/QUOTA — not per capability (#20); only `approved` entries
 * are sellable (gate in strict-mode-check/seed-gate/preflight).
 *
 * - `pending`  — found in code, not yet approved; not available for
 *                planning
 * - `approved` — approved by the SuperAdmin for plans, bundles & marketing;
 *                the approval signature freezes the code state
 * - `outdated` — drift: the implementation has changed since approval
 *                (approval signature ≠ current snapshot) or was manually
 *                marked stale — re-approve
 * - `obsolete` — deprecated or removed from code; no longer use in new
 *                plans
 *
 * A "replaced by X" (#39) is deliberately NOT its own status value: the union
 * is consumed exhaustively (review state machine as `Record<DiscoveryStatus, …>`,
 * status badges in the AdminUI, status columns in the consumer DBs) — a new
 * value would force lockstep migrations across all consumers. Instead:
 * `obsolete` + `successorKey` as a successor pointer; old readers degrade
 * gracefully (still see `obsolete`).
 */
export type DiscoveryStatus = 'pending' | 'approved' | 'outdated' | 'obsolete';

/**
 * Code status of a capability — read-only code fact from the scan (#20):
 * `active`/`experimental`/`deprecated` come from the decorator, `retired`
 * is set by the sync when the capability has disappeared from the code.
 * Capabilities no longer carry a review status; the business approval
 * lives on the feature/the quota.
 */
export type CapabilityCodeStatus = 'active' | 'experimental' | 'deprecated' | 'retired';

/**
 * Implementation kind of a capability — corresponds to `kind` in the
 * `@ImplementsCapability(...)` decorator.
 */
export type CapabilityKind = 'endpoint' | 'service' | 'job' | 'event';

/**
 * Enforcement mode of a quota:
 * - `hard` — exceeding blocks at the business level (corresponds to policy `hardCap`)
 * - `soft` — exceeding is only counted/warned
 */
export type QuotaEnforcementMode = 'hard' | 'soft';

/**
 * Locale-specific translation fields of a catalog entry. Empty/missing
 * fields fall back in the UI to the default locale (`de`). `unit` is only
 * relevant for quotas.
 */
export interface CatalogEntryI18nFields {
    label?: string;
    description?: string;
    unit?: string;
}

/** `{ 'en': { label, description }, 'tr': { … } }` — the default locale is intentionally absent. */
export type CatalogEntryI18n = Record<string, CatalogEntryI18nFields>;

// =============================================================================
// CapabilityCatalogEntry
// =============================================================================

/**
 * SuperAdmin projection of a code-declared capability. The business
 * truth (exists / does not exist) stays in the code; this table holds
 * the code status (read-only fact, #20) and denormalized aggregation
 * shells for UI lookups. Approval lives on the feature/the quota.
 */
export interface CapabilityCatalogEntryRow {
    id: string;
    projectKey: string;
    capabilityKey: string;
    label: string;
    description: string | null;

    /** Aggregation shell from the decorator (denormalized for UI lookup). */
    featureKey: string | null;
    /** Aggregation shell from the decorator (denormalized). */
    bundleKey: string | null;

    codeStatus: CapabilityCodeStatus;
    /** Code owner tag from the decorator (e.g. 'accounting'). */
    owner: string | null;
    kind: CapabilityKind;

    /** Recommended when codeStatus = 'deprecated'. */
    replacementKey: string | null;
    deprecatedAt: string | null;
    removalPlannedAt: string | null;
    reason: string | null;

    /** Locale translations (discovery translation tab, SPEC_V2 §6.3). */
    i18n: CatalogEntryI18n;

    sortOrder: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

// =============================================================================
// FeatureCatalogEntry
// =============================================================================

/**
 * Tier hint for comparison-matrix sorting. Convention:
 * `CORE` < `ADVANCED` < `PRO` < `ENTERPRISE`. Apps may add further
 * tiers; sorting then happens via `FeatureCatalogEntry.sortOrder`.
 */
export type FeatureTier = 'CORE' | 'ADVANCED' | 'PRO' | 'ENTERPRISE' | string;

/**
 * SuperAdmin projection of a feature (aggregation of capabilities that declare
 * `feature: 'XYZ'` in the decorator). The short marketing form lives here;
 * locale-specific long texts in MarketingProjectionRow.
 */
export interface FeatureCatalogEntryRow {
    id: string;
    projectKey: string;
    featureKey: string;
    label: string;
    description: string | null;

    /** Short marketing label for sidebar / comparison matrix. */
    marketingLabel: string | null;
    /** Short marketing description. For long locale texts: MarketingProjectionRow. */
    marketingDescription: string | null;
    icon: string | null;

    tier: FeatureTier | null;
    discoveryStatus: DiscoveryStatus;

    /** Code-discovered feature dependencies (#35) — empty list = none. */
    requires: string[];
    /** Old feature keys that this feature supersedes (#39) — empty list = none. */
    replaces: string[];
    /**
     * Successor pointer (#39): set when this key has disappeared from the
     * code AND another snapshot key claims it via `replaces` — "replaced by
     * X = guided migration" instead of a bare `obsolete` (= deleted without
     * replacement).
     */
    successorKey: string | null;

    /** Timestamp of the last approval; `null` while never approved. */
    approvedAt: string | null;
    /** User ID of the approving SuperAdmin. */
    approvedBy: string | null;
    /**
     * Signature of the capability set at approval time
     * (`capabilityKey@codeStatus`, sorted, `|`-separated). The auto-sync
     * compares it against the current snapshot — on divergence,
     * `approved` → `outdated` (drift, #20).
     */
    approvedSignature: string | null;

    /**
     * `true` = the feature is planned in the SuperAdmin plan but not yet
     * implemented in the code. The blocking strict-mode check (SPEC_V2 §8.1)
     * rejects plan publish with `plannedOnly` features.
     */
    plannedOnly: boolean;

    /** true = base/always included (not bookable per plan). */
    core: boolean;

    /** Locale translations (discovery translation tab, SPEC_V2 §6.3). */
    i18n: CatalogEntryI18n;

    sortOrder: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

// =============================================================================
// QuotaCatalogEntry
// =============================================================================

/**
 * SuperAdmin projection of a code-declared quota (`@DefinesQuota`).
 * Carries the review status as well as deploy relevance: a hard quota
 * without `usageProvider` is not deployable (SPEC_V2 §6.3, Preflight).
 */
export interface QuotaCatalogEntryRow {
    id: string;
    projectKey: string;
    quotaKey: string;
    label: string;
    description: string | null;

    /** Display unit, e.g. `members`, `GB`, `/month`. */
    unit: string;
    /** Aggregation shell from the decorator (denormalized). */
    featureKey: string | null;

    /**
     * Class that declares the quota via `@DefinesQuota` (= UsageProvider).
     * `null` = the quota is referenced (`@EnforceQuota`) but provided by no
     * class — deploy-blocking when `enforcementMode: 'hard'`.
     */
    usageProvider: string | null;
    enforcementMode: QuotaEnforcementMode;

    discoveryStatus: DiscoveryStatus;

    /** Old quota keys that this quota supersedes (#39) — empty list = none. */
    replaces: string[];
    /** Successor pointer (#39), analogous to `FeatureCatalogEntryRow.successorKey`. */
    successorKey: string | null;

    /** Timestamp of the last approval; `null` while never approved. */
    approvedAt: string | null;
    /** User ID of the approving SuperAdmin. */
    approvedBy: string | null;
    /**
     * Signature of the code-derived quota facts at approval time
     * (`unit|enforcementMode|usageProvider|featureKey`). The auto-sync
     * compares it against the current snapshot — on divergence,
     * `approved` → `outdated` (drift, #20).
     */
    approvedSignature: string | null;

    /** Locale translations (`label`, `unit`, `description`). */
    i18n: CatalogEntryI18n;

    sortOrder: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

// =============================================================================
// Catalog entry service DTOs (Review / Sync / i18n)
// =============================================================================

/**
 * Filter for `CatalogEntryRepository.list*()`. `discoveryStatus` applies to
 * features/quotas, `codeStatus` to capabilities — per list, only the
 * matching field is relevant.
 */
export interface CatalogEntryFilter {
    projectKey: string;
    discoveryStatus?: DiscoveryStatus;
    codeStatus?: CapabilityCodeStatus;
}

/**
 * Body of `PATCH …/{features,quotas}/:key/review` — the target status of
 * the approval state machine. The service validates the allowed transitions
 * (`pending → approved/obsolete`, `approved → pending/outdated/obsolete`,
 * `outdated → approved/pending/obsolete`, `obsolete → pending`).
 */
export interface ReviewCatalogEntryData {
    discoveryStatus: DiscoveryStatus;
}

/**
 * Approved gate (#20 Slice 5): the sets of approved feature/quota keys
 * (`discoveryStatus = 'approved'`) from the catalog entries. Strict-mode
 * check, Seed-Gate and Preflight use them to enforce "only approved is
 * sellable" — `null`/omitted skips the approval part (e.g. when no
 * CatalogEntryRepository is registered).
 */
export interface ApprovedCatalogKeys {
    features: ReadonlySet<string>;
    quotas: ReadonlySet<string>;
}

/** Body of `PATCH …/{features,quotas}/:key/i18n`. */
export interface UpdateCatalogEntryI18nData {
    /** Complete i18n tree — replaces the existing one. */
    i18n: CatalogEntryI18n;
}

/**
 * Body of `PATCH …/{features,quotas}/:key` — editable base/default locale
 * fields (`de`). Quotas: `unit` stays code-derived and is not editable —
 * but is translatable per locale via `i18n`.
 */
export interface UpdateCatalogEntryBaseData {
    label?: string;
    description?: string | null;
    /** Feature-only (#13): static default icon (Quasar icon name). Quotas ignore it. */
    icon?: string | null;
    /** Feature-only (#13): tier hint (open union). Quotas ignore it. */
    tier?: FeatureTier | null;
}

/**
 * Result of `POST …/discovery/sync` — counters for the UI.
 * `discovered`/`retired` are scan events (new in code / disappeared from
 * code); `outdated` counts `approved` entries that the sync flipped to
 * `outdated` due to signature drift (#20). `replaced` counts entries to
 * which the sync assigned a successor pointer (`successorKey`) in this run
 * (#39).
 */
export interface SyncDiscoveryResult {
    capabilities: { discovered: number; retired: number; total: number };
    features: {
        discovered: number;
        retired: number;
        outdated: number;
        replaced: number;
        total: number;
    };
    quotas: {
        discovered: number;
        retired: number;
        outdated: number;
        replaced: number;
        total: number;
    };
}

// =============================================================================
// MarketingProjection
// =============================================================================

/**
 * Polymorphic target type of a MarketingProjection. References the
 * versioned entity (plan, bundle, or business-type version) that is
 * marketed publicly.
 */
export type MarketingTargetType = 'PLAN' | 'BUNDLE' | 'BUSINESS_TYPE';

/**
 * A top-feature entry in the public-catalog card.
 *
 * - `key` — optional reference to a feature/quota key. If `key` is
 *   set and `label` is empty, the displayed label is resolved (translated)
 *   from the `FeatureCatalogEntry`/`QuotaCatalogEntry` in the respective
 *   locale. This keeps the card language-reactive.
 * - `label` — free text or override; empty + `key` set = auto label.
 * - `strong` — optional bold-set addition (e.g. "up to 100", "5 GB").
 */
export interface MarketingTopFeature {
    key?: string;
    label: string;
    strong: string;
}

/**
 * Locale-specific marketing texts per plan/bundle/business-type version.
 * Read and projected by the Public-Catalog-Controller
 * (`GET /public/catalog?locale=de`).
 *
 * Polymorphic reference via (`targetType`, `targetVersionId`) — no FK,
 * app logic checks existence on read.
 */
export interface MarketingProjectionRow {
    id: string;
    projectKey: string;

    targetType: MarketingTargetType;
    targetVersionId: string;

    /** ISO-639-1, optionally with region suffix (`de`, `en`, `de-AT`). */
    locale: string;

    displayLabel: string;
    description: string;

    /**
     * Visibility in the public catalog. `false` = the projection exists,
     * but the plan is not shown on the pricing page (e.g. during
     * preparation).
     */
    visible: boolean;

    /**
     * Optional badge at the top of the card (e.g. "Popular", "New"). Empty
     * string = no badge.
     */
    badge: string;

    /**
     * Top features that appear prominently on the public-catalog card.
     * Order is the display order.
     */
    topFeatures: MarketingTopFeature[];

    /** Free trial active — controls the automatic CTA text. */
    trialEnabled: boolean;
    /** Length of the trial in days (only relevant when `trialEnabled`). */
    trialDays: number;

    /**
     * Optional formatted price tag (e.g. "€ 9.90 / month" or "on
     * request"). null = pricing is formatted automatically from
     * PlanVersion.monthlyNet etc. at render time.
     */
    priceTag: string | null;

    /**
     * Overrides the automatically generated call-to-action text
     * (e.g. "Get in touch"). null = auto text from trial/pricing.
     */
    ctaLabel: string | null;

    /** Sorting in the public list (DESC). Higher values first. */
    priority: number;
    /** "Recommended" star or featured highlight in the UI. */
    highlight: boolean;

    createdAt: string;
    updatedAt: string;
}

// =============================================================================
// MarketingProjection service DTOs (Create/Update/Filter)
// =============================================================================

/** Filter for `MarketingProjectionRepository.list()`. At least projectKey. */
export interface MarketingProjectionFilter {
    projectKey: string;
    targetType?: MarketingTargetType;
    targetVersionId?: string;
    locale?: string;
}

export interface CreateMarketingProjectionData {
    projectKey: string;
    targetType: MarketingTargetType;
    targetVersionId: string;
    locale?: string;
    displayLabel: string;
    description: string;
    visible?: boolean;
    badge?: string;
    topFeatures?: MarketingTopFeature[];
    trialEnabled?: boolean;
    trialDays?: number;
    priceTag?: string | null;
    ctaLabel?: string | null;
    priority?: number;
    highlight?: boolean;
}

export interface UpdateMarketingProjectionData {
    displayLabel?: string;
    description?: string;
    visible?: boolean;
    badge?: string;
    topFeatures?: MarketingTopFeature[];
    trialEnabled?: boolean;
    trialDays?: number;
    priceTag?: string | null;
    ctaLabel?: string | null;
    priority?: number;
    highlight?: boolean;
}
