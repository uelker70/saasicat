// DI tokens for the Catalog module (Bundle, BusinessType, MarketingProjection,
// CapabilityCatalogEntry, FeatureCatalogEntry).
//
// Consumers inject their adapter implementations via these tokens
// into `CatalogModule.forRoot({...})`.

/** Repository for `plans` (SPEC_V2 §11.1 M6 — Plan master CRUD). */
export const PLAN_REPOSITORY_TOKEN = Symbol('PLAN_REPOSITORY');

/** Repository for `bundles` + `bundle_versions`. */
export const BUNDLE_REPOSITORY_TOKEN = Symbol('BUNDLE_REPOSITORY');

/** Repository for `business_types` + `business_type_versions` + `business_type_bundles`. */
export const BUSINESS_TYPE_REPOSITORY_TOKEN = Symbol('BUSINESS_TYPE_REPOSITORY');

/** Repository for `marketing_projections`. */
export const MARKETING_PROJECTION_REPOSITORY_TOKEN = Symbol('MARKETING_PROJECTION_REPOSITORY');

/**
 * Repository for `capability_catalog_entries`, `feature_catalog_entries`
 * and `quota_catalog_entries` (Discovery review, SPEC_V2 §6.3).
 */
export const CATALOG_ENTRY_REPOSITORY_TOKEN = Symbol('CATALOG_ENTRY_REPOSITORY');

/** Repository for `promotions` (time-scheduled price campaigns, SPEC_V2 §9a). */
export const PROMOTION_REPOSITORY_TOKEN = Symbol('PROMOTION_REPOSITORY');

/** Repository for `marketing_settings` (activeLocales, SPEC_V2 §6.5). */
export const MARKETING_SETTINGS_REPOSITORY_TOKEN = Symbol('MARKETING_SETTINGS_REPOSITORY');

/**
 * Service configuration: current app identity, strict mode.
 * Provided by CatalogModule.forRoot().
 */
export const CATALOG_SERVICE_CONFIG_TOKEN = Symbol('CATALOG_SERVICE_CONFIG');

/**
 * Optional consumer-curated FeatureUiRegistry (label/description/icon per
 * Feature). Feeds the Discovery auto-sync: empty `FeatureCatalogEntry` fields
 * are seeded from it at boot (SuperAdmin edits remain untouched), so that
 * the DB becomes the SSOT for UI metadata. Catalog-internal → a plain Symbol suffices.
 */
export const FEATURE_UI_REGISTRY_TOKEN = Symbol('FEATURE_UI_REGISTRY');
