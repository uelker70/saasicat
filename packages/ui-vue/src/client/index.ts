// @saasicat/ui-vue/client — the framework-free core of the SuperAdmin UI
// package. No Vue, no Pinia, no Quasar: only `@saasicat/core` and the
// platform HTTP contract. Usable from any framework binding or plain
// TypeScript (Node scripts, other UI stacks).
//
// Contents:
//   - types:                HttpClient, KvStore, defaultHttpClient, defaultKvStore
//   - http:                 createFetchHttpClient, createAxiosHttpClient
//   - resources:            defineResource, bindResource, the endpoint descriptors
//   - admin-error:          AdminError, toAdminError, adminErrorMessage
//   - http-json:            JSON fetch helper over HttpClient
//   - boot-loader:          BootLoader + BootLoadError
//   - manifest-loader:      ManifestLoader with ETag cache + ManifestLoadError
//   - nav-builder:          buildRoutes, buildSidebar, resolveExtension
//   - action-registry:      ActionRegistry, MissingHandlerError, ActionDefNotInManifestError
//   - batch-column-fetcher: BatchColumnFetcher + BatchColumnDriftError
//   - i18n:                 SaLocale, typed DE/EN catalogs, formatMessage
//   - version:              ADMIN_UI_VERSION

export * from './brand-bridge.js';
export * from './version.js';
export * from './types.js';
export * from './http/index.js';
export * from './resources/index.js';
export * from './admin-error.js';
// Named in CONTRIBUTING as the ES2021 stand-in for `new Error(msg, { cause })`,
// so it was already API in every sense except this line.
export * from './attach-cause.js';
export * from './http-json.js';
export * from './boot-loader.js';
export * from './manifest-loader.js';
export * from './nav-builder.js';
export * from './action-registry.js';
export * from './batch-column-fetcher.js';
export * from './admin-resource-client.js';
export * from './i18n/index.js';
export * from './login-branding.js';
export * from './reorder-priorities.js';
export * from './resolve-plans.js';
export * from './identity-accents.js';
export { looksLikeEmail, trimChar } from './text-shape.js';
