// SaasPlatformModule — mega-module that bundles the five quickstart platform
// modules (PlanCatalog, Discovery, Admin, AdminManifest, optionally Entitlement)
// into a single `forRoot({...})` call.
//
// Goal: reduce consumer boilerplate in the AppModule from ~50 lines to ~15 and
// eliminate the module-ordering trap ("adapter module must come BEFORE forRoot")
// — adapters are passed in here as provider specs instead of being wired via the
// `imports[]` trick.
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
    MfaPort,
    PlanCatalog,
    PlanCatalogReadSink,
    PlanVersionRepository,
    QuotaProvider,
    RlsBypassPort,
    SaasicatPersistenceAdapter,
    SubscriptionRepository,
    TransactionRunner,
} from '@saasicat/types';
import { assertPersistenceCapabilities } from '@saasicat/types';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { AdminModule } from '../admin/module.js';
import { AdminManifestModule } from '../admin/admin-manifest.module.js';
import { type AdminManifestConfig } from '../admin/admin-manifest.config.js';
import { PlanCatalogModule, PLAN_CATALOG_TOKEN } from '../billing/plan-catalog.module.js';
import { DiscoveryModule } from '../discovery/discovery.module.js';
import type { DiscoveryAppInfo } from '../discovery/discovery.scanner.js';
import { EntitlementModule } from '../entitlement/module.js';
import type { EntitlementResolutionConfig } from '../entitlement/plan-resolution.js';
import {
    PLAN_RESOLVER_PORT_TOKEN,
    type PlanResolverPort,
    StaticPlanResolver,
} from './plan-resolver.port.js';
import { StaticEntitlementService } from './static-entitlement.service.js';
import { StaticFeatureGuard } from './static-feature.guard.js';
import {
    EnforceQuotaInterceptor,
    QUOTA_PROVIDERS_TOKEN,
} from './enforce-quota.interceptor.js';
import { TenantManifestService } from './tenant-manifest.service.js';
import {
    buildTenantManifestController,
    type TenantManifestControllerOptions,
} from './tenant-manifest.controller.js';

/**
 * Adapter bindings for the platform ports. Accepted as class tokens, values
 * or factory specs.
 */
export interface SaasPlatformAdapters {
    mfa: ProviderSpec<MfaPort>;
    audit: ProviderSpec<AuditPort>;
    rlsBypass: ProviderSpec<RlsBypassPort>;
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
     * If not set, `defaultPlanId` **must** be provided — a `StaticPlanResolver`
     * then returns the same plan for all tenants.
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
     * Modules whose providers must be visible in the DI scope (typically:
     * `AuthModule` with the `JwtAuthGuard`).
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
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
        | AdminManifestConfig
        | Pick<FactoryProvider<AdminManifestConfig>, 'useFactory' | 'inject'>;
    /**
     * Default `false`. If `true`, `EntitlementModule.forRoot({...})` is called
     * with the repositories from `adapters` — only meaningful if the app
     * implements the V3 contract path (`subscriptionRepository` & co. must then
     * be set).
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
     * Enable the tenant manifest — the app UI gets a filtered manifest per
     * tenant with features, quotas and visible navigation. Requires that
     * `defaultPlanId` or `adapters.planResolver` is set.
     */
    tenantManifest?: TenantManifestControllerOptions;
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
        if (!options.planCatalog && (!adapters.planCatalogReadSink || !options.dbCatalog)) {
            // Without the identity the sink would load with projectKey '' and
            // the app would boot with a silently empty catalog.
            throw new Error(
                'SaasPlatformModule.forRoot: either set `planCatalog` (quickstart YAML path) or, ' +
                    'for DB hydration, BOTH a planCatalogReadSink (`adapters`/`persistence`) AND ' +
                    '`dbCatalog` ({ projectKey, currency, vatRate }).',
            );
        }
        if (options.entitlement) {
            const missing: string[] = [];
            if (!adapters.subscriptionRepository) missing.push('subscriptionRepository');
            if (!adapters.planVersionRepository) missing.push('planVersionRepository');
            if (!adapters.transactionRunner) missing.push('transactionRunner');
            if (missing.length) {
                throw new Error(
                    `SaasPlatformModule.forRoot: entitlement active, but adapters are missing: ${missing.join(', ')}`,
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
            version: options.planCatalog?.app?.version ?? options.dbCatalog?.app?.version ?? '0.0.0',
        };

        const imports: DynamicModule[] = [
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
                mfaPort: adapters.mfa,
                auditPort: adapters.audit,
                rlsBypassPort: adapters.rlsBypass,
                global: true,
            }),
            AdminManifestModule.forRoot({
                config: options.adminManifestConfig ?? buildMinimalManifestConfig(),
                guards: options.controller.guards,
                reloadGuards: options.reloadGuards,
            }),
        ];

        if (options.entitlement) {
            imports.push(
                EntitlementModule.forRoot({
                    subscriptionRepository:
                        adapters.subscriptionRepository as ProviderSpec<SubscriptionRepository>,
                    planVersionRepository:
                        adapters.planVersionRepository as ProviderSpec<PlanVersionRepository>,
                    transactionRunner:
                        adapters.transactionRunner as ProviderSpec<TransactionRunner>,
                    resolutionConfig: options.entitlement.resolutionConfig,
                    subscriptionContractRepository:
                        persistence?.entitlement?.subscriptionContractRepository,
                    subscriptionBundleRepository:
                        persistence?.entitlement?.subscriptionBundleRepository,
                    bundleRepository: persistence?.entitlement?.bundleRepository,
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
        const hasResolver = !!adapters.planResolver;
        const hasFallback = !!options.defaultPlanId;
        if (hasResolver || hasFallback) {
            lightweightProviders.push(
                hasResolver
                    ? asProvider(
                          PLAN_RESOLVER_PORT_TOKEN,
                          adapters.planResolver as ProviderSpec<PlanResolverPort>,
                      )
                    : {
                          provide: PLAN_RESOLVER_PORT_TOKEN,
                          useValue: new StaticPlanResolver(options.defaultPlanId as string),
                      },
                StaticEntitlementService,
                StaticFeatureGuard,
                EnforceQuotaInterceptor,
                ...(options.quotaProviders ?? []),
                {
                    provide: QUOTA_PROVIDERS_TOKEN,
                    useFactory: (...providers: QuotaProvider[]) => providers,
                    inject: options.quotaProviders ?? [],
                },
                { provide: APP_GUARD, useExisting: StaticFeatureGuard },
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
                    'SaasPlatformModule.forRoot: tenantManifest erfordert defaultPlanId ' +
                        'oder adapters.planResolver, sonst kann das Manifest keine ' +
                        'Features auflösen.',
                );
            }
            lightweightProviders.push(TenantManifestService);
            lightweightExports.push(TenantManifestService);
            tenantControllers.push(buildTenantManifestController(options.tenantManifest));
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
                ...(options.entitlement ? [EntitlementModule] : []),
                ...lightweightExports,
            ],
            global: true,
        };
    }
}
