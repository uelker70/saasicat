// CatalogModule — DI wrapper around BundlesService (M3.1) and, possibly later,
// BusinessTypesService + MarketingProjectionService.
//
// Consumers pass through their repository adapters and decide the
// class-level guards of the controllers themselves (analogous to DiscoveryModule):
//
// ```ts
// CatalogModule.forRoot({
//   bundleRepository: { useFactory: (r: PrismaBundleRepository) => r,
//                        inject: [PrismaBundleRepository] },
//   controller: { guards: [JwtAuthGuard, SuperAdminGuard] },
//   imports: [PrismaModule, AuthModule, PlatformAdminModule],
//   strictModeCheckMode: 'blocking', // default (#12)
// })
// ```

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
     * Class-level guards for `BundlesController` and `BundleVersionsController`.
     * REQUIRED — otherwise `forRoot()` throws at boot. Pass `[]` explicitly
     * if the endpoints should intentionally be auth-free.
     */
    guards: Array<Type<CanActivate>>;
}

export interface CatalogModuleOptions {
    /** Adapter for `bundles` + `bundle_versions` persistence. */
    bundleRepository: ProviderSpec<BundleRepository>;
    /**
     * Adapter for `business_types` + `business_type_versions` +
     * `business_type_bundles` persistence. Optional — if omitted,
     * BusinessTypesService + controller are not registered.
     */
    businessTypeRepository?: ProviderSpec<BusinessTypeRepository>;
    /**
     * Adapter for `marketing_projections` persistence. Optional — if
     * omitted, MarketingProjectionsService + controller are not
     * registered.
     */
    marketingProjectionRepository?: ProviderSpec<MarketingProjectionRepository>;
    /**
     * Adapter for `capability_/feature_/quota_catalog_entries` persistence
     * (discovery review, SPEC_V2 §6.3). Optional — if omitted,
     * CatalogEntriesService + controller are not registered.
     */
    catalogEntryRepository?: ProviderSpec<CatalogEntryRepository>;
    /**
     * Adapter for `promotions` persistence (SPEC_V2 §9a). Optional — if
     * omitted, PromotionsService + controller are not registered.
     */
    promotionRepository?: ProviderSpec<PromotionRepository>;
    /**
     * Adapter for `marketing_settings` persistence (SPEC_V2 §6.5 —
     * `activeLocales`). Optional.
     */
    marketingSettingsRepository?: ProviderSpec<MarketingSettingsRepository>;
    /**
     * Auth-free pricing-page endpoint `GET /public/marketing-catalog`
     * (SPEC_V2 §9). Registered only when plan-, marketingProjection-
     * and promotionRepository are set. `guards` is usually `[]`.
     */
    publicMarketingCatalog?: {
        guards: Array<Type<CanActivate>>;
        projectKey: string;
        currency: string;
        vatRate: number;
    };
    /**
     * SPEC_V2 §11.1 M6 (Pack 1) — adapter for `plans` master-record persistence.
     * Optional; if omitted, PlansService + controller are not
     * registered (apps without a need for the plan editor stay unchanged).
     */
    planRepository?: ProviderSpec<PlanRepository>;
    /**
     * Controller mount for `/admin/catalog/bundles` + `/admin/catalog/bundle-versions`
     * + (if businessTypeRepository is set) `/admin/catalog/business-types` +
     * `/admin/catalog/business-type-versions`. If omitted, the
     * endpoints are not registered — but the services remain usable via DI.
     */
    controller?: CatalogControllerConfig;
    /**
     * Strict-mode mode. `blocking` (default, #12) throws HTTP 422 on
     * violations and requires a DiscoverySnapshot; `warn-only` returns them
     * only as a warning (transition until 100% discovery coverage).
     */
    strictModeCheckMode?: 'warn-only' | 'blocking';
    /**
     * Discovery→catalog auto-sync at boot (#12). Default `true` — as soon as a
     * `catalogEntryRepository` is wired and a DiscoverySnapshot is available,
     * `CatalogEntriesService` mirrors the discovery into the DB at startup. `false`
     * disables the boot sync; the manual sync endpoint remains usable.
     */
    autoSyncDiscoveryAtBoot?: boolean;
    /**
     * Feature keys the catalog is deliberately allowed to carry without them
     * existing in the discovery snapshot (marketed non-code features such as
     * support SLAs, e.g. `['PRIORITY_SUPPORT']`). The strict-mode check excludes
     * them from BUNDLE_/PLAN_FEATURE_UNKNOWN. Use sparingly.
     */
    marketedOnlyFeatures?: string[];
    /**
     * Optional consumer-curated FeatureUiRegistry (label/description/icon
     * per feature — the same one passed to `PublicCatalogModule.forRoot`). The
     * discovery auto-sync seeds EMPTY `FeatureCatalogEntry` fields
     * (label/description/icon) from it at boot; SuperAdmin edits stay untouched. This
     * makes `FeatureCatalogEntry` the SSOT for UI metadata (SPEC_V2 §6.3 / #12).
     */
    featureUiRegistry?: FeatureUiRegistry;
    /**
     * Modules whose providers must be visible in the DI scope of this
     * DynamicModule — typically: `AuthModule`/`PlatformAdminModule`, because the
     * controller guards come from there.
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /** Additional providers registered in the DynamicModule itself. */
    extraProviders?: Provider[];
    /** Register the module globally — default `false`. */
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
        // Public marketing catalog runs with its own (usually empty) guards,
        // independent of the authed `controller` mount.
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
            // Shared audit helper for the catalog-entries mutations (#13).
            // Deps are @Optional — a no-op without AdminAuditService in scope.
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
