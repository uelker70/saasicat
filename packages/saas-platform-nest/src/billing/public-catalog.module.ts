import {
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type {
    BundleRepository,
    CatalogEntryRepository,
    FeatureUiRegistry,
    MarketingProjectionRepository,
} from '@saasicat/types';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { PublicCatalogController } from './public-catalog.controller.js';
import { FEATURE_UI_REGISTRY_TOKEN } from './feature-ui-registry.tokens.js';
import {
    PUBLIC_CATALOG_BUNDLE_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_MARKETING_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_PROJECT_KEY_TOKEN,
} from './public-catalog.tokens.js';

// PublicCatalogModule — auth-free catalog endpoints under `/billing/*`.
//
// SPEC_V2 §11.1 M6 Pack 2c — `/billing/bundles` plus marketing merge in `/billing/plans`
// (provided the optional repos are configured).

export interface PublicCatalogModuleOptions {
    /** Required: consumer-specific FeatureUiRegistry. */
    featureUiRegistry: FeatureUiRegistry;
    /**
     * SPEC_V2 §11.1 M6 Pack 2c — app identity (e.g. "clubapp"). Used
     * for marketing lookups + bundle filters.
     * Optional; if omitted, the new endpoints return empty lists.
     */
    projectKey?: string;
    /**
     * Optional. When set, `/billing/bundles` is active.
     */
    bundleRepository?: ProviderSpec<BundleRepository>;
    /**
     * Optional. When set, marketing texts are merged into /billing/bundles
     * (locale filter).
     */
    marketingRepository?: ProviderSpec<MarketingProjectionRepository>;
    /**
     * Optional (#13). When set (+ projectKey), `/billing/feature-registry`
     * overlays the editable `FeatureCatalogEntry.icon` from the DB over the
     * static registry.
     */
    catalogEntryRepository?: ProviderSpec<CatalogEntryRepository>;
    /**
     * Modules whose providers must be visible in the DI scope — typically
     * `PrismaModule`/`PlatformAdaptersModule` for the repositories.
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
