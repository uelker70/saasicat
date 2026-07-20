// @saasicat/ui-vue — Vue 3 components + composables for the
// SuperAdmin UI shell.
//
// P4.1 (Phase 30): public boot loader + manifest loader (ETag cache).
// P4.2 (Phase 31): nav builder + extension host + action registry.
// P4.3 (Phase 32): batch column fetcher.
// P4.4 (Phase 33): composables for standard pages (Tenants, Audit, Entitlement).
// P4.5 (Phase 34): plan-versions list composables + bulk-publish orchestration.
//
// Contents:
//   - types:                HttpClient, KvStore, defaultHttpClient, defaultKvStore
//   - boot-loader:          BootLoader (framework-agnostic) + BootLoadError
//   - manifest-loader:      ManifestLoader with ETag cache + ManifestLoadError
//   - nav-builder:          buildRoutes, buildSidebar, resolveExtension
//   - action-registry:      ActionRegistry, MissingHandlerError, ActionDefNotInManifestError
//   - batch-column-fetcher: BatchColumnFetcher + BatchColumnDriftError
//   - use-api-list:         useApiList<T> generic list composable
//   - use-tenants:          useTenants typed wrapper
//   - use-audit-entries:    useAuditEntries typed wrapper
//   - use-entitlement:      useEntitlement composable
//   - use-plan-versions:    usePlanVersionsCatalog
//   - use-bulk-publish:     useBulkPublish (parallel publishes with status tracking)
//   - use-plan-editor:      usePlanEditor composable (feature discovery, plannedOnly filter)
//   - use-public-boot:      usePublicBoot composable
//   - use-manifest:         useManifest composable
//   - use-nav:              useNav composable
//   - use-actions:          useActions composable
//   - use-batch-columns:    useBatchColumns composable

export * from './version.js';
export * from './types.js';
export * from './http-json.js';
export * from './create-admin-routes.js';
export * from './boot-loader.js';
export * from './manifest-loader.js';
export * from './nav-builder.js';
export * from './action-registry.js';
export * from './batch-column-fetcher.js';
export * from './use-api-list.js';
export * from './use-tenants.js';
export * from './use-audit-entries.js';
export * from './use-entitlement.js';
export * from './use-tenant-manifest.js';
export * from './entitlement-provider.js';
export * from './feature-router-guard.js';
// FeatureGate.vue is not bundled — consumers import it directly:
//   import FeatureGate from '@saasicat/ui-vue/components/FeatureGate.vue';
export * from './use-tenant-billing-catalog.js';
export * from './use-tenant-billing.js';
export * from './use-subscription-draft.js';
export * from './pages-tenant/default-i18n.js';
export * from './use-plan-versions.js';
export * from './use-bulk-publish.js';
export * from './use-plan-editor.js';
export * from './use-public-boot.js';
export * from './use-discovery.js';
export * from './use-catalog-entries.js';
export * from './use-bundles.js';
export * from './use-bundle-versions-map.js';
export * from './use-tenant-subscription-bundles.js';
export * from './use-business-types.js';
export * from './use-marketing-projections.js';
export * from './use-promotions.js';
export * from './use-plans.js';
export * from './use-live-plan-versions.js';
export * from './use-manifest.js';
export * from './use-nav.js';
export * from './use-actions.js';
export * from './use-tenant-action-flow.js';
export * from './use-platform-tenant-actions.js';
export * from './use-batch-columns.js';
export * from './plan-versions-catalog.js';
// Platform dialog types for app wrappers that type submit handlers.
export * from './components/dialogs/types.js';
// Pure resolvers for translated feature/quota labels in the bundle editors.
export * from './components/bundle-editor/catalog-i18n.js';
// Types of the shared PlatformEmailPage (platform email sender).
export * from './pages-standard/platform-email.types.js';
// Types of the shared EmailHistoryPage (platform email history).
export * from './pages-standard/email-history.types.js';
// Universal bootstrap helper for SuperAdmin apps + associated composables.
export * from './create-super-admin-app.js';
export * from './use-super-admin-context.js';
// Loader factory that builds BootLoader + ManifestLoader from the same
// endpoint configuration as createSuperAdminApp() — so that endpoints live
// in a single place per app.
export * from './platform-loaders.js';
// ProjectPageHost: resolves manifest projectPages dynamically against the
// extensions: map — replaces static route duplication in the apps.
export * from './project-page-host.js';
// Manifest Pinia store factory — standardizes ensureLoaded/reload/clearCache.
export * from './manifest-store-factory.js';

// The shared SuperAdmin LoginPage lives at
// `@saasicat/ui-vue/pages-standard/SuperAdminLoginPage.vue` —
// not via bundle (tsup ignores .vue), but directly from src/ through the
// subpath export. Apps pass a `loginAdapter` via createSuperAdminApp()
// and route `/login` to this component.
