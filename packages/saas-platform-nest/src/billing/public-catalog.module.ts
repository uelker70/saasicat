import {
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
} from '@saasicat/types';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { PublicCatalogController } from './public-catalog.controller.js';
import { FEATURE_UI_REGISTRY_TOKEN } from './feature-ui-registry.tokens.js';
import {
    PUBLIC_CATALOG_BUNDLE_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_BUSINESS_TYPE_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_MARKETING_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_PROJECT_KEY_TOKEN,
} from './public-catalog.tokens.js';

// PublicCatalogModule — auth-freie Catalog-Endpoints unter `/billing/*`.
//
// SPEC_V2 §11.1 M6 Pack 2c — neue Endpoints `/billing/bundles` und
// `/billing/business-types` plus Marketing-Merge in `/billing/plans`
// (sofern die optionalen Repos konfiguriert sind).

export interface PublicCatalogModuleOptions {
    /** Pflicht: Konsumenten-spezifische FeatureUiRegistry. */
    featureUiRegistry: FeatureUiRegistry;
    /**
     * SPEC_V2 §11.1 M6 Pack 2c — App-Identity (z. B. "clubapp"). Wird
     * für Marketing-Lookups + Bundles/BusinessTypes-Filter benutzt.
     * Optional; wenn weggelassen, liefern die neuen Endpoints leere Listen.
     */
    projectKey?: string;
    /**
     * Optional. Wenn gesetzt, ist `/billing/bundles` aktiv.
     */
    bundleRepository?: ProviderSpec<BundleRepository>;
    /**
     * Optional. Wenn gesetzt, ist `/billing/business-types` aktiv.
     */
    businessTypeRepository?: ProviderSpec<BusinessTypeRepository>;
    /**
     * Optional. Wenn gesetzt, werden Marketing-Texte in /billing/bundles
     * und /billing/business-types reingemerged (locale-Filter).
     */
    marketingRepository?: ProviderSpec<MarketingProjectionRepository>;
    /**
     * Optional (#13). Wenn gesetzt (+ projectKey), overlayt
     * `/billing/feature-registry` das editierbare `FeatureCatalogEntry.icon`
     * aus der DB über die statische Registry.
     */
    catalogEntryRepository?: ProviderSpec<CatalogEntryRepository>;
    /**
     * Module, deren Provider im DI-Scope sichtbar sein müssen — typisch
     * `PrismaModule`/`PlatformAdaptersModule` für die Repositories.
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    extraProviders?: Provider[];
}

@Module({})
export class PublicCatalogModule {
    static forRoot(options: PublicCatalogModuleOptions): DynamicModule {
        const providers: Provider[] = [
            ...(options.extraProviders ?? []),
            {
                provide: FEATURE_UI_REGISTRY_TOKEN,
                useValue: options.featureUiRegistry,
            },
        ];
        if (options.projectKey !== undefined) {
            providers.push({
                provide: PUBLIC_CATALOG_PROJECT_KEY_TOKEN,
                useValue: options.projectKey,
            });
        }
        if (options.bundleRepository) {
            providers.push(
                asProvider(PUBLIC_CATALOG_BUNDLE_REPOSITORY_TOKEN, options.bundleRepository),
            );
        }
        if (options.businessTypeRepository) {
            providers.push(
                asProvider(
                    PUBLIC_CATALOG_BUSINESS_TYPE_REPOSITORY_TOKEN,
                    options.businessTypeRepository,
                ),
            );
        }
        if (options.marketingRepository) {
            providers.push(
                asProvider(PUBLIC_CATALOG_MARKETING_REPOSITORY_TOKEN, options.marketingRepository),
            );
        }
        if (options.catalogEntryRepository) {
            providers.push(
                asProvider(
                    PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY_TOKEN,
                    options.catalogEntryRepository,
                ),
            );
        }
        return {
            module: PublicCatalogModule,
            imports: options.imports ?? [],
            controllers: [PublicCatalogController],
            providers,
            exports: [FEATURE_UI_REGISTRY_TOKEN],
        };
    }
}
