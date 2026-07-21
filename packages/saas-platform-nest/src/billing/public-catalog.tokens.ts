// DI tokens for PublicCatalogModule (SPEC_V2 §11.1 M6 Pack 2c).
// Optionally injectable repositories for Bundles, BusinessTypes and
// marketing projections — apps without these tables leave them out,
// the corresponding endpoints then return empty lists.

export const PUBLIC_CATALOG_PROJECT_KEY_TOKEN = Symbol('PUBLIC_CATALOG_PROJECT_KEY');
export const PUBLIC_CATALOG_BUNDLE_REPOSITORY_TOKEN = Symbol('PUBLIC_CATALOG_BUNDLE_REPOSITORY');
export const PUBLIC_CATALOG_BUSINESS_TYPE_REPOSITORY_TOKEN = Symbol(
    'PUBLIC_CATALOG_BUSINESS_TYPE_REPOSITORY',
);
export const PUBLIC_CATALOG_MARKETING_REPOSITORY_TOKEN = Symbol(
    'PUBLIC_CATALOG_MARKETING_REPOSITORY',
);
/**
 * Optional (#13). When set, `/billing/feature-registry` overlays the
 * editable `FeatureCatalogEntry.icon` from the DB on top of the static registry.
 */
export const PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY_TOKEN = Symbol(
    'PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY',
);
