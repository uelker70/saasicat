// @saasicat/ui-vue/client — the framework-free core of the SuperAdmin UI
// package. No Vue, no Pinia, no Quasar: only `@saasicat/types` and the
// platform HTTP contract. Usable from any framework binding or plain
// TypeScript (Node scripts, other UI stacks).
//
// Contents:
//   - types:                HttpClient, KvStore, defaultHttpClient, defaultKvStore
//   - http-json:            JSON fetch helper over HttpClient
//   - boot-loader:          BootLoader + BootLoadError
//   - manifest-loader:      ManifestLoader with ETag cache + ManifestLoadError
//   - nav-builder:          buildRoutes, buildSidebar, resolveExtension
//   - action-registry:      ActionRegistry, MissingHandlerError, ActionDefNotInManifestError
//   - batch-column-fetcher: BatchColumnFetcher + BatchColumnDriftError
//   - i18n:                 SaLocale, typed DE/EN catalogs, formatMessage
//   - version:              ADMIN_UI_VERSION

export * from './version.js';
export * from './types.js';
export * from './http-json.js';
export * from './boot-loader.js';
export * from './manifest-loader.js';
export * from './nav-builder.js';
export * from './action-registry.js';
export * from './batch-column-fetcher.js';
export * from './i18n/index.js';
