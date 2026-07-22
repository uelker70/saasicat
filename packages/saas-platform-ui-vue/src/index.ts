// @saasicat/ui-vue — Vue 3 composables + loaders for the SuperAdmin UI shell.
//
// The package is layered; each layer has its own entry:
//
//   - `@saasicat/ui-vue/client` (`src/client/`)  — framework-free core:
//     loaders, nav builder, action registry, HTTP contract. No Vue, no
//     Pinia, no Quasar.
//   - `@saasicat/ui-vue` (this entry, `src/vue/`) — Vue bindings: composables,
//     router guards, injection keys, optional Pinia store factory. Re-exports
//     the client layer. No Quasar.
//   - `@saasicat/ui-vue/quasar` (`src/quasar/`)   — Quasar bootstrap:
//     `createSuperAdminApp()` and the Quasar notify port implementation.
//   - Quasar standard pages/components             — raw SFCs via the
//     `./pages-standard/*`, `./pages-tenant/*` and `./components/*` subpath
//     exports (tsup ignores `.vue`).
//
// Layer rule (enforced via ESLint `no-restricted-imports`): client imports
// nothing framework-specific; vue never imports quasar; this entry never
// reaches the quasar layer or the SFC directories (except the whitelisted
// framework-free type/i18n modules below).

// ---------------------------------------------------------------------------
// Client layer (framework-free core).
// ---------------------------------------------------------------------------
export * from './client/index.js';

// ---------------------------------------------------------------------------
// Vue layer: shell contract (injection keys, option types, navigation guard)
// and the UI notify port. `createSuperAdminApp()` itself lives in
// `@saasicat/ui-vue/quasar`.
// ---------------------------------------------------------------------------
export * from './vue/super-admin-context.js';
export * from './vue/ui-notify.js';
export * from './vue/use-super-admin-context.js';
export * from './vue/use-super-admin-i18n.js';

// ---------------------------------------------------------------------------
// Vue layer: composables, guards, hosts, store factory.
// ---------------------------------------------------------------------------
export * from './vue/create-admin-routes.js';
export * from './vue/use-api-list.js';
export * from './vue/use-tenants.js';
export * from './vue/use-audit-entries.js';
export * from './vue/use-entitlement.js';
export * from './vue/use-tenant-manifest.js';
export * from './vue/entitlement-provider.js';
export * from './vue/feature-router-guard.js';
// FeatureGate.vue is not bundled — consumers import it directly:
//   import FeatureGate from '@saasicat/ui-vue/components/FeatureGate.vue';
export * from './vue/use-tenant-billing-catalog.js';
export * from './vue/use-tenant-billing.js';
export * from './vue/use-subscription-draft.js';
export * from './vue/use-plan-versions.js';
export * from './vue/use-bulk-publish.js';
export * from './vue/use-plan-editor.js';
export * from './vue/use-public-boot.js';
export * from './vue/use-discovery.js';
export * from './vue/use-catalog-entries.js';
export * from './vue/use-bundles.js';
export * from './vue/use-bundle-versions-map.js';
export * from './vue/use-tenant-subscription-bundles.js';
export * from './vue/use-business-types.js';
export * from './vue/use-marketing-projections.js';
export * from './vue/use-promotions.js';
export * from './vue/use-plans.js';
export * from './vue/use-live-plan-versions.js';
export * from './vue/use-manifest.js';
export * from './vue/use-nav.js';
export * from './vue/use-actions.js';
export * from './vue/use-tenant-action-flow.js';
export * from './vue/use-platform-tenant-actions.js';
export * from './vue/use-batch-columns.js';
// Loader factory that builds BootLoader + ManifestLoader from the same
// endpoint configuration as createSuperAdminApp() — so that endpoints live
// in a single place per app.
export * from './vue/platform-loaders.js';
// ProjectPageHost: resolves manifest projectPages dynamically against the
// extensions: map — replaces static route duplication in the apps.
export * from './vue/project-page-host.js';
// Manifest Pinia store factory — standardizes ensureLoaded/reload/clearCache.
export * from './vue/manifest-store-factory.js';

// ---------------------------------------------------------------------------
// Framework-free type/i18n modules that deliberately stay co-located with
// their SFCs (whitelisted in the ESLint layer rules).
// ---------------------------------------------------------------------------
// Platform dialog types for app wrappers that type submit handlers.
export * from './components/dialogs/types.js';
// Pure resolvers for translated feature/quota labels in the bundle editors.
export * from './components/bundle-editor/catalog-i18n.js';
// Types of the shared PlatformEmailPage (platform email sender).
export * from './pages-standard/platform-email.types.js';
// Types of the shared EmailHistoryPage (platform email history).
export * from './pages-standard/email-history.types.js';
// Default German labels for the tenant-facing pages.
export * from './pages-tenant/default-i18n.js';

// The shared SuperAdmin LoginPage lives at
// `@saasicat/ui-vue/pages-standard/SuperAdminLoginPage.vue` —
// not via bundle (tsup ignores .vue), but directly from src/ through the
// subpath export. Apps pass a `loginAdapter` via createSuperAdminApp()
// and route `/login` to this component.
