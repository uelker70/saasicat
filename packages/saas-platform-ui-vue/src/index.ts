// @saasicat/ui-vue — Vue-3-Komponenten + Composables für die
// SuperAdmin-UI-Shell.
//
// Spec: yada-services/handoff/superadmin/UMSETZUNGSPLAN.md §3.6.
//
// P4.1 (Phase 30): Public-Boot-Loader + Manifest-Loader (ETag-Cache).
// P4.2 (Phase 31): Nav-Builder + Extension-Host + Action-Registry.
// P4.3 (Phase 32): Batch-Column-Fetcher.
// P4.4 (Phase 33): Composables für Standard-Pages (Tenants, Audit, Entitlement).
// P4.5 (Phase 34): Plan-Versions-Listen-Composables + Bulk-Publish-Orchestration.
//
// Inhalte:
//   - types:                HttpClient, KvStore, defaultHttpClient, defaultKvStore
//   - boot-loader:          BootLoader (framework-agnostic) + BootLoadError
//   - manifest-loader:      ManifestLoader mit ETag-Cache + ManifestLoadError
//   - nav-builder:          buildRoutes, buildSidebar, resolveExtension
//   - action-registry:      ActionRegistry, MissingHandlerError, ActionDefNotInManifestError
//   - batch-column-fetcher: BatchColumnFetcher + BatchColumnDriftError
//   - use-api-list:         useApiList<T> generischer List-Composable
//   - use-tenants:          useTenants typed wrapper
//   - use-audit-entries:    useAuditEntries typed wrapper
//   - use-entitlement:      useEntitlement Composable
//   - use-plan-versions:    usePlanVersionsCatalog
//   - use-bulk-publish:     useBulkPublish (parallele Publishes mit Status-Tracking)
//   - use-plan-editor:      usePlanEditor Composable (Feature-Discovery, plannedOnly-Filter)
//   - use-public-boot:      usePublicBoot Composable
//   - use-manifest:         useManifest Composable
//   - use-nav:              useNav Composable
//   - use-actions:          useActions Composable
//   - use-batch-columns:    useBatchColumns Composable

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
// FeatureGate.vue wird nicht gebundelt — Konsumenten importieren sie direkt:
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
// Plattform-Dialog-Types fuer App-Wrappers, die Submit-Handler typisieren.
export * from './components/dialogs/types.js';
// Reine Resolver für übersetzte Feature-/Quota-Labels in den Bundle-Editoren.
export * from './components/bundle-editor/catalog-i18n.js';
// Typen der geteilten PlatformEmailPage (Plattform-E-Mail-Sender).
export * from './pages-standard/platform-email.types.js';
// Typen der geteilten EmailHistoryPage (Plattform-E-Mail-Verlauf).
export * from './pages-standard/email-history.types.js';
// Universeller Bootstrap-Helper für SuperAdmin-Apps + zugehörige Composables.
export * from './create-super-admin-app.js';
export * from './use-super-admin-context.js';
// Loader-Factory, die BootLoader + ManifestLoader aus derselben Endpoint-
// Konfiguration baut wie createSuperAdminApp() — damit Endpoints pro App
// nur an einer Stelle leben.
export * from './platform-loaders.js';
// ProjectPageHost: löst Manifest-projectPages dynamisch gegen die
// extensions:-Map auf — ersetzt statische Route-Duplikation in den Apps.
export * from './project-page-host.js';
// Manifest-Pinia-Store-Factory — standardisiert ensureLoaded/reload/clearCache.
export * from './manifest-store-factory.js';

// Geteilte SuperAdmin-LoginPage liegt unter
// `@saasicat/ui-vue/pages-standard/SuperAdminLoginPage.vue` —
// nicht via Bundle (tsup ignoriert .vue), sondern direkt aus src/ über den
// subpath-Export. Apps reichen einen `loginAdapter` via createSuperAdminApp()
// und routen `/login` auf diese Component.
