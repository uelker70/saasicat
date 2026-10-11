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
    FeatureWithdrawalRepository,
    MarketingProjectionRepository,
} from '@saasicat/core';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { PublicCatalogController } from './public-catalog.controller.js';
import { BILLING_FEATURE_UI_REGISTRY_TOKEN } from './feature-ui-registry.tokens.js';
import { FEATURE_WITHDRAWAL_REPOSITORY_TOKEN } from './tenant-billing.tokens.js';
import {
    PUBLIC_CATALOG_BUNDLE_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_MARKETING_REPOSITORY_TOKEN,
} from './public-catalog.tokens.js';

// PublicCatalogModule — auth-free catalog endpoints under `/billing/*`.
//
// — `/billing/bundles` plus marketing merge in `/billing/plans`
// (provided the optional repos are configured).

export interface PublicCatalogModuleOptions {
    /** Required: consumer-specific FeatureUiRegistry. */
    featureUiRegistry: FeatureUiRegistry;
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
     * Optional (#13). When set, `/billing/feature-registry` overlays the
     * editable `FeatureCatalogEntry.icon` from the DB over the static
     * registry.
     */
    catalogEntryRepository?: ProviderSpec<CatalogEntryRepository>;
    /**
     * Optional. When set, `/billing/feature-registry` marks each feature
     * withdrawn now or from a date ahead, so a page showing what a plan or an
     * add-on includes says so before anybody concludes.
     */
    featureWithdrawals?: ProviderSpec<FeatureWithdrawalRepository>;
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
                provide: BILLING_FEATURE_UI_REGISTRY_TOKEN,
                useValue: options.featureUiRegistry,
            },
        ];
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
        if (options.featureWithdrawals) {
            providers.push(
                asProvider(FEATURE_WITHDRAWAL_REPOSITORY_TOKEN, options.featureWithdrawals),
            );
        }
        return {
            module: PublicCatalogModule,
            imports: options.imports ?? [],
            controllers: [PublicCatalogController],
            providers,
            exports: [BILLING_FEATURE_UI_REGISTRY_TOKEN],
        };
    }
}
