// DI-Tokens für PublicCatalogModule (SPEC_V2 §11.1 M6 Pack 2c).
// Optional injizierbare Repositories für Bundles, BusinessTypes und
// Marketing-Projektionen — Apps ohne diese Tabellen lassen sie weg,
// die entsprechenden Endpoints liefern dann leere Listen.

export const PUBLIC_CATALOG_PROJECT_KEY_TOKEN = Symbol('PUBLIC_CATALOG_PROJECT_KEY');
export const PUBLIC_CATALOG_BUNDLE_REPOSITORY_TOKEN = Symbol('PUBLIC_CATALOG_BUNDLE_REPOSITORY');
export const PUBLIC_CATALOG_BUSINESS_TYPE_REPOSITORY_TOKEN = Symbol(
    'PUBLIC_CATALOG_BUSINESS_TYPE_REPOSITORY',
);
export const PUBLIC_CATALOG_MARKETING_REPOSITORY_TOKEN = Symbol(
    'PUBLIC_CATALOG_MARKETING_REPOSITORY',
);
/**
 * Optional (#13). Wenn gesetzt, overlayt `/billing/feature-registry` das
 * editierbare `FeatureCatalogEntry.icon` aus der DB über die statische Registry.
 */
export const PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY_TOKEN = Symbol(
    'PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY',
);
