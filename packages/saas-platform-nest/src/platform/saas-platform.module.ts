// SaasPlatformModule — high-level composition module. The base path bundles
// PlanCatalog, Discovery, Admin and AdminManifest; the standard options add
// Entitlement, Catalog, PublicCatalog, TenantBilling and SubscriptionBundles
// without consumer forwarding modules.
//
// Goal: consumer code describes product-specific choices while a persistence
// bundle supplies standard repositories. Individual modules remain available
// as the escape hatch.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P1.
//
// Whoever needs more control (multiple manifest controllers, differing guards
// per endpoint, custom catalog adapters etc.) keeps using the individual modules
// directly — this mega-module is a convenience, not a requirement.

import {
    type CanActivate,
    type DynamicModule,
    type FactoryProvider,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type {
    AuditPort,
    AdminResourcesPort,
    FeatureUiRegistry,
    FirstTimeCustomerCheck,
    ManifestContribution,
    MfaPort,
    PlanCatalog,
    PlanCatalogReadSink,
    PlanVersionRepository,
    QuotaProvider,
    RlsBypassPort,
    SaasicatPersistenceAdapter,
    SubscriptionBundleRepository,
    SubscriptionRepository,
    SubscriptionUsagePort,
    TenantSubscriptionWritePort,
    TransactionRunner,
    UsageSnapshotPort,
} from '@saasicat/types';
import { assertPersistenceCapabilities } from '@saasicat/types';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { AdminModule } from '../admin/module.js';
import {
    AdminResourcesModule,
    type AdminResourcesModuleOptions,
} from '../admin/admin-resources.module.js';
import { AdminManifestModule } from '../admin/admin-manifest.module.js';
import { type AdminManifestConfig } from '../admin/admin-manifest.config.js';
import { AdminManifestService } from '../admin/admin-manifest.service.js';
import { SuperAdminGuard } from '../admin/super-admin.guard.js';
import {
    PublicCatalogModule,
    type SubscriptionBundleControllerOptions,
    SubscriptionBundleModule,
    type SubscriptionBundleModuleOptions,
    TenantBillingModule,
    type TenantBillingModuleOptions,
} from '../billing/index.js';
import { PlanCatalogModule, PLAN_CATALOG_TOKEN } from '../billing/plan-catalog.module.js';
import { CatalogModule, type CatalogModuleOptions } from '../catalog/catalog.module.js';
import { DiscoveryModule } from '../discovery/discovery.module.js';
import type { DiscoveryAppInfo } from '../discovery/discovery.scanner.js';
import { EntitlementModule } from '../entitlement/module.js';
import type { EntitlementResolutionConfig } from '../entitlement/plan-resolution.js';
import { PromoCodesModule, type PromoCodesModuleOptions } from '../promo/module.js';
import {
    PLAN_RESOLVER_PORT_TOKEN,
    type PlanResolverPort,
    StaticPlanResolver,
} from './plan-resolver.port.js';
import { StaticEntitlementService } from './static-entitlement.service.js';
import { StaticFeatureGuard } from './static-feature.guard.js';
import { EnforceQuotaInterceptor, QUOTA_PROVIDERS_TOKEN } from './enforce-quota.interceptor.js';
import { QuotaProvidersUsageSnapshot } from './quota-providers-usage-snapshot.js';
import { SubscriptionPlanResolver } from './subscription-plan-resolver.js';
import { TenantManifestService } from './tenant-manifest.service.js';
import {
    buildTenantManifestController,
    type TenantManifestControllerOptions,
} from './tenant-manifest.controller.js';

/**
 * Adapter bindings for the platform ports. Accepted as class tokens, values
 * or factory specs.
 *
 * `mfa`/`audit`/`rlsBypass` are optional because the `persistence` bundle
 * supplies them by default; pass them here only to override the bundle, or
 * when wiring adapters without a bundle. The module validates that each port
 * ends up provided by exactly one of the two paths.
 */
export interface SaasPlatformAdapters {
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

export interface SaasPlatformCatalogOptions extends Pick<
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

export type SaasPlatformTenantAuthGuards =
    Array<Type<CanActivate>> | ProviderSpec<ReadonlyArray<CanActivate>>;

export interface SaasPlatformTenantBillingOptions extends Omit<
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
    authGuards: SaasPlatformTenantAuthGuards;
    /** Optional overrides; otherwise the persistence bundle supplies them. */
    subscriptionUsagePort?: ProviderSpec<SubscriptionUsagePort>;
    usageSnapshotPort?: ProviderSpec<UsageSnapshotPort>;
    subscriptionWritePort?: ProviderSpec<TenantSubscriptionWritePort>;
}

export interface SaasPlatformSubscriptionBundlesOptions extends Omit<
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

export interface SaasPlatformAdminResourcesOptions extends Omit<
    AdminResourcesModuleOptions,
    'resources' | 'guards' | 'global'
> {
    /** Override the default controller guards + `SuperAdminGuard` chain. */
    guards?: Array<Type<CanActivate>>;
    /** Custom schema override; the persistence bundle supplies the default. */
    resources?: ProviderSpec<AdminResourcesPort>;
}

export interface SaasPlatformPromoCodesOptions extends Omit<
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

export interface SaasPlatformModuleOptions {
    /**
     * Plan catalog. Either as an already-loaded object (quickstart, comes
     * directly from `loadPlanCatalogFromFile('config/saas.yaml')`) or via DB
     * hydration: a sink reference in `adapters.planCatalogReadSink` /
     * `persistence.planCatalogReadSink` **plus** the `dbCatalog` identity.
     */
    planCatalog?: PlanCatalog;
    /**
     * App identity for the DB-hydration path — required when `planCatalog`
     * is omitted. The read sink only loads plans/features (filtered by
     * `projectKey`); branding, currency and VAT cannot come from the
     * database and must be supplied here.
     */
    dbCatalog?: {
        projectKey: string;
        currency: string;
        vatRate: number;
        app?: PlanCatalog['app'];
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
    persistence?: SaasicatPersistenceAdapter;
    /**
     * Individual adapter bindings. Optional when `persistence` provides the
     * respective port; explicit entries take precedence over the bundle.
     */
    adapters?: SaasPlatformAdapters;
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
    catalog?: false | SaasPlatformCatalogOptions;
    /**
     * Standard tenant self-service stack. Subscription read/write adapters
     * come from `persistence.tenantBilling`; usage is derived from
     * `quotaProviders` unless explicitly overridden.
     */
    tenantBilling?: false | SaasPlatformTenantBillingOptions;
    /**
     * Add-on bundle service and tenant controller. `true` uses defaults and
     * reuses tenant-billing auth/usage; an object customizes policy.
     */
    subscriptionBundles?: false | true | SaasPlatformSubscriptionBundlesOptions;
    /**
     * Standard SuperAdmin Tenant/User/Audit/Subscription endpoints. `true`
     * uses `persistence.adminResources` and the standard guard chain.
     */
    adminResources?: false | true | SaasPlatformAdminResourcesOptions;
    /**
     * Promo-code domain and SuperAdmin CRUD. `true` enables the admin API
     * without the public preview endpoint; pass an object to enable preview.
     */
    promoCodes?: false | true | SaasPlatformPromoCodesOptions;
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
     * authentication has run. Apps in that shape bind the guard themselves,
     * behind their auth guard: `@UseGuards(JwtAuthGuard, FeatureGuard)`.
     *
     * Only the guard is affected. `EnforceQuotaInterceptor` stays global
     * either way — interceptors run after all guards, so it does see the
     * authenticated request.
     */
    globalFeatureGuard?: boolean;
}

const PLATFORM_SUBSCRIPTION_REPOSITORY_TOKEN = Symbol.for(
    'saas-platform-nest/PlatformSubscriptionRepository',
);
const STANDARD_MANIFEST_REGISTRATION_TOKEN = Symbol.for(
    'saas-platform-nest/StandardManifestRegistration',
);

function buildStandardManifestContribution(
    catalog: SaasPlatformCatalogOptions | null,
    adminResources: SaasPlatformAdminResourcesOptions | true | null,
    promoCodes: SaasPlatformPromoCodesOptions | true | null,
): ManifestContribution {
    const capabilities: NonNullable<ManifestContribution['capabilities']> = {
        'discovery.read': true,
    };

    if (catalog && catalog.adminControllers !== false) {
        Object.assign(capabilities, {
            'plans.read': true,
            'plans.publish': true,
            'bundles.read': true,
            'bundles.write': true,
            'bundles.publish': true,
            'marketingProjections.read': true,
            'marketingProjections.write': true,
        });
    }

    const navigation: ManifestContribution['navigation'] = {};
    if (adminResources) {
        Object.assign(capabilities, {
            'tenants.read': true,
            'tenants.suspend': true,
            'tenants.reactivate': true,
            'users.read': true,
            'audit.read': true,
            'subscriptions.read': true,
        });
        navigation.standardPages = {
            subscriptions: {
                enabled: true,
                requiredCapability: 'subscriptions.read',
            },
        };
    }
    if (promoCodes) {
        Object.assign(capabilities, {
            'promoCodes.read': true,
            'promoCodes.write': true,
            'promoCodes.delete': true,
        });
        navigation.standardPages = {
            ...(navigation.standardPages ?? {}),
            promoCodes: {
                enabled: true,
                requiredCapability: 'promoCodes.read',
            },
        };
    }

    return {
        capabilities,
        navigation: navigation.standardPages ? navigation : undefined,
    };
}

function normalizeTenantAuthGuards(
    guards: SaasPlatformTenantAuthGuards,
): ProviderSpec<ReadonlyArray<CanActivate>> {
    if (!Array.isArray(guards)) return guards;
    return {
        useFactory: (...instances: CanActivate[]) => instances,
        inject: guards,
    };
}

function quotaUsageSnapshotProvider(
    quotaProviders: Array<Type<QuotaProvider>>,
): ProviderSpec<UsageSnapshotPort> {
    return {
        useFactory: (...providers: QuotaProvider[]) => new QuotaProvidersUsageSnapshot(providers),
        inject: quotaProviders,
    };
}

function buildMinimalManifestConfig(): Pick<FactoryProvider, 'useFactory' | 'inject'> {
    return {
        useFactory: (catalog: PlanCatalog): AdminManifestConfig => ({
            project: {
                key: catalog.projectKey,
                displayName: catalog.app?.name ?? catalog.projectKey,
                label: catalog.app?.label,
                icon: catalog.app?.icon,
                logoUrl: catalog.app?.logoUrl,
                environment: (process.env.NODE_ENV === 'production'
                    ? 'production'
                    : 'development') as 'production' | 'development',
                availableLocales: catalog.marketing?.availableLocales,
                defaultLocale: catalog.marketing?.availableLocales?.[0],
            },
            build: {
                platformPackageVersion: '0.0.0',
                appVersion: '0.0.0',
            },
            planCatalogSnapshot: {
                source: 'saas-platform-module',
                hash: 'sha256-quickstart',
                currency: catalog.currency,
                vatRate: catalog.vatRate,
                plans: catalog.plans ?? [],
                features: catalog.features ?? [],
            },
        }),
        inject: [PLAN_CATALOG_TOKEN],
    };
}

/**
 * Bundles PlanCatalog + Discovery + Admin + AdminManifest (+ optionally
 * Entitlement) into a single `forRoot({...})` call. Reduces AppModule
 * boilerplate and eliminates the ordering trap.
 *
 * Quickstart path (Prisma + PostgreSQL on the canonical schema):
 *
 * ```ts
 * SaasPlatformModule.forRoot({
 *     planCatalog: loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),
 *     controller: { guards: [JwtAuthGuard] },
 *     imports: [AuthModule],
 *     persistence: prismaPersistence({ client: PrismaService }), // @saasicat/adapter-prisma
 * })
 * ```
 *
 * Individual `adapters` entries stay supported (custom schema / other ORM)
 * and override bundle slices field by field.
 */
@Module({})
export class SaasPlatformModule {
    static forRoot(options: SaasPlatformModuleOptions): DynamicModule {
        const explicit = options.adapters ?? ({} as SaasPlatformAdapters);
        const persistence = options.persistence;
        const catalogConfig = options.catalog || null;
        const tenantBillingConfig = options.tenantBilling || null;
        const subscriptionBundlesConfig = options.subscriptionBundles || null;
        const adminResourcesConfig = options.adminResources || null;
        const promoCodesConfig = options.promoCodes || null;
        const requiresFullEntitlement = Boolean(
            options.entitlement || tenantBillingConfig || subscriptionBundlesConfig,
        );
        // Explicit adapter entries override the bundle slices.
        const adapters: SaasPlatformAdapters = {
            mfa: explicit.mfa ?? persistence?.core.mfa,
            audit: explicit.audit ?? persistence?.core.audit,
            rlsBypass: explicit.rlsBypass ?? persistence?.core.rlsBypass,
            planCatalogReadSink: explicit.planCatalogReadSink ?? persistence?.planCatalogReadSink,
            planResolver: explicit.planResolver,
            subscriptionRepository:
                explicit.subscriptionRepository ?? persistence?.entitlement?.subscriptionRepository,
            planVersionRepository:
                explicit.planVersionRepository ?? persistence?.entitlement?.planVersionRepository,
            transactionRunner: explicit.transactionRunner ?? persistence?.core.transactionRunner,
        } as SaasPlatformAdapters;

        const missingCore = (['mfa', 'audit', 'rlsBypass'] as const).filter(
            (key) => adapters[key] === undefined,
        );
        if (missingCore.length) {
            throw new Error(
                `SaasPlatformModule.forRoot: adapters missing (provide them via \`adapters\` or a \`persistence\` bundle): ${missingCore.join(', ')}`,
            );
        }
        // Non-null after the guard above — AdminModule requires them.
        const mfaPort = adapters.mfa as ProviderSpec<MfaPort>;
        const auditPort = adapters.audit as ProviderSpec<AuditPort>;
        const rlsBypassPort = adapters.rlsBypass as ProviderSpec<RlsBypassPort>;
        if (!options.planCatalog && (!adapters.planCatalogReadSink || !options.dbCatalog)) {
            // Without the identity the sink would load with projectKey '' and
            // the app would boot with a silently empty catalog.
            throw new Error(
                'SaasPlatformModule.forRoot: either set `planCatalog` (quickstart YAML path) or, ' +
                    'for DB hydration, BOTH a planCatalogReadSink (`adapters`/`persistence`) AND ' +
                    '`dbCatalog` ({ projectKey, currency, vatRate }).',
            );
        }
        if (catalogConfig && !persistence?.catalog) {
            throw new Error(
                'SaasPlatformModule.forRoot: catalog is enabled, but `persistence.catalog` is missing. ' +
                    'Use a complete persistence bundle or wire CatalogModule directly.',
            );
        }
        if (
            adminResourcesConfig &&
            adminResourcesConfig !== true &&
            !adminResourcesConfig.resources &&
            !persistence?.adminResources
        ) {
            throw new Error(
                'SaasPlatformModule.forRoot: adminResources is enabled, but `persistence.adminResources` is missing.',
            );
        }
        if (promoCodesConfig && (!persistence?.promo || !adapters.transactionRunner)) {
            throw new Error(
                'SaasPlatformModule.forRoot: promoCodes requires `persistence.promo` and a transactionRunner.',
            );
        }
        if (
            promoCodesConfig &&
            promoCodesConfig !== true &&
            promoCodesConfig.includePublicController !== false &&
            !promoCodesConfig.firstTimeCustomerCheck
        ) {
            throw new Error(
                'SaasPlatformModule.forRoot: public promo preview requires `firstTimeCustomerCheck`.',
            );
        }
        if (adminResourcesConfig === true && !persistence?.adminResources) {
            throw new Error(
                'SaasPlatformModule.forRoot: adminResources is enabled, but `persistence.adminResources` is missing.',
            );
        }
        if (tenantBillingConfig && !persistence?.tenantBilling) {
            const missing = [
                !tenantBillingConfig.subscriptionUsagePort && 'subscriptionUsagePort',
                !tenantBillingConfig.subscriptionWritePort && 'subscriptionWritePort',
            ].filter(Boolean);
            if (missing.length) {
                throw new Error(
                    `SaasPlatformModule.forRoot: tenantBilling is enabled, but adapters are missing: ${missing.join(', ')}`,
                );
            }
        }
        if (subscriptionBundlesConfig && !tenantBillingConfig) {
            throw new Error(
                'SaasPlatformModule.forRoot: subscriptionBundles requires tenantBilling so auth and subscription usage can be shared.',
            );
        }
        if (subscriptionBundlesConfig) {
            const missing: string[] = [];
            if (!persistence?.entitlement?.subscriptionBundleRepository) {
                missing.push('subscriptionBundleRepository');
            }
            if (!persistence?.catalog?.bundleRepository) {
                missing.push('bundleRepository');
            }
            if (missing.length) {
                throw new Error(
                    `SaasPlatformModule.forRoot: subscriptionBundles is enabled, but persistence adapters are missing: ${missing.join(', ')}`,
                );
            }
        }
        if (requiresFullEntitlement) {
            const missing: string[] = [];
            if (!adapters.subscriptionRepository) missing.push('subscriptionRepository');
            if (!adapters.planVersionRepository) missing.push('planVersionRepository');
            if (!adapters.transactionRunner) missing.push('transactionRunner');
            if (missing.length) {
                throw new Error(
                    `SaasPlatformModule.forRoot: entitlement active or required by the standard stack, but adapters are missing: ${missing.join(', ')}`,
                );
            }
            if (persistence) {
                // The transactional enforceLimit() path is only correct with
                // real transactions + row locks — refuse to boot degraded.
                assertPersistenceCapabilities(
                    persistence.capabilities,
                    { transactions: true, pessimisticLocking: true },
                    'SaasPlatformModule entitlement (transactional enforceLimit)',
                );
            }
        }

        // Validation above guarantees dbCatalog on the DB-hydration branch.
        const dbCatalog = options.dbCatalog as NonNullable<typeof options.dbCatalog>;
        const planCatalogModule: DynamicModule = options.planCatalog
            ? PlanCatalogModule.forRootWithCatalog(options.planCatalog, { global: true })
            : PlanCatalogModule.forRoot({
                  projectKey: dbCatalog.projectKey,
                  app: dbCatalog.app,
                  currency: dbCatalog.currency,
                  vatRate: dbCatalog.vatRate,
                  marketing: dbCatalog.marketing,
                  sink: adapters.planCatalogReadSink as ProviderSpec<PlanCatalogReadSink>,
                  imports: options.imports,
              });

        const appInfo: DiscoveryAppInfo = options.app ?? {
            key: options.planCatalog?.projectKey ?? options.dbCatalog?.projectKey ?? 'app',
            version:
                options.planCatalog?.app?.version ?? options.dbCatalog?.app?.version ?? '0.0.0',
        };

        const imports: NonNullable<DynamicModule['imports']> = [
            // Make injected client/auth providers visible to the high-level
            // module's own quota providers and automatic plan resolver too.
            ...(options.imports ?? []),
            planCatalogModule,
            DiscoveryModule.forRoot({
                app: appInfo,
                controller: { guards: options.controller.guards },
                imports: options.imports,
                snapshotPath:
                    options.discoverySnapshotPath === undefined
                        ? 'var/discovery-snapshot.json'
                        : options.discoverySnapshotPath,
            }),
            AdminModule.forRoot({
                mfaPort,
                auditPort,
                rlsBypassPort,
                imports: options.imports,
                global: true,
            }),
            AdminManifestModule.forRoot({
                config: options.adminManifestConfig ?? buildMinimalManifestConfig(),
                includeManifestController: options.includeManifestController,
                guards: options.controller.guards,
                reloadGuards: options.reloadGuards,
                imports: options.imports,
                // Global like AdminModule above: apps register their manifest
                // contribution by injecting AdminManifestService into one of
                // their own modules (handbook §6.6). Re-exporting the module
                // from here does not make that injection resolvable.
                global: true,
            }),
        ];

        if (requiresFullEntitlement) {
            imports.push(
                EntitlementModule.forRoot({
                    subscriptionRepository:
                        adapters.subscriptionRepository as ProviderSpec<SubscriptionRepository>,
                    planVersionRepository:
                        adapters.planVersionRepository as ProviderSpec<PlanVersionRepository>,
                    transactionRunner:
                        adapters.transactionRunner as ProviderSpec<TransactionRunner>,
                    resolutionConfig: options.entitlement
                        ? options.entitlement.resolutionConfig
                        : undefined,
                    subscriptionContractRepository:
                        persistence?.entitlement?.subscriptionContractRepository,
                    subscriptionBundleRepository:
                        persistence?.entitlement?.subscriptionBundleRepository,
                    bundleRepository: persistence?.entitlement?.bundleRepository,
                    imports: options.imports,
                    global: Boolean(tenantBillingConfig || subscriptionBundlesConfig),
                }),
            );
        }

        if (catalogConfig) {
            const catalog = persistence?.catalog as NonNullable<
                SaasicatPersistenceAdapter['catalog']
            >;
            imports.push(
                CatalogModule.forRoot({
                    planRepository: catalog.planRepository,
                    bundleRepository: catalog.bundleRepository,
                    catalogEntryRepository: catalog.catalogEntryRepository,
                    marketingProjectionRepository: catalog.marketingProjectionRepository,
                    promotionRepository: catalog.promotionRepository,
                    marketingSettingsRepository: catalog.marketingSettingsRepository,
                    controller:
                        catalogConfig.adminControllers === false
                            ? undefined
                            : { guards: options.controller.guards },
                    imports: catalogConfig.imports ?? options.imports,
                    extraProviders: catalogConfig.extraProviders,
                    strictModeCheckMode: catalogConfig.strictModeCheckMode,
                    autoSyncDiscoveryAtBoot: catalogConfig.autoSyncDiscoveryAtBoot,
                    marketedOnlyFeatures: catalogConfig.marketedOnlyFeatures,
                    featureUiRegistry: catalogConfig.featureUiRegistry,
                    publicMarketingCatalog: catalogConfig.publicMarketingCatalog,
                }),
            );

            if (catalogConfig.publicCatalog !== false) {
                imports.push(
                    PublicCatalogModule.forRoot({
                        featureUiRegistry: catalogConfig.featureUiRegistry,
                        projectKey: appInfo.key,
                        bundleRepository: catalog.bundleRepository,
                        marketingRepository: catalog.marketingProjectionRepository,
                        catalogEntryRepository: catalog.catalogEntryRepository,
                        imports: catalogConfig.imports ?? options.imports,
                    }),
                );
            }
        }

        if (adminResourcesConfig) {
            const config = adminResourcesConfig === true ? {} : adminResourcesConfig;
            imports.push(
                AdminResourcesModule.forRoot({
                    resources:
                        config.resources ??
                        (persistence?.adminResources
                            ?.resources as ProviderSpec<AdminResourcesPort>),
                    guards: config.guards ?? [...options.controller.guards, SuperAdminGuard],
                    imports: config.imports ?? options.imports,
                }),
            );
        }

        if (promoCodesConfig) {
            const config = promoCodesConfig === true ? {} : promoCodesConfig;
            const promo = persistence?.promo as NonNullable<SaasicatPersistenceAdapter['promo']>;
            const {
                firstTimeCustomerCheck,
                adminGuards,
                imports: promoImports,
                includePublicController,
                adminController,
                ...promoOptions
            } = config;
            imports.push(
                PromoCodesModule.forRoot({
                    ...promoOptions,
                    promoCodeRepository: promo.promoCodeRepository,
                    redemptionRepository: promo.redemptionRepository,
                    validationLogRepository: promo.validationLogRepository,
                    subscriptionLookup: promo.subscriptionLookup,
                    revenueAggregator: promo.revenueAggregator,
                    transactionRunner:
                        adapters.transactionRunner as ProviderSpec<TransactionRunner>,
                    firstTimeCustomerCheck: firstTimeCustomerCheck ?? {
                        hasExistingCustomerForEmail: async () => false,
                    },
                    includePublicController: includePublicController ?? false,
                    adminController:
                        adminController === false
                            ? false
                            : {
                                  guards: adminGuards ?? [
                                      ...options.controller.guards,
                                      SuperAdminGuard,
                                  ],
                              },
                    imports: promoImports ?? options.imports,
                }),
            );
        }

        let sharedTenantAuthGuards: ProviderSpec<ReadonlyArray<CanActivate>> | undefined;
        let sharedSubscriptionUsagePort: ProviderSpec<SubscriptionUsagePort> | undefined;
        let quotaProvidersHostedByTenantBilling = false;
        if (tenantBillingConfig) {
            const tenantSlice = persistence?.tenantBilling;
            const {
                authGuards,
                subscriptionUsagePort,
                usageSnapshotPort,
                subscriptionWritePort,
                imports: tenantImports,
                extraProviders,
                extraExports,
                ...tenantOptions
            } = tenantBillingConfig;
            const quotaProviders = options.quotaProviders ?? [];
            quotaProvidersHostedByTenantBilling = quotaProviders.length > 0;
            sharedTenantAuthGuards = normalizeTenantAuthGuards(authGuards);
            sharedSubscriptionUsagePort =
                subscriptionUsagePort ?? tenantSlice?.subscriptionUsagePort;
            const resolvedUsageSnapshotPort =
                usageSnapshotPort ??
                tenantSlice?.usageSnapshotPort ??
                quotaUsageSnapshotProvider(options.quotaProviders ?? []);

            imports.push(
                TenantBillingModule.forRoot({
                    ...tenantOptions,
                    authGuards: sharedTenantAuthGuards,
                    subscriptionUsagePort:
                        sharedSubscriptionUsagePort as ProviderSpec<SubscriptionUsagePort>,
                    usageSnapshotPort: resolvedUsageSnapshotPort,
                    subscriptionWritePort:
                        subscriptionWritePort ??
                        (tenantSlice?.subscriptionWritePort as ProviderSpec<TenantSubscriptionWritePort>),
                    imports: tenantImports ?? options.imports,
                    extraProviders: [...quotaProviders, ...(extraProviders ?? [])],
                    extraExports: [...quotaProviders, ...(extraExports ?? [])],
                }),
            );
        }

        if (subscriptionBundlesConfig) {
            const config = subscriptionBundlesConfig === true ? {} : subscriptionBundlesConfig;
            const { controller, imports: bundleImports, extraProviders, ...bundleOptions } = config;
            imports.push(
                SubscriptionBundleModule.forRoot({
                    ...bundleOptions,
                    subscriptionBundleRepository: persistence?.entitlement
                        ?.subscriptionBundleRepository as ProviderSpec<SubscriptionBundleRepository>,
                    bundleRepository: persistence?.catalog?.bundleRepository,
                    controller:
                        controller === false
                            ? undefined
                            : {
                                  ...(controller ?? {}),
                                  authGuards: sharedTenantAuthGuards,
                                  subscriptionUsagePort: sharedSubscriptionUsagePort,
                              },
                    imports: bundleImports ?? tenantBillingConfig?.imports ?? options.imports,
                    extraProviders,
                }),
            );
        }

        // ------------------------------------------------------------------
        // Lightweight static-entitlement stack: auto-wire FeatureGuard +
        // EnforceQuotaInterceptor so that `@RequireFeature` and
        // `@EnforceQuota` take effect right after the mega-module import.
        // Condition: PlanResolver or defaultPlanId.
        // ------------------------------------------------------------------
        const lightweightProviders: Provider[] = [];
        const lightweightExports: NonNullable<DynamicModule['exports']> = [];
        if (options.autoManifest !== false) {
            const contribution = buildStandardManifestContribution(
                catalogConfig,
                adminResourcesConfig,
                promoCodesConfig,
            );
            lightweightProviders.push({
                provide: STANDARD_MANIFEST_REGISTRATION_TOKEN,
                useFactory: (manifest: AdminManifestService) => {
                    manifest.register(contribution);
                    return contribution;
                },
                inject: [AdminManifestService],
            });
        }
        const hasExplicitResolver = !!adapters.planResolver;
        const hasSubscriptionResolver = Boolean(
            tenantBillingConfig && adapters.subscriptionRepository,
        );
        const hasResolver = hasExplicitResolver || hasSubscriptionResolver;
        const hasFallback = !!options.defaultPlanId;
        if (hasResolver || hasFallback) {
            if (hasSubscriptionResolver && !hasExplicitResolver) {
                lightweightProviders.push(
                    asProvider(
                        PLATFORM_SUBSCRIPTION_REPOSITORY_TOKEN,
                        adapters.subscriptionRepository as ProviderSpec<SubscriptionRepository>,
                    ),
                );
            }
            lightweightProviders.push(
                hasExplicitResolver
                    ? asProvider(
                          PLAN_RESOLVER_PORT_TOKEN,
                          adapters.planResolver as ProviderSpec<PlanResolverPort>,
                      )
                    : hasSubscriptionResolver
                      ? {
                            provide: PLAN_RESOLVER_PORT_TOKEN,
                            useFactory: (subscriptions: SubscriptionRepository) =>
                                new SubscriptionPlanResolver(subscriptions),
                            inject: [PLATFORM_SUBSCRIPTION_REPOSITORY_TOKEN],
                        }
                      : {
                            provide: PLAN_RESOLVER_PORT_TOKEN,
                            useValue: new StaticPlanResolver(options.defaultPlanId as string),
                        },
                StaticEntitlementService,
                StaticFeatureGuard,
                EnforceQuotaInterceptor,
                ...(quotaProvidersHostedByTenantBilling ? [] : (options.quotaProviders ?? [])),
                {
                    provide: QUOTA_PROVIDERS_TOKEN,
                    useFactory: (...providers: QuotaProvider[]) => providers,
                    inject: options.quotaProviders ?? [],
                },
                ...(options.globalFeatureGuard === false
                    ? []
                    : [{ provide: APP_GUARD, useExisting: StaticFeatureGuard }]),
                { provide: APP_INTERCEPTOR, useExisting: EnforceQuotaInterceptor },
            );
            lightweightExports.push(
                PLAN_RESOLVER_PORT_TOKEN,
                StaticEntitlementService,
                StaticFeatureGuard,
                EnforceQuotaInterceptor,
                QUOTA_PROVIDERS_TOKEN,
            );
        }

        // ------------------------------------------------------------------
        // Tenant manifest (opt-in) — app-UI endpoint with feature filter.
        // Requires that the static-entitlement stack is active (above).
        // ------------------------------------------------------------------
        const tenantControllers: Type<unknown>[] = [];
        if (options.tenantManifest) {
            if (!hasResolver && !hasFallback) {
                throw new Error(
                    'SaasPlatformModule.forRoot: tenantManifest requires defaultPlanId, ' +
                        'adapters.planResolver or tenantBilling so it can resolve features.',
                );
            }
            lightweightProviders.push(TenantManifestService);
            lightweightExports.push(TenantManifestService);
            tenantControllers.push(
                buildTenantManifestController(
                    options.tenantManifest === true
                        ? {
                              guards: Array.isArray(tenantBillingConfig?.authGuards)
                                  ? tenantBillingConfig.authGuards
                                  : options.controller.guards,
                          }
                        : options.tenantManifest,
                ),
            );
        }

        return {
            module: SaasPlatformModule,
            imports,
            providers: lightweightProviders,
            controllers: tenantControllers,
            exports: [
                PlanCatalogModule,
                DiscoveryModule,
                AdminModule,
                // ADMIN_MANIFEST_CONFIG travels transitively: re-exporting an
                // imported module's token directly is an UnknownExportException
                // at boot — the module export below already carries it.
                AdminManifestModule,
                ...(requiresFullEntitlement ? [EntitlementModule] : []),
                ...(catalogConfig ? [CatalogModule] : []),
                ...(tenantBillingConfig ? [TenantBillingModule] : []),
                ...(subscriptionBundlesConfig ? [SubscriptionBundleModule] : []),
                ...(adminResourcesConfig ? [AdminResourcesModule] : []),
                ...(promoCodesConfig ? [PromoCodesModule] : []),
                ...lightweightExports,
            ],
            global: true,
        };
    }
}
