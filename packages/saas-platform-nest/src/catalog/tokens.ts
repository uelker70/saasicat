// DI tokens for the Catalog module (Bundle, MarketingProjection,
// CapabilityCatalogEntry, FeatureCatalogEntry).
//
// Consumers inject their adapter implementations via these tokens
// into `CatalogModule.forRoot({...})`.

/** Repository for `plans` (SPEC_V2 §11.1 M6 — Plan master CRUD). */
export const PLAN_REPOSITORY_TOKEN = Symbol.for('saas-platform/PlanRepository');

/** Repository for `bundles` + `bundle_versions`. */
export const BUNDLE_REPOSITORY_TOKEN = Symbol.for('saas-platform/BundleRepository');

/** Repository for `marketing_projections`. */
export const MARKETING_PROJECTION_REPOSITORY_TOKEN = Symbol.for(
    'saas-platform/MarketingProjectionRepository',
);

/**
 * Repository for `capability_catalog_entries`, `feature_catalog_entries`
 * and `quota_catalog_entries` (Discovery review, SPEC_V2 §6.3).
 */
export const CATALOG_ENTRY_REPOSITORY_TOKEN = Symbol.for('saas-platform/CatalogEntryRepository');

/** Repository for `promotions` (time-scheduled price campaigns, SPEC_V2 §9a). */
export const PROMOTION_REPOSITORY_TOKEN = Symbol.for('saas-platform/PromotionRepository');

/** Repository for `marketing_settings` (activeLocales, SPEC_V2 §6.5). */
export const MARKETING_SETTINGS_REPOSITORY_TOKEN = Symbol.for(
    'saas-platform/MarketingSettingsRepository',
);

/**
 * Service configuration: current app identity, strict mode.
 * Provided by CatalogModule.forRoot().
 */
export const CATALOG_SERVICE_CONFIG_TOKEN = Symbol.for('saas-platform/CatalogServiceConfig');

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
export const FEATURE_UI_REGISTRY_TOKEN = Symbol.for('saas-platform/CatalogFeatureUiRegistry');
