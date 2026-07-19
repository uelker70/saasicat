// CatalogModule — DI-Wrapper um BundlesService (M3.1) + ggf. später
// BusinessTypesService + MarketingProjectionService.
//
// Konsumenten reichen ihre Repository-Adapter durch und bestimmen die
// Class-Level-Guards der Controller selbst (analog zu DiscoveryModule):
//
// ```ts
// CatalogModule.forRoot({
//   bundleRepository: { useFactory: (r: PrismaBundleRepository) => r,
//                        inject: [PrismaBundleRepository] },
//   controller: { guards: [JwtAuthGuard, SuperAdminGuard] },
//   imports: [PrismaModule, AuthModule, PlatformAdminModule],
//   strictModeCheckMode: 'blocking', // Default (#12)
// })
// ```
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §11.1 M3

import {
    type CanActivate,
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type {
    BundleRepository,
    BusinessTypeRepository,
    CatalogEntryRepository,
    FeatureUiRegistry,
    MarketingProjectionRepository,
    MarketingSettingsRepository,
    PlanRepository,
    PromotionRepository,
} from '@saasicat/types';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { WebAuditLogger } from '../core/web-audit.js';
import { BundlesService, type CatalogServiceConfig } from './bundles.service.js';
import { buildBundlesController, buildBundleVersionsController } from './bundles.controller.js';
import { CatalogEntriesService } from './catalog-entries.service.js';
import { buildCatalogEntriesController } from './catalog-entries.controller.js';
import { PromotionsService } from './promotions.service.js';
import { buildPromotionsController } from './promotions.controller.js';
import { MarketingSettingsService } from './marketing-settings.service.js';
import { buildMarketingSettingsController } from './marketing-settings.controller.js';
import { PublicMarketingCatalogService } from './public-marketing-catalog.service.js';
import { buildPublicMarketingCatalogController } from './public-marketing-catalog.controller.js';
import { BusinessTypesService } from './business-types.service.js';
import {
    buildBusinessTypesController,
    buildBusinessTypeVersionsController,
} from './business-types.controller.js';
import { MarketingProjectionsService } from './marketing-projections.service.js';
import { buildMarketingProjectionsController } from './marketing-projections.controller.js';
import { PlansService } from './plans.service.js';
import { PlanVersionsService } from './plan-versions.service.js';
import { buildPlansController, buildPlanVersionsController } from './plans.controller.js';
import {
    BUNDLE_REPOSITORY_TOKEN,
    BUSINESS_TYPE_REPOSITORY_TOKEN,
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    CATALOG_SERVICE_CONFIG_TOKEN,
    FEATURE_UI_REGISTRY_TOKEN,
    MARKETING_PROJECTION_REPOSITORY_TOKEN,
    MARKETING_SETTINGS_REPOSITORY_TOKEN,
    PLAN_REPOSITORY_TOKEN,
    PROMOTION_REPOSITORY_TOKEN,
} from './tokens.js';

export interface CatalogControllerConfig {
    /**
     * Class-Level-Guards für `BundlesController` und `BundleVersionsController`.
     * PFLICHT — `forRoot()` wirft sonst beim Boot. Übergebe `[]` explizit,
     * wenn die Endpoints absichtlich auth-frei sein sollen.
     */
    guards: Array<Type<CanActivate>>;
}

export interface CatalogModuleOptions {
    /** Adapter für `bundles` + `bundle_versions`-Persistenz. */
    bundleRepository: ProviderSpec<BundleRepository>;
    /**
     * Adapter für `business_types` + `business_type_versions` +
     * `business_type_bundles`-Persistenz. Optional — wenn weggelassen,
     * werden BusinessTypesService + Controller nicht registriert.
     */
    businessTypeRepository?: ProviderSpec<BusinessTypeRepository>;
    /**
     * Adapter für `marketing_projections`-Persistenz. Optional — wenn
     * weggelassen, werden MarketingProjectionsService + Controller nicht
     * registriert.
     */
    marketingProjectionRepository?: ProviderSpec<MarketingProjectionRepository>;
    /**
     * Adapter für `capability_/feature_/quota_catalog_entries`-Persistenz
     * (Discovery-Review, SPEC_V2 §6.3). Optional — wenn weggelassen, werden
     * CatalogEntriesService + Controller nicht registriert.
     */
    catalogEntryRepository?: ProviderSpec<CatalogEntryRepository>;
    /**
     * Adapter für `promotions`-Persistenz (SPEC_V2 §9a). Optional — wenn
     * weggelassen, werden PromotionsService + Controller nicht registriert.
     */
    promotionRepository?: ProviderSpec<PromotionRepository>;
    /**
     * Adapter für `marketing_settings`-Persistenz (SPEC_V2 §6.5 —
     * `activeLocales`). Optional.
     */
    marketingSettingsRepository?: ProviderSpec<MarketingSettingsRepository>;
    /**
     * Auth-freier Pricing-Page-Endpoint `GET /public/marketing-catalog`
     * (SPEC_V2 §9). Wird nur registriert, wenn plan- + marketingProjection-
     * + promotionRepository gesetzt sind. `guards` ist üblicherweise `[]`.
     */
    publicMarketingCatalog?: {
        guards: Array<Type<CanActivate>>;
        projectKey: string;
        currency: string;
        vatRate: number;
    };
    /**
     * SPEC_V2 §11.1 M6 (Pack 1) — Adapter für `plans`-Stamm-Persistenz.
     * Optional; wenn weggelassen, werden PlansService + Controller nicht
     * registriert (Apps ohne Plan-Editor-Bedarf bleiben so unverändert).
     */
    planRepository?: ProviderSpec<PlanRepository>;
    /**
     * Controller-Mount für `/admin/catalog/bundles` + `/admin/catalog/bundle-versions`
     * + (falls businessTypeRepository gesetzt) `/admin/catalog/business-types` +
     * `/admin/catalog/business-type-versions`. Wenn weggelassen, werden die
     * Endpoints nicht registriert — die Services bleiben aber via DI nutzbar.
     */
    controller?: CatalogControllerConfig;
    /**
     * Strict-Mode-Modus. `blocking` (Default, #12) wirft HTTP 422 bei
     * Verstößen und erfordert einen DiscoverySnapshot; `warn-only` gibt sie
     * nur als Warning zurück (Übergang bis 100 % Discovery-Coverage).
     */
    strictModeCheckMode?: 'warn-only' | 'blocking';
    /**
     * Discovery→Catalog-Auto-Sync beim Boot (#12). Default `true` — sobald ein
     * `catalogEntryRepository` gewiret ist und ein DiscoverySnapshot bereitsteht,
     * spiegelt `CatalogEntriesService` die Discovery beim Start in die DB. `false`
     * deaktiviert den Boot-Sync; der manuelle Sync-Endpoint bleibt nutzbar.
     */
    autoSyncDiscoveryAtBoot?: boolean;
    /**
     * Feature-Keys, die der Katalog bewusst führen darf, ohne dass sie im
     * Discovery-Snapshot existieren (vermarktete Nicht-Code-Features wie
     * Support-SLAs, z. B. `['PRIORITY_SUPPORT']`). Der Strict-Mode-Check nimmt
     * sie von BUNDLE_/PLAN_FEATURE_UNKNOWN aus. Sparsam einsetzen.
     */
    marketedOnlyFeatures?: string[];
    /**
     * Optionale konsumenten-kuratierte FeatureUiRegistry (label/description/icon
     * je Feature — dieselbe, die an `PublicCatalogModule.forRoot` geht). Der
     * Discovery-Auto-Sync seedet daraus beim Boot LEERE `FeatureCatalogEntry`-
     * Felder (label/description/icon); SuperAdmin-Edits bleiben unangetastet. So
     * wird `FeatureCatalogEntry` die SSOT für UI-Metadaten (SPEC_V2 §6.3 / #12).
     */
    featureUiRegistry?: FeatureUiRegistry;
    /**
     * Module, deren Provider im DI-Scope dieses DynamicModules sichtbar
     * sein müssen — typisch: `AuthModule`/`PlatformAdminModule`, weil die
     * Controller-Guards von dort kommen.
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /** Zusätzliche Provider, die im DynamicModule selbst registriert werden. */
    extraProviders?: Provider[];
    /** Modul global registrieren — Default `false`. */
    global?: boolean;
}

@Module({})
export class CatalogModule {
    static forRoot(options: CatalogModuleOptions): DynamicModule {
        const hasBusinessType = options.businessTypeRepository !== undefined;
        const hasMarketing = options.marketingProjectionRepository !== undefined;
        const hasPlan = options.planRepository !== undefined;
        const hasCatalogEntry = options.catalogEntryRepository !== undefined;
        const hasPromotion = options.promotionRepository !== undefined;
        const hasMarketingSettings = options.marketingSettingsRepository !== undefined;
        const hasPublicMarketingCatalog =
            options.publicMarketingCatalog !== undefined && hasPlan && hasMarketing && hasPromotion;
        const controllers: Type[] = [];
        if (options.controller) {
            controllers.push(buildBundlesController(options.controller.guards));
            controllers.push(buildBundleVersionsController(options.controller.guards));
            if (hasBusinessType) {
                controllers.push(buildBusinessTypesController(options.controller.guards));
                controllers.push(buildBusinessTypeVersionsController(options.controller.guards));
            }
            if (hasMarketing) {
                controllers.push(buildMarketingProjectionsController(options.controller.guards));
            }
            if (hasPlan) {
                controllers.push(buildPlansController(options.controller.guards));
                controllers.push(buildPlanVersionsController(options.controller.guards));
            }
            if (hasCatalogEntry) {
                controllers.push(buildCatalogEntriesController(options.controller.guards));
            }
            if (hasPromotion) {
                controllers.push(buildPromotionsController(options.controller.guards));
            }
            if (hasMarketingSettings) {
                controllers.push(buildMarketingSettingsController(options.controller.guards));
            }
        }
        // Public-Marketing-Catalog läuft mit eigenen (i. d. R. leeren) Guards,
        // unabhängig vom authed `controller`-Mount.
        if (hasPublicMarketingCatalog && options.publicMarketingCatalog) {
            controllers.push(
                buildPublicMarketingCatalogController(
                    options.publicMarketingCatalog.guards,
                    options.publicMarketingCatalog.projectKey,
                    options.publicMarketingCatalog.currency,
                    options.publicMarketingCatalog.vatRate,
                ),
            );
        }

        const providers: Provider[] = [
            asProvider(BUNDLE_REPOSITORY_TOKEN, options.bundleRepository),
            {
                provide: CATALOG_SERVICE_CONFIG_TOKEN,
                useValue: {
                    strictModeCheckMode: options.strictModeCheckMode ?? 'blocking',
                    autoSyncDiscoveryAtBoot: options.autoSyncDiscoveryAtBoot ?? true,
                    marketedOnlyFeatures: options.marketedOnlyFeatures ?? [],
                } satisfies CatalogServiceConfig,
            },
            {
                provide: FEATURE_UI_REGISTRY_TOKEN,
                useValue: options.featureUiRegistry ?? null,
            },
            BundlesService,
            // Geteilter Audit-Helfer für die catalog-entries-Mutationen (#13).
            // Deps sind @Optional — ohne AdminAuditService im Scope ein No-op.
            WebAuditLogger,
            ...(options.extraProviders ?? []),
        ];
        const exports: Array<
            | symbol
            | typeof BundlesService
            | typeof BusinessTypesService
            | typeof MarketingProjectionsService
            | typeof CatalogEntriesService
            | typeof PromotionsService
            | typeof MarketingSettingsService
            | typeof PublicMarketingCatalogService
            | typeof PlansService
            | typeof PlanVersionsService
        > = [BundlesService, BUNDLE_REPOSITORY_TOKEN];
        if (hasBusinessType && options.businessTypeRepository) {
            providers.push(
                asProvider(BUSINESS_TYPE_REPOSITORY_TOKEN, options.businessTypeRepository),
                BusinessTypesService,
            );
            exports.push(BusinessTypesService, BUSINESS_TYPE_REPOSITORY_TOKEN);
        }
        if (hasMarketing && options.marketingProjectionRepository) {
            providers.push(
                asProvider(
                    MARKETING_PROJECTION_REPOSITORY_TOKEN,
                    options.marketingProjectionRepository,
                ),
                MarketingProjectionsService,
            );
            exports.push(MarketingProjectionsService, MARKETING_PROJECTION_REPOSITORY_TOKEN);
        }
        if (hasPlan && options.planRepository) {
            providers.push(
                asProvider(PLAN_REPOSITORY_TOKEN, options.planRepository),
                PlansService,
                PlanVersionsService,
            );
            exports.push(PlansService, PlanVersionsService, PLAN_REPOSITORY_TOKEN);
        }
        if (hasCatalogEntry && options.catalogEntryRepository) {
            providers.push(
                asProvider(CATALOG_ENTRY_REPOSITORY_TOKEN, options.catalogEntryRepository),
                CatalogEntriesService,
            );
            exports.push(CatalogEntriesService, CATALOG_ENTRY_REPOSITORY_TOKEN);
        }
        if (hasPromotion && options.promotionRepository) {
            providers.push(
                asProvider(PROMOTION_REPOSITORY_TOKEN, options.promotionRepository),
                PromotionsService,
            );
            exports.push(PromotionsService, PROMOTION_REPOSITORY_TOKEN);
        }
        if (hasMarketingSettings && options.marketingSettingsRepository) {
            providers.push(
                asProvider(
                    MARKETING_SETTINGS_REPOSITORY_TOKEN,
                    options.marketingSettingsRepository,
                ),
                MarketingSettingsService,
            );
            exports.push(MarketingSettingsService, MARKETING_SETTINGS_REPOSITORY_TOKEN);
        }
        if (hasPublicMarketingCatalog) {
            providers.push(PublicMarketingCatalogService);
            exports.push(PublicMarketingCatalogService);
        }

        return {
            module: CatalogModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            controllers,
            providers,
            exports,
        };
    }
}
