// SaasPlatformModule — Mega-Modul, das die fünf Quickstart-Plattform-Module
// (PlanCatalog, Discovery, Admin, AdminManifest, optional Entitlement) in einem
// einzigen `forRoot({...})`-Call bündelt.
//
// Ziel: Konsumenten-Boilerplate im AppModule von ~50 Zeilen auf ~15 reduzieren
// und die Modul-Reihenfolge-Falle ("Adapter-Modul muss VOR forRoot stehen")
// eliminieren — Adapter werden hier als Provider-Specs reingereicht statt
// per `imports[]`-Trick verdrahtet.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P1.
//
// Wer mehr Kontrolle braucht (mehrere Manifest-Controller, abweichende Guards
// pro Endpoint, eigene Catalog-Adapter etc.), nutzt weiterhin die Einzel-
// Module direkt — dieses Mega-Modul ist eine Convenience, keine Pflicht.

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
    SubscriptionRepository,
    TransactionRunner,
} from '@saasicat/types';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { AdminModule } from '../admin/module.js';
import { AdminManifestModule } from '../admin/admin-manifest.module.js';
import {
    type AdminManifestConfig,
    ADMIN_MANIFEST_CONFIG,
} from '../admin/admin-manifest.config.js';
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
 * Adapter-Bindings für die Plattform-Ports. Werden als Klassen-Token,
 * Werte oder Factory-Specs entgegengenommen.
 */
export interface SaasPlatformAdapters {
    mfa: ProviderSpec<MfaPort>;
    audit: ProviderSpec<AuditPort>;
    rlsBypass: ProviderSpec<RlsBypassPort>;
    /**
     * Optional. Wenn übergeben, wird `PlanCatalogModule` aus diesem Sink
     * hydriert (DB-Read beim Boot). Wenn weggelassen, MUSS `planCatalog` als
     * fertiges Objekt übergeben werden (Quickstart-Pfad — YAML-direkt).
     */
    planCatalogReadSink?: ProviderSpec<PlanCatalogReadSink>;
    /**
     * Optional — Resolver `tenantId → planId`. Quickstart-Pfad benutzt das
     * mit dem `StaticEntitlementService`, um `@RequireFeature` und
     * `@EnforceQuota` automatisch gegen das Plan-Catalog-Limit zu prüfen.
     * Wenn nicht gesetzt, **muss** `defaultPlanId` angegeben werden —
     * dann liefert ein `StaticPlanResolver` für alle Tenants denselben Plan.
     */
    planResolver?: ProviderSpec<PlanResolverPort>;
    /**
     * Optional — erforderlich nur wenn `entitlement: true`. Repositories für
     * den V3-Vertrags-/Entitlement-Loop.
     */
    subscriptionRepository?: ProviderSpec<SubscriptionRepository>;
    planVersionRepository?: ProviderSpec<PlanVersionRepository>;
    transactionRunner?: ProviderSpec<TransactionRunner>;
}

export interface SaasPlatformModuleOptions {
    /**
     * Plan-Catalog. Entweder als bereits geladenes Objekt (Quickstart, kommt
     * direkt aus `loadPlanCatalogFromFile('config/saas.yaml')`) oder als
     * Sink-Referenz in `adapters.planCatalogReadSink` für DB-Hydration.
     */
    planCatalog?: PlanCatalog;
    /**
     * Adapter-Bindings.
     */
    adapters: SaasPlatformAdapters;
    /**
     * Class-Level-Guards für die Plattform-Controller (`GET /admin/discovery`
     * und `GET /admin/manifest`). PFLICHT — sonst wirft die Plattform beim
     * Boot, weil Manifest-Controller niemals stillschweigend auth-frei
     * registriert werden darf (Plattform-Sicherheit).
     *
     * Explizit `[]` übergeben, wenn der Endpoint absichtlich auth-frei sein
     * soll (CI/Smoke-Test).
     */
    controller: { guards: Array<Type<CanActivate>> };
    /**
     * Zusätzliche Guards nur für `POST /admin/manifest/reload` (typisch:
     * `MfaGuard`). Optional.
     */
    reloadGuards?: Array<Type<CanActivate>>;
    /**
     * Module, deren Provider im DI-Scope sichtbar sein müssen (typisch:
     * `AuthModule` mit dem `JwtAuthGuard`).
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /**
     * App-Identität für den DiscoveryScanner. Wenn weggelassen, wird
     * `planCatalog.app` verwendet (Empfehlung: einfach in der YAML deklarieren).
     */
    app?: DiscoveryAppInfo;
    /**
     * Optional — Snapshot-Pfad für DiscoveryScanner. Default:
     * `var/discovery-snapshot.json`. `null` zum Deaktivieren.
     */
    discoverySnapshotPath?: string | null;
    /**
     * `AdminManifestConfig`. Wenn weggelassen, baut das Modul eine Minimal-
     * Variante aus `planCatalog` zusammen — gut für Quickstart, aber für
     * volle Manifest-Features (Build-Hash, Locales, KPI-Cards) sollte der
     * Konsument eine eigene Factory liefern.
     */
    adminManifestConfig?:
        | AdminManifestConfig
        | Pick<FactoryProvider<AdminManifestConfig>, 'useFactory' | 'inject'>;
    /**
     * Default `false`. Wenn `true`, wird `EntitlementModule.forRoot({...})`
     * mit den Repositories aus `adapters` aufgerufen — nur sinnvoll, wenn
     * die App den V3-Vertrags-Pfad implementiert (`subscriptionRepository` &
     * Co. müssen dann gesetzt sein).
     */
    entitlement?:
        | false
        | {
              resolutionConfig?: EntitlementResolutionConfig;
          };
    /**
     * Fallback-PlanID für den `StaticPlanResolver`. Wenn weder
     * `adapters.planResolver` noch `defaultPlanId` gesetzt sind, wird der
     * `StaticEntitlementService` nicht aktiviert — `@RequireFeature`/
     * `@EnforceQuota` sind dann **wirkungslos** (Discovery-Markup ohne
     * Runtime-Effekt). Plattform-Warning beim Boot.
     */
    defaultPlanId?: string;
    /**
     * QuotaProvider-Klassen, die mit `@DefinesQuota({...})` deklariert wurden
     * und vom `EnforceQuotaInterceptor` zur Count-Berechnung benutzt werden
     * müssen. Plattform registriert sie als App-Provider und sammelt sie in
     * `QUOTA_PROVIDERS_TOKEN`.
     */
    quotaProviders?: Array<Type<QuotaProvider>>;
    /**
     * Tenant-Manifest aktivieren — App-UI bekommt pro Tenant ein gefiltertes
     * Manifest mit Features, Quotas und sichtbarer Navigation. Erfordert,
     * dass `defaultPlanId` oder `adapters.planResolver` gesetzt ist.
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
                quotaKeys: catalog.quotaKeys ?? [],
                plans: catalog.plans ?? [],
                features: catalog.features ?? [],
            },
        }),
        inject: [PLAN_CATALOG_TOKEN],
    };
}

/**
 * Bündelt PlanCatalog + Discovery + Admin + AdminManifest (+ optional
 * Entitlement) in einem `forRoot({...})`-Aufruf. Reduziert AppModule-
 * Boilerplate und eliminiert die Reihenfolge-Falle.
 *
 * Quickstart-Pfad:
 *
 * ```ts
 * SaasPlatformModule.forRoot({
 *     planCatalog: loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),
 *     controller: { guards: [JwtAuthGuard] },
 *     imports: [AuthModule],
 *     adapters: {
 *         mfa: PrismaMfaAdapter,           // aus @saasicat/prisma
 *         audit: PrismaAuditAdapter,
 *         rlsBypass: AsyncLocalRlsBypassAdapter,
 *     },
 * })
 * ```
 */
@Module({})
export class SaasPlatformModule {
    static forRoot(options: SaasPlatformModuleOptions): DynamicModule {
        if (!options.planCatalog && !options.adapters.planCatalogReadSink) {
            throw new Error(
                'SaasPlatformModule.forRoot: entweder `planCatalog` (Quickstart) ' +
                    'oder `adapters.planCatalogReadSink` (DB-Hydration) muss gesetzt sein.',
            );
        }
        if (options.entitlement) {
            const missing: string[] = [];
            if (!options.adapters.subscriptionRepository) missing.push('subscriptionRepository');
            if (!options.adapters.planVersionRepository) missing.push('planVersionRepository');
            if (!options.adapters.transactionRunner) missing.push('transactionRunner');
            if (missing.length) {
                throw new Error(
                    `SaasPlatformModule.forRoot: entitlement aktiv, aber Adapter fehlen: ${missing.join(', ')}`,
                );
            }
        }

        const planCatalogModule: DynamicModule = options.planCatalog
            ? PlanCatalogModule.forRootWithCatalog(options.planCatalog, { global: true })
            : PlanCatalogModule.forRoot({
                  projectKey: '',
                  currency: '',
                  vatRate: 0,
                  quotaKeys: [],
                  sink: options.adapters
                      .planCatalogReadSink as ProviderSpec<PlanCatalogReadSink>,
                  imports: options.imports,
              });

        const appInfo: DiscoveryAppInfo = options.app ?? {
            key: options.planCatalog?.projectKey ?? 'app',
            version: options.planCatalog?.app?.version ?? '0.0.0',
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
                mfaPort: options.adapters.mfa,
                auditPort: options.adapters.audit,
                rlsBypassPort: options.adapters.rlsBypass,
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
                    subscriptionRepository: options.adapters
                        .subscriptionRepository as ProviderSpec<SubscriptionRepository>,
                    planVersionRepository: options.adapters
                        .planVersionRepository as ProviderSpec<PlanVersionRepository>,
                    transactionRunner: options.adapters
                        .transactionRunner as ProviderSpec<TransactionRunner>,
                    resolutionConfig: options.entitlement.resolutionConfig,
                }),
            );
        }

        // ------------------------------------------------------------------
        // Lightweight Static-Entitlement-Stack: Auto-Wire FeatureGuard +
        // EnforceQuotaInterceptor, sodass `@RequireFeature` und
        // `@EnforceQuota` direkt nach dem Mega-Modul-Import wirken.
        // Bedingung: PlanResolver oder defaultPlanId.
        // ------------------------------------------------------------------
        const lightweightProviders: Provider[] = [];
        const lightweightExports: NonNullable<DynamicModule['exports']> = [];
        const hasResolver = !!options.adapters.planResolver;
        const hasFallback = !!options.defaultPlanId;
        if (hasResolver || hasFallback) {
            lightweightProviders.push(
                hasResolver
                    ? asProvider(
                          PLAN_RESOLVER_PORT_TOKEN,
                          options.adapters.planResolver as ProviderSpec<PlanResolverPort>,
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
        // Tenant-Manifest (opt-in) — App-UI-Endpoint mit Feature-Filter.
        // Erfordert, dass der StaticEntitlement-Stack aktiv ist (oben).
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
                AdminManifestModule,
                ...(options.entitlement ? [EntitlementModule] : []),
                ADMIN_MANIFEST_CONFIG,
                ...lightweightExports,
            ],
            global: true,
        };
    }
}
