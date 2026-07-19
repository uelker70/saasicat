// DI-Tokens für das Catalog-Modul (Bundle, BusinessType, MarketingProjection,
// CapabilityCatalogEntry, FeatureCatalogEntry).
//
// Konsumenten injizieren ihre Adapter-Implementations über diese Tokens
// in `CatalogModule.forRoot({...})`.

/** Repository für `plans` (SPEC_V2 §11.1 M6 — Plan-Stamm-CRUD). */
export const PLAN_REPOSITORY_TOKEN = Symbol('PLAN_REPOSITORY');

/** Repository für `bundles` + `bundle_versions`. */
export const BUNDLE_REPOSITORY_TOKEN = Symbol('BUNDLE_REPOSITORY');

/** Repository für `business_types` + `business_type_versions` + `business_type_bundles`. */
export const BUSINESS_TYPE_REPOSITORY_TOKEN = Symbol('BUSINESS_TYPE_REPOSITORY');

/** Repository für `marketing_projections`. */
export const MARKETING_PROJECTION_REPOSITORY_TOKEN = Symbol('MARKETING_PROJECTION_REPOSITORY');

/**
 * Repository für `capability_catalog_entries`, `feature_catalog_entries`
 * und `quota_catalog_entries` (Discovery-Review, SPEC_V2 §6.3).
 */
export const CATALOG_ENTRY_REPOSITORY_TOKEN = Symbol('CATALOG_ENTRY_REPOSITORY');

/** Repository für `promotions` (zeitgesteuerte Preis-Aktionen, SPEC_V2 §9a). */
export const PROMOTION_REPOSITORY_TOKEN = Symbol('PROMOTION_REPOSITORY');

/** Repository für `marketing_settings` (activeLocales, SPEC_V2 §6.5). */
export const MARKETING_SETTINGS_REPOSITORY_TOKEN = Symbol('MARKETING_SETTINGS_REPOSITORY');

/**
 * Service-Konfiguration: aktuelle App-Identität, Strict-Mode-Modus.
 * Wird vom CatalogModule.forRoot() bereitgestellt.
 */
export const CATALOG_SERVICE_CONFIG_TOKEN = Symbol('CATALOG_SERVICE_CONFIG');

/**
 * Optionale konsumenten-kuratierte FeatureUiRegistry (label/description/icon je
 * Feature). Speist den Discovery-Auto-Sync: leere `FeatureCatalogEntry`-Felder
 * werden beim Boot daraus geseedet (SuperAdmin-Edits bleiben unangetastet), damit
 * die DB die SSOT für UI-Metadaten wird. Catalog-intern → plain Symbol genügt.
 */
export const FEATURE_UI_REGISTRY_TOKEN = Symbol('FEATURE_UI_REGISTRY');
