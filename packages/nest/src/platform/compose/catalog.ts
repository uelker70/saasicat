import type { DynamicModule } from '@nestjs/common';
import type { SaaSiCatPersistenceAdapter } from '@saasicat/core';

import { PublicCatalogModule } from '../../billing/public-catalog.module.js';
import { CatalogModule } from '../../catalog/catalog.module.js';
import { PaymentGatewayRegistry } from '../../payments/payment-gateway-registry.js';

import { operatorGuards, type CompositionContext } from './context.js';

/**
 * The plan/bundle catalogue, and the public projection of it.
 *
 * Two modules from one option: the public catalogue is what an unauthenticated
 * pricing page reads, and it is on unless the app says otherwise — a catalogue
 * nobody outside can see is the rarer intent.
 */
export function composeCatalog({ options, persistence }: CompositionContext): DynamicModule[] {
    const config = options.catalog;
    if (!config) return [];

    const catalog = persistence?.catalog as NonNullable<SaaSiCatPersistenceAdapter['catalog']>;
    const modules: DynamicModule[] = [
        CatalogModule.forRoot({
            planRepository: catalog.planRepository,
            bundleRepository: catalog.bundleRepository,
            catalogEntryRepository: catalog.catalogEntryRepository,
            marketingProjectionRepository: catalog.marketingProjectionRepository,
            promotionRepository: catalog.promotionRepository,
            marketingSettingsRepository: catalog.marketingSettingsRepository,
            controller:
                config.adminControllers === false ? undefined : { guards: operatorGuards(options) },
            imports: config.imports ?? options.imports,
            extraProviders: config.extraProviders,
            strictModeCheckMode: config.strictModeCheckMode,
            autoSyncDiscoveryAtBoot: config.autoSyncDiscoveryAtBoot,
            marketedOnlyFeatures: config.marketedOnlyFeatures,
            featureUiRegistry: config.featureUiRegistry,
            // What the public catalogue says about payment methods comes from
            // the same option that wires the gateways, so the two cannot
            // disagree: no `payments`, nothing takes new payment methods.
            publicMarketingCatalog: config.publicMarketingCatalog && {
                ...config.publicMarketingCatalog,
                newPaymentMethodsFrom:
                    config.publicMarketingCatalog.newPaymentMethodsFrom ??
                    (options.payments ? PaymentGatewayRegistry : undefined),
            },
        }),
    ];

    if (config.publicCatalog !== false) {
        modules.push(
            PublicCatalogModule.forRoot({
                featureUiRegistry: config.featureUiRegistry,
                bundleRepository: catalog.bundleRepository,
                marketingRepository: catalog.marketingProjectionRepository,
                catalogEntryRepository: catalog.catalogEntryRepository,
                imports: config.imports ?? options.imports,
            }),
        );
    }
    return modules;
}
