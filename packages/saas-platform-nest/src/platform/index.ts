// @saasicat/nest/platform — mega module for the quickstart path.
//
// Bundles the five platform modules (PlanCatalog, Discovery, Admin,
// AdminManifest, optionally Entitlement) into a single forRoot() call.
// Reduces AppModule boilerplate and eliminates the ordering trap.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P1.

export {
    SaasPlatformModule,
    type SaasPlatformAdapters,
    type SaasPlatformModuleOptions,
} from './saas-platform.module.js';
export {
    PLAN_RESOLVER_PORT_TOKEN,
    type PlanResolverPort,
    StaticPlanResolver,
} from './plan-resolver.port.js';
export {
    StaticEntitlementService,
    type StaticEntitlementSnapshot,
} from './static-entitlement.service.js';
export {
    StaticFeatureGuard,
    STATIC_FEATURE_GUARD_CONFIG_TOKEN,
    type StaticFeatureGuardConfig,
} from './static-feature.guard.js';
export {
    EnforceQuotaInterceptor,
    QUOTA_PROVIDERS_TOKEN,
} from './enforce-quota.interceptor.js';
export { TenantManifestService } from './tenant-manifest.service.js';
export {
    buildTenantManifestController,
    type TenantManifestControllerOptions,
} from './tenant-manifest.controller.js';
export type { TenantManifest, TenantNavItem } from './tenant-manifest.types.js';
