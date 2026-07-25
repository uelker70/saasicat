// @saasicat/nest/platform — high-level SaaSiCat composition.
//
// `SaaSiCatModule` is the preferred branded alias. `SaasPlatformModule`
// remains exported for compatibility.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P1.

export {
    SaasPlatformModule,
    SaasPlatformModule as SaaSiCatModule,
    type SaasPlatformAdapters,
    type SaasPlatformAdminResourcesOptions,
    type SaasPlatformCatalogOptions,
    type SaasPlatformModuleOptions,
    type SaasPlatformPromoCodesOptions,
    type SaasPlatformSubscriptionBundlesOptions,
    type SaasPlatformTenantAuthGuards,
    type SaasPlatformTenantBillingOptions,
} from './saas-platform.module.js';
export { defineSaaSiCat } from './define-saasicat.js';
export {
    PLAN_RESOLVER_PORT_TOKEN,
    type PlanResolverPort,
    StaticPlanResolver,
} from './plan-resolver.port.js';
export { SubscriptionPlanResolver } from './subscription-plan-resolver.js';
export { QuotaProvidersUsageSnapshot } from './quota-providers-usage-snapshot.js';
export {
    StaticEntitlementService,
    type StaticEntitlementSnapshot,
} from './static-entitlement.service.js';
export {
    StaticFeatureGuard,
    STATIC_FEATURE_GUARD_CONFIG_TOKEN,
    type StaticFeatureGuardConfig,
} from './static-feature.guard.js';
export { EnforceQuotaInterceptor, QUOTA_PROVIDERS_TOKEN } from './enforce-quota.interceptor.js';
// Re-exported from THIS entry on purpose. The CJS builds do not share code
// between entries, so `AdminManifestService` imported from
// `@saasicat/nest/admin` is a different class object than the one
// `SaasPlatformModule` registers here — and Nest matches providers by class
// reference. Apps that register a manifest contribution (handbook §6.6) must
// take the service from the same entry as the module that provides it.
export { AdminManifestService } from '../admin/admin-manifest.service.js';

export { TenantManifestService } from './tenant-manifest.service.js';
export {
    buildTenantManifestController,
    type TenantManifestControllerOptions,
} from './tenant-manifest.controller.js';
export type { TenantManifest, TenantNavItem } from './tenant-manifest.types.js';
