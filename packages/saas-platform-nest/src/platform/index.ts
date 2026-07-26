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
// ─────────────────────────────────────────────────────────────────────────
// Re-exported from THIS entry on purpose.
//
// The CJS builds do not share code between entries (esbuild only splits ESM),
// so a class imported from `@saasicat/nest/admin` is a *different* class
// object than the one `SaasPlatformModule` registers here — and Nest matches
// providers by class reference, not by name. An app that injects
// `AdminAuditService` from `@saasicat/nest/admin` while `SaaSiCatModule`
// provides the `/platform` copy fails at boot with
// UnknownDependenciesException.
//
// `CONTRIBUTING.md` covers the same hazard for DI tokens, where `Symbol.for`
// is the fix. Classes have no such registry — the only way to hand out one
// identity is to re-export from the entry that registers them.
//
// This costs no bundle size: `saas-platform.module.ts` already imports every
// module below to compose it, so these classes are in this chunk regardless.
// The exports only surface what is already here.
//
// Rule for maintainers: whenever `SaasPlatformModule.forRoot()` gains a module
// whose `exports` include a CLASS a consumer might inject, re-export that
// class here in the same commit.
// ─────────────────────────────────────────────────────────────────────────
export { AdminManifestService } from '../admin/admin-manifest.service.js';
export { AdminAuditService } from '../admin/admin-audit.service.js';
export { AdminBypassRlsInterceptor } from '../admin/admin-bypass-rls.interceptor.js';
export { AdminResourcesService } from '../admin/admin-resources.module.js';
export { MfaGuard } from '../admin/mfa.guard.js';
export { MfaService } from '../admin/mfa.js';
export { SuperAdminGuard } from '../admin/super-admin.guard.js';

export { EntitlementService } from '../entitlement/service.js';

export { ComposedTenantAuthGuard } from '../billing/composed-tenant-auth.guard.js';
// Controllers are not injected in app code, but consumers assert on them in
// tests (`moduleRef.get(TenantBillingController)`), which is a class-identity
// lookup like any other.
export { TenantBillingController } from '../billing/tenant-billing.controller.js';
export { PendingPlanMaterializationService } from '../billing/pending-plan-materialization.service.js';
export { PlanChangePreviewService } from '../billing/plan-change-preview.service.js';
export { SubscriptionBundlePreviewService } from '../billing/subscription-bundle-preview.service.js';
export { SubscriptionBundlesService } from '../billing/subscription-bundles.service.js';
export { TenantAdminGuard } from '../billing/tenant-admin.guard.js';

export { BundlesService } from '../catalog/bundles.service.js';
export { CatalogEntriesService } from '../catalog/catalog-entries.service.js';
export { MarketingProjectionsService } from '../catalog/marketing-projections.service.js';
export { MarketingSettingsService } from '../catalog/marketing-settings.service.js';
export { PlanVersionsService } from '../catalog/plan-versions.service.js';
export { PlansService } from '../catalog/plans.service.js';
export { PromotionsService } from '../catalog/promotions.service.js';
export { PublicMarketingCatalogService } from '../catalog/public-marketing-catalog.service.js';

export { DiscoveryScanner } from '../discovery/discovery.scanner.js';

export { PromoCodeRateLimitGuard } from '../promo/rate-limit.guard.js';
export { PromoCodesService } from '../promo/service.js';

// ─────────────────────────────────────────────────────────────────────────
// Modules an app composes ALONGSIDE `SaaSiCatModule`, for the same reason as
// the classes above: Nest matches modules and providers by class reference.
//
// `SetupModule` from `@saasicat/nest` builds a `SetupService` that injects the
// ROOT copy of `MfaService`, while `SaaSiCatModule` registers the PLATFORM
// copy — the app then fails to boot with "MfaService is not available in the
// SetupModule module". Taking the module from this entry puts both in one
// chunk, so there is one `MfaService`.
//
// Rule for consumers: once you use `SaaSiCatModule`, import every other
// platform module from `@saasicat/nest/platform` too.
// ─────────────────────────────────────────────────────────────────────────
export { AdminModule, type AdminModuleOptions } from '../admin/module.js';
export {
    AdminManifestModule,
    type AdminManifestModuleOptions,
} from '../admin/admin-manifest.module.js';
export { AdminStatsModule, type AdminStatsModuleOptions } from '../admin/admin-stats.module.js';
export { AdminStatsService } from '../admin/admin-stats.service.js';
export { SetupModule, type SetupModuleOptions } from '../setup/setup.module.js';
export { SetupService } from '../setup/setup.service.js';
export {
    CheckoutOfferModule,
    type CheckoutOfferModuleOptions,
} from '../checkout-offer/checkout-offer.module.js';
export { CheckoutOfferService } from '../checkout-offer/checkout-offer.service.js';
export {
    SubscriptionContractModule,
    type SubscriptionContractModuleOptions,
} from '../subscription-contract/subscription-contract.module.js';
export { SubscriptionContractService } from '../subscription-contract/subscription-contract.service.js';

export { TenantManifestService } from './tenant-manifest.service.js';
export {
    buildTenantManifestController,
    type TenantManifestControllerOptions,
} from './tenant-manifest.controller.js';
export type { TenantManifest, TenantNavItem } from './tenant-manifest.types.js';
