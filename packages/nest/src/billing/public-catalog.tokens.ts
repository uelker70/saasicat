// DI tokens for PublicCatalogModule.
// Optionally injectable repositories for bundles and marketing projections
// — apps without these tables leave them out,
// the corresponding endpoints then return empty lists.

export const PUBLIC_CATALOG_PROJECT_KEY_TOKEN = Symbol.for('saas-platform/PublicCatalogProjectKey');
export const PUBLIC_CATALOG_BUNDLE_REPOSITORY_TOKEN = Symbol.for(
    'saas-platform/PublicCatalogBundleRepository',
);
export const PUBLIC_CATALOG_MARKETING_REPOSITORY_TOKEN = Symbol.for(
    'saas-platform/PublicCatalogMarketingRepository',
);
/**
 * Optional (#13). When set, `/billing/feature-registry` overlays the
 * editable `FeatureCatalogEntry.icon` from the DB on top of the static registry.
 */
export const PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY_TOKEN = Symbol.for(
    'saas-platform/PublicCatalogCatalogEntryRepository',
);
