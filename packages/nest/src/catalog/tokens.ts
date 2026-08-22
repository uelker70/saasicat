// DI tokens for the Catalog module (Bundle, MarketingProjection,
// CapabilityCatalogEntry, FeatureCatalogEntry).
//
// Consumers inject their adapter implementations via these tokens
// into `CatalogModule.forRoot({...})`.

/** Repository for `plans` (Plan master CRUD). */
export const PLAN_REPOSITORY_TOKEN = Symbol.for('saasicat/nest/PlanRepository');

/** Repository for `bundles` + `bundle_versions`. */
export const BUNDLE_REPOSITORY_TOKEN = Symbol.for('saasicat/nest/BundleRepository');

/** Repository for `marketing_projections`. */
export const MARKETING_PROJECTION_REPOSITORY_TOKEN = Symbol.for(
    'saasicat/nest/MarketingProjectionRepository',
);

/**
 * Repository for `capability_catalog_entries`, `feature_catalog_entries`
 * and `quota_catalog_entries` (Discovery review).
 */
export const CATALOG_ENTRY_REPOSITORY_TOKEN = Symbol.for('saasicat/nest/CatalogEntryRepository');

/** Repository for `promotions` (time-scheduled price campaigns). */
export const PROMOTION_REPOSITORY_TOKEN = Symbol.for('saasicat/nest/PromotionRepository');

/** Repository for `marketing_settings` (activeLocales). */
export const MARKETING_SETTINGS_REPOSITORY_TOKEN = Symbol.for(
    'saasicat/nest/MarketingSettingsRepository',
);

/**
 * Service configuration: current app identity, strict mode.
 * Provided by CatalogModule.forRoot().
 */
export const CATALOG_SERVICE_CONFIG_TOKEN = Symbol.for('saasicat/nest/CatalogServiceConfig');

/**
 * Optional consumer-curated FeatureUiRegistry (label/description/icon per
 * Feature). Feeds the Discovery auto-sync: empty `FeatureCatalogEntry` fields
 * are seeded from it at boot (SuperAdmin edits remain untouched), so that
 * the DB becomes the SSOT for UI metadata.
 *
 * Distinct from `billing/feature-ui-registry.tokens.ts`, which carries the
 * registry for the PUBLIC catalog endpoints. Same exported name, different
 * token on purpose — an app may curate the two surfaces differently. The key
 * is namespaced accordingly so the two never collide.
 */
export const FEATURE_UI_REGISTRY_TOKEN = Symbol.for('saasicat/nest/CatalogFeatureUiRegistry');
