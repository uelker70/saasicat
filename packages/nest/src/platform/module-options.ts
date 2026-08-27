// The options `SaaSiCatModule.forRoot` takes, and the adapter slots behind them.
//
// Separate from the module for one structural reason: the configuration rules
// in `validation/` are stated over these types, and the module runs those
// rules. Leaving the types in the module would make that a cycle — the exact
// shape the nest domain boundaries exist to prevent, one directory down.
//
// Every option type here is derived from the module that consumes it, with
// `Omit`/`Pick`, so a low-level module gaining an option cannot leave the
// high-level surface behind.

import {
    type CanActivate,
    type DynamicModule,
    type FactoryProvider,
    type ForwardReference,
    type Provider,
    type Type,
} from '@nestjs/common';
import type {
    AuditPort,
    AdminResourcesPort,
    FeatureUiRegistry,
    FirstTimeCustomerCheck,
    MfaPort,
    PlanCatalog,
    PlanCatalogReadSink,
    PlanVersionRepository,
    QuotaProvider,
    RlsBypassPort,
    SaaSiCatPersistenceAdapter,
    SubscriptionRepository,
    SubscriptionUsagePort,
    TenantSubscriptionWritePort,
    TransactionRunner,
    UsageSnapshotPort,
} from '@saasicat/core';

import { type ProviderSpec } from '../core/di.js';
import { type AdminResourcesModuleOptions } from '../admin/admin-resources.module.js';
import { type AdminStatsModuleOptions } from '../admin/admin-stats.module.js';
import { type AdminManifestConfig } from '../admin/admin-manifest.config.js';
import {
    type SubscriptionBundleControllerOptions,
    type SubscriptionBundleModuleOptions,
} from '../billing/subscription-bundles.module.js';
import { type TenantBillingModuleOptions } from '../billing/tenant-billing.module.js';
import { type CatalogModuleOptions } from '../catalog/catalog.module.js';
import type { DiscoveryAppInfo } from '../discovery/discovery.scanner.js';
import type { EntitlementResolutionConfig } from '../entitlement/plan-resolution.js';
import { type PromoCodesModuleOptions } from '../promo/promo.module.js';
import { type SetupModuleOptions } from '../setup/setup.module.js';
import { type CheckoutOfferModuleOptions } from '../checkout-offer/checkout-offer.module.js';
import { type SubscriptionContractModuleOptions } from '../subscription-contract/subscription-contract.module.js';
import { type PlanResolverPort } from './plan-resolver.port.js';

import { type TenantManifestControllerOptions } from './tenant-manifest.controller.js';

/**
 * Adapter bindings for the platform ports. Accepted as class tokens, values
 * or factory specs.
 *
 * `mfa`/`audit`/`rlsBypass` are optional because the `persistence` bundle
 * supplies them by default; pass them here only to override the bundle, or
 * when wiring adapters without a bundle. The module validates that each port
 * ends up provided by exactly one of the two paths.
 */
export interface SaaSiCatAdapters {
    mfa?: ProviderSpec<MfaPort>;
    audit?: ProviderSpec<AuditPort>;
    rlsBypass?: ProviderSpec<RlsBypassPort>;
    /**
     * Optional. If provided, `PlanCatalogModule` is hydrated from this sink
     * (DB read at boot). If omitted, `planCatalog` MUST be passed as a ready
     * object (quickstart path — YAML-direct).
     */
    planCatalogReadSink?: ProviderSpec<PlanCatalogReadSink>;
    /**
     * Optional — resolver `tenantId → planId`. The quickstart path uses this
     * together with the `StaticEntitlementService` to automatically check
     * `@RequireFeature` and `@EnforceQuota` against the plan catalog limit.
     * If not set, `tenantBilling` derives the resolver from the subscription
     * repository. Lightweight setups can instead set `defaultPlanId`.
     */
    planResolver?: ProviderSpec<PlanResolverPort>;
    /**
     * Optional — required only when `entitlement: true`. Repositories for the
     * V3 contract/entitlement loop.
     */
    subscriptionRepository?: ProviderSpec<SubscriptionRepository>;
    planVersionRepository?: ProviderSpec<PlanVersionRepository>;
    transactionRunner?: ProviderSpec<TransactionRunner>;
}

type PlatformImports = Array<
    Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference
>;

export interface SaaSiCatCatalogOptions extends Pick<
    CatalogModuleOptions,
    | 'strictModeCheckMode'
    | 'autoSyncDiscoveryAtBoot'
    | 'marketedOnlyFeatures'
    | 'publicMarketingCatalog'
    | 'extraProviders'
> {
    /** Labels/icons used by discovery review and the public catalog. */
    featureUiRegistry: FeatureUiRegistry;
    /** Mount the SuperAdmin catalog controllers. Default `true`. */
    adminControllers?: boolean;
    /** Mount `/billing/plans|bundles|feature-registry`. Default `true`. */
    publicCatalog?: boolean;
    /** Override the top-level module imports for catalog adapter factories. */
    imports?: PlatformImports;
}

export type SaaSiCatTenantAuthGuards =
    Array<Type<CanActivate>> | ProviderSpec<ReadonlyArray<CanActivate>>;

export interface SaaSiCatTenantBillingOptions extends Omit<
    TenantBillingModuleOptions,
    | 'authGuards'
    | 'subscriptionUsagePort'
    | 'usageSnapshotPort'
    | 'subscriptionWritePort'
    | 'global'
> {
    /**
     * Tenant guards as classes (the common path) or as a custom provider
     * factory. Guard classes are resolved from `imports`.
     */
    authGuards: SaaSiCatTenantAuthGuards;
    /** Optional overrides; otherwise the persistence bundle supplies them. */
    subscriptionUsagePort?: ProviderSpec<SubscriptionUsagePort>;
    usageSnapshotPort?: ProviderSpec<UsageSnapshotPort>;
    subscriptionWritePort?: ProviderSpec<TenantSubscriptionWritePort>;
}

export interface SaaSiCatSubscriptionBundlesOptions extends Omit<
    SubscriptionBundleModuleOptions,
    | 'subscriptionBundleRepository'
    | 'bundleRepository'
    | 'controller'
    | 'imports'
    | 'extraProviders'
    | 'global'
> {
    /** Default mounts the tenant controller and reuses tenant-billing auth. */
    controller?:
        false | Omit<SubscriptionBundleControllerOptions, 'authGuards' | 'subscriptionUsagePort'>;
    imports?: PlatformImports;
    extraProviders?: Provider[];
}

export interface SaaSiCatAdminResourcesOptions extends Omit<
    AdminResourcesModuleOptions,
    'resources' | 'guards' | 'global'
> {
    /** Override the default controller guards + `SuperAdminGuard` chain. */
    guards?: Array<Type<CanActivate>>;
    /** Custom schema override; the persistence bundle supplies the default. */
    resources?: ProviderSpec<AdminResourcesPort>;
}

export interface SaaSiCatPromoCodesOptions extends Omit<
    PromoCodesModuleOptions,
    | 'promoCodeRepository'
    | 'redemptionRepository'
    | 'validationLogRepository'
    | 'subscriptionLookup'
    | 'revenueAggregator'
    | 'transactionRunner'
    | 'firstTimeCustomerCheck'
    | 'adminController'
    | 'global'
> {
    /**
     * Required when the public preview/redeem flow is enabled. Admin-only
     * setups do not need an app-specific customer-history check.
     */
    firstTimeCustomerCheck?: ProviderSpec<FirstTimeCustomerCheck>;
    /** Override the default controller guards + `SuperAdminGuard` chain. */
    adminGuards?: Array<Type<CanActivate>>;
    /**
     * Mount the SuperAdmin promo-code CRUD controller. Default `true`.
     *
     * Set `false` when the app serves `/admin/promo-codes` itself — two
     * controllers on one path abort the boot with a duplicate-route error.
     * The promo domain service stays available either way, so an app-owned
     * controller can still delegate its validation to the platform.
     */
    adminController?: false;
}

/** First-run setup, deriving the provisioning adapter from persistence by default. */
export interface SaaSiCatSetupOptions extends Omit<
    SetupModuleOptions,
    'provisioningPort' | 'global'
> {
    provisioningPort?: SetupModuleOptions['provisioningPort'];
}

/** Admin dashboard statistics; the audit port can come from persistence. */
export interface SaaSiCatAdminStatsOptions extends Omit<
    AdminStatsModuleOptions,
    'auditStatsPort' | 'global'
> {
    auditStatsPort?: AdminStatsModuleOptions['auditStatsPort'];
}

/**
 * Public checkout-offer flow. Catalog repositories default to the persistence
 * bundle, while the app still supplies its checkout-offer repository.
 */
export interface SaaSiCatCheckoutOfferOptions extends Omit<
    CheckoutOfferModuleOptions,
    'bundleRepository' | 'planRepository' | 'catalogEntryRepository' | 'global'
> {
    bundleRepository?: CheckoutOfferModuleOptions['bundleRepository'];
    planRepository?: CheckoutOfferModuleOptions['planRepository'];
    catalogEntryRepository?: CheckoutOfferModuleOptions['catalogEntryRepository'];
}

/** Subscription-contract service, deriving its repository from persistence by default. */
export interface SaaSiCatSubscriptionContractOptions extends Omit<
    SubscriptionContractModuleOptions,
    'subscriptionContractRepository' | 'global'
> {
    subscriptionContractRepository?: SubscriptionContractModuleOptions['subscriptionContractRepository'];
}

/**
 * What `SaaSiCatModule.forRoot()` composes.
 *
 * One subsystem is deliberately absent: **self-registration**. A prospect
 * signing themselves up — mail address, OTP, plan choice, payment, activation —
 * is `RegistrationModule` from `@saasicat/nest/registration`, and it is
 * hand-wired: ten required ports, none of which a persistence bundle supplies.
 *
 * That is a decision with a reason and a plan, not an omission: the ten ports
 * have no executable contract yet (`@saasicat/persistence-testing` covers the
 * catalogue, subscription, promo and audit ports and none of these), and
 * folding unverified ports into a bundle would move the problem rather than
 * check it. See `docs/guides/self-registration.md`.
 *
 * Everything else — an operator creating tenants through the SuperAdmin UI, a
 * CLI, or your own onboarding form — is composed here.
 */
export interface SaaSiCatModuleOptions {
    /**
     * Plan catalog. Either as an already-loaded object (quickstart, comes
     * directly from `loadPlanCatalogFromFile('config/saas.yaml')`) or via DB
     * hydration: a sink reference in `adapters.planCatalogReadSink` /
     * `persistence.planCatalogReadSink` **plus** the `dbCatalog` identity.
     */
    planCatalog?: PlanCatalog;
    /**
     * App identity for the DB-hydration path — required when `planCatalog`
     * is omitted. The read sink only loads plans and features; branding,
     * currency and VAT cannot come from the database and must be supplied
     * here.
     */
    dbCatalog?: {
        currency: string;
        vatRate: number;
        app: PlanCatalog['app'];
        marketing?: PlanCatalog['marketing'];
    };
    /**
     * Aggregate persistence bundle from an adapter package (e.g.
     * `prismaPersistence({ client: PrismaService })` from
     * `@saasicat/adapter-prisma`). Fills every port the bundle ships;
     * individual `adapters` entries override bundle slices. The declared
     * `capabilities` are validated fail-fast against the enabled feature set
     * (e.g. `entitlement: true` requires transactions + pessimistic locking).
     */
    persistence?: SaaSiCatPersistenceAdapter;
    /**
     * Individual adapter bindings. Optional when `persistence` provides the
     * respective port; explicit entries take precedence over the bundle.
     */
    adapters?: SaaSiCatAdapters;
    /**
     * Class-level guards for the platform controllers (`GET /admin/discovery`
     * and `GET /admin/manifest`). REQUIRED — otherwise the platform throws at
     * boot, because a manifest controller must never be silently registered
     * without auth (platform security).
     *
     * Pass `[]` explicitly if the endpoint is intentionally auth-free
     * (CI/smoke test).
     */
    controller: { guards: Array<Type<CanActivate>> };
    /**
     * Additional guards only for `POST /admin/manifest/reload` (typically:
     * `MfaGuard`). Optional.
     */
    reloadGuards?: Array<Type<CanActivate>>;
    /**
     * Mount the platform's `GET /admin/manifest` + `POST /admin/manifest/reload`
     * controller. Default `true`.
     *
     * Set `false` when the app serves those routes from its own controller —
     * two controllers on one path abort the boot with a duplicate-route error
     * (`FST_ERR_DUPLICATED_ROUTE` under Fastify), so this is not something the
     * app can simply override.
     */
    includeManifestController?: boolean;
    /**
     * Modules whose providers must be visible in the DI scope (typically:
     * `AuthModule` with the `JwtAuthGuard`).
     */
    imports?: PlatformImports;
    /**
     * App identity for the DiscoveryScanner. If omitted, `planCatalog.app` is
     * used (recommendation: simply declare it in the YAML).
     */
    app?: DiscoveryAppInfo;
    /**
     * Optional — snapshot path for the DiscoveryScanner. Default:
     * `var/discovery-snapshot.json`. `null` to disable.
     */
    discoverySnapshotPath?: string | null;
    /**
     * `AdminManifestConfig`. If omitted, the module assembles a minimal variant
     * from `planCatalog` — good for quickstart, but for full manifest features
     * (build hash, locales, KPI cards) the consumer should provide its own
     * factory.
     */
    adminManifestConfig?:
        AdminManifestConfig | Pick<FactoryProvider<AdminManifestConfig>, 'useFactory' | 'inject'>;
    /** Providers required by `adminManifestConfig` when it uses a factory. */
    adminManifestExtraProviders?: Provider[];
    /**
     * Infer manifest capabilities for platform endpoints mounted by this
     * module. Default `true`; set `false` only when the app owns the complete
     * manifest capability policy.
     */
    autoManifest?: boolean;
    /**
     * Default `false`. When set, `EntitlementModule.forRoot({...})` is called
     * with the repositories from `adapters` — only meaningful if the app
     * implements the V3 contract path (`subscriptionRepository` & co. must then
     * be set). `tenantBilling` and `subscriptionBundles` enable it
     * automatically.
     */
    entitlement?:
        | false
        | {
              resolutionConfig?: EntitlementResolutionConfig;
          };
    /**
     * Fallback plan ID for the `StaticPlanResolver`. If neither
     * `adapters.planResolver` nor `defaultPlanId` is set, the
     * `StaticEntitlementService` is not activated — `@RequireFeature`/
     * `@EnforceQuota` are then **ineffective** (discovery markup with no
     * runtime effect). Platform warning at boot.
     */
    defaultPlanId?: string;
    /**
     * QuotaProvider classes declared with `@DefinesQuota({...})` that the
     * `EnforceQuotaInterceptor` must use for count calculation. The platform
     * registers them as app providers and collects them in
     * `QUOTA_PROVIDERS_TOKEN`.
     */
    quotaProviders?: Array<Type<QuotaProvider>>;
    /**
     * Standard DB-backed catalog stack. Repositories are taken from
     * `persistence.catalog`; no consumer forwarding module is needed.
     */
    catalog?: false | SaaSiCatCatalogOptions;
    /**
     * Standard tenant self-service stack. Subscription read/write adapters
     * come from `persistence.tenantBilling`; usage is derived from
     * `quotaProviders` unless explicitly overridden.
     */
    tenantBilling?: false | SaaSiCatTenantBillingOptions;
    /**
     * Add-on bundle service and tenant controller. `true` uses defaults and
     * reuses tenant-billing auth/usage; an object customizes policy.
     */
    subscriptionBundles?: false | true | SaaSiCatSubscriptionBundlesOptions;
    /**
     * Standard SuperAdmin Tenant/User/Audit/Subscription endpoints. `true`
     * uses `persistence.adminResources` and the standard guard chain.
     */
    adminResources?: false | true | SaaSiCatAdminResourcesOptions;
    /**
     * Promo-code domain and SuperAdmin CRUD. `true` enables the admin API
     * without the public preview endpoint; pass an object to enable preview.
     */
    promoCodes?: false | true | SaaSiCatPromoCodesOptions;
    /**
     * First-run SuperAdmin setup. `true` uses
     * `persistence.core.superAdminProvisioning`; an object customizes it or
     * supplies an app-specific provisioning adapter.
     */
    setup?: false | true | SaaSiCatSetupOptions;
    /** SuperAdmin dashboard statistics with app-specific subscription/promo ports. */
    adminStats?: false | SaaSiCatAdminStatsOptions;
    /** Public checkout-offer flow; catalog repositories reuse `persistence.catalog`. */
    checkoutOffer?: false | SaaSiCatCheckoutOfferOptions;
    /**
     * Subscription-contract service. `true` reuses
     * `persistence.entitlement.subscriptionContractRepository`.
     */
    subscriptionContract?: false | true | SaaSiCatSubscriptionContractOptions;
    /**
     * Enable the tenant manifest — the app UI gets a filtered manifest per
     * tenant with features, quotas and visible navigation. Requires that
     * `defaultPlanId`, `adapters.planResolver` or `tenantBilling` is set.
     * `true` reuses tenant-billing guard classes when available, otherwise
     * `controller.guards`.
     */
    tenantManifest?: true | TenantManifestControllerOptions;
    /**
     * Bind `StaticFeatureGuard` as a global `APP_GUARD`. Default `true`.
     *
     * Set `false` when the app authenticates in a controller-local guard.
     * Nest runs every global guard before every controller-local one, so a
     * global feature guard sees no `request.user` and rejects with 403 before
     * authentication has run.
     *
     * REQUIRED when you set this: bind a feature guard yourself, behind your
     * auth guard, or `@RequireFeature` becomes inert markup and every
     * annotated route serves unlicensed traffic. Either
     * `@UseGuards(JwtAuthGuard, StaticFeatureGuard)` — the guard this option
     * unbinds, exported from this entry — or `@UseGuards(JwtAuthGuard,
     * FeatureGuard)` from `@saasicat/nest/billing` if you run the V3
     * entitlement stack. They are different classes; pick the one matching
     * your entitlement path.
     *
     * Only the guard is affected. `EnforceQuotaInterceptor` stays global
     * either way — interceptors run after all guards, so it does see the
     * authenticated request.
     */
    globalFeatureGuard?: boolean;
    /**
     * Run the enforcement-chain check at bootstrap. Default `true`.
     *
     * It refuses to start an application whose `@RequireFeature` routes have
     * nothing enforcing them — the failure that otherwise shows up as a
     * customer using a feature they never bought.
     *
     * Two shapes it cannot recognise, and they are the reason this switch
     * exists rather than being an argument about the check: a feature guard of
     * your own that WRAPS ours without carrying `FEATURE_GUARD_MARKER`, and one
     * you bind globally as an `APP_GUARD` instead of per controller. Both are
     * correctly enforced and both look uncovered from here.
     *
     * Turning it off buys silence, not safety: those routes are then unchecked
     * by anything, and whether they are covered is back to being something you
     * know rather than something the boot verifies.
     */
    enforcementChainCheck?: boolean;
}
