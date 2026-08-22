// @saasicat/nest/platform — high-level SaaSiCat composition.
//
// `SaaSiCatModule` is the one module class. Until 1.0 it had a second name;
// `saasicat codemod v1` rewrites that one to this.
//

export {
    SaaSiCatModule,
    type SaaSiCatAdapters,
    type SaaSiCatAdminStatsOptions,
    type SaaSiCatAdminResourcesOptions,
    type SaaSiCatCatalogOptions,
    type SaaSiCatCheckoutOfferOptions,
    type SaaSiCatModuleOptions,
    type SaaSiCatPromoCodesOptions,
    type SaaSiCatSetupOptions,
    type SaaSiCatSubscriptionContractOptions,
    type SaaSiCatSubscriptionBundlesOptions,
    type SaaSiCatTenantAuthGuards,
    type SaaSiCatTenantBillingOptions,
} from './saasicat.module.js';
export { defineSaaSiCat } from './define-saasicat.js';
// The composition seam, exported so its two properties can be asked as
// behaviour rather than read off the source: every module a composer mounts is
// also exported, and a feature is added as a composer rather than as an edit to
// the assembler. `tests/platform-composition.test.js` is what asks.
export {
    FEATURE_COMPOSERS,
    composeFeatures,
    type Composer,
    type CompositionContext,
} from './compose/index.js';
export { MOUNTED_BUT_NOT_EXPORTED, composeModuleExports } from './compose/module-exports.js';
// The configuration rules, and the error a misconfigured app boots into.
//
// Exported because the error is what an integrator reads at 3am: `violations`
// gives their own boot diagnostics the list as data instead of a string to
// scrape, and `PLATFORM_RULES` is what `docs/reference/options.md` is
// generated from.
export {
    PLATFORM_RULES,
    docsUrlFor,
    headingSlug,
    type PlatformConfiguration,
    type PlatformRule,
} from './validation/rules.js';
export {
    SaaSiCatConfigurationError,
    assertConfiguration,
    findViolations,
    type PlatformViolation,
} from './validation/validate.js';
export {
    SAASICAT_PUBLIC_ROUTE_KEY,
    SaaSiCatPublicRoute,
    isSaaSiCatPublicRoute,
} from '../core/public-route.js';
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
export {
    ENFORCEMENT_CHAIN_STATE_TOKEN,
    EnforcementChainCheck,
    type EnforcementChainState,
} from './enforcement-chain.check.js';
// ─────────────────────────────────────────────────────────────────────────
// Re-exported from THIS entry on purpose.
//
// The CJS builds do not share code between entries (esbuild only splits ESM),
// so a class imported from `@saasicat/nest/admin` is a *different* class
// object than the one `SaaSiCatModule` registers here — and Nest matches
// providers by class reference, not by name. An app that injects
// `AdminAuditService` from `@saasicat/nest/admin` while `SaaSiCatModule`
// provides the `/platform` copy fails at boot with
// UnknownDependenciesException.
//
// `CONTRIBUTING.md` covers the same hazard for DI tokens, where `Symbol.for`
// is the fix. Classes have no such registry — the only way to hand out one
// identity is to re-export from the entry that registers them.
//
// This costs no bundle size: `saasicat.module.ts` already imports every
// module below to compose it, so these classes are in this chunk regardless.
// The exports only surface what is already here.
//
// Rule for maintainers: whenever `SaaSiCatModule.forRoot()` gains a module
// whose `exports` include a CLASS a consumer might inject, re-export that
// class here in the same commit.
// ─────────────────────────────────────────────────────────────────────────
export { AdminManifestService } from '../admin/admin-manifest.service.js';
export { AdminAuditService } from '../admin/admin-audit.service.js';
export { AdminBypassRlsInterceptor } from '../admin/admin-bypass-rls.interceptor.js';
export { AdminResourcesService } from '../admin/admin-resources.module.js';
export { MfaGuard } from '../admin/mfa.guard.js';
export { MfaService } from '../admin/mfa.service.js';
export { SuperAdminGuard } from '../admin/super-admin.guard.js';

export { EntitlementService } from '../entitlement/entitlement.service.js';

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
export { PromoCodesService } from '../promo/promo.service.js';

// ─────────────────────────────────────────────────────────────────────────
// Optional modules composed internally by `SaaSiCatModule` and retained as
// public escape hatches, for the same reason as the classes above: Nest
// matches modules and providers by class reference.
//
// `SetupModule` from `@saasicat/nest` builds a `SetupService` that injects the
// ROOT copy of `MfaService`, while `SaaSiCatModule` registers the PLATFORM
// copy — the app then fails to boot with "MfaService is not available in the
// SetupModule module". Taking the module from this entry puts both in one
// chunk, so there is one `MfaService`.
//
// Rule for consumers using the `/platform` entry: import every platform class
// and any explicit escape-hatch module from that entry too.
// ─────────────────────────────────────────────────────────────────────────
export { AdminModule, type AdminModuleOptions } from '../admin/admin.module.js';
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
