// EntitlementModule — DI-Wrapper um EntitlementService.
//
// Konsumenten registrieren ihre Adapter-Implementierungen über
// `EntitlementModule.forRoot({...})` oder als Custom-Provider direkt im
// AppModule.

import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type {
    BundleRepository,
    PlanVersionRepository,
    SubscriptionBundleRepository,
    SubscriptionContractRepository,
    SubscriptionRepository,
    TransactionRunner,
} from '@saasicat/types';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { EntitlementService } from './service.js';
import type { EntitlementResolutionConfig } from './plan-resolution.js';
import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/tokens.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from '../billing/subscription-bundles.tokens.js';
import { SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN } from '../subscription-contract/tokens.js';
import {
    ENTITLEMENT_RESOLUTION_CONFIG_TOKEN,
    PLAN_VERSION_REPOSITORY_TOKEN,
    SUBSCRIPTION_REPOSITORY_TOKEN,
    TRANSACTION_RUNNER_TOKEN,
} from './tokens.js';

export interface EntitlementModuleOptions {
    /** Konsumenten-Implementation der `SubscriptionRepository`-Schnittstelle. */
    subscriptionRepository: ProviderSpec<SubscriptionRepository>;
    /** Konsumenten-Implementation der `PlanVersionRepository`-Schnittstelle. */
    planVersionRepository: ProviderSpec<PlanVersionRepository>;
    /** Konsumenten-Implementation der `TransactionRunner`-Schnittstelle. */
    transactionRunner: ProviderSpec<TransactionRunner>;
    /** Optionale Konsumenten-Resolution-Strategie (Pilot/Trial/Pending). */
    resolutionConfig?: EntitlementResolutionConfig;
    /** Optionaler V3-Contract-Adapter. Wenn gesetzt, liest der Service zuerst Contracts. */
    subscriptionContractRepository?: ProviderSpec<SubscriptionContractRepository>;
    /**
     * Optional (P11.7.3/#61) — BEIDE zusammen aktivieren die Aggregation
     * eigenständig gebuchter Catalog-Bundles (`subscription_bundles`) in
     * `computeLimits`. Ohne sie zählt nur Plan + BusinessType — mid-cycle
     * zugebuchte Bundles wären dann NICHT in den Entitlements (und ein
     * Contract-Re-Freeze fröre sie nicht ein).
     */
    subscriptionBundleRepository?: ProviderSpec<SubscriptionBundleRepository>;
    /** Siehe `subscriptionBundleRepository` — löst BundleVersion-Features/Quotas auf. */
    bundleRepository?: ProviderSpec<BundleRepository>;
    /** Modul global registrieren — Default `false`. */
    global?: boolean;
}

@Module({})
export class EntitlementModule {
    static forRoot(options: EntitlementModuleOptions): DynamicModule {
        const providers: Provider[] = [
            asProvider(SUBSCRIPTION_REPOSITORY_TOKEN, options.subscriptionRepository),
            asProvider(PLAN_VERSION_REPOSITORY_TOKEN, options.planVersionRepository),
            asProvider(TRANSACTION_RUNNER_TOKEN, options.transactionRunner),
            EntitlementService,
        ];
        if (options.resolutionConfig) {
            providers.push({
                provide: ENTITLEMENT_RESOLUTION_CONFIG_TOKEN,
                useValue: options.resolutionConfig,
            });
        }
        if (options.subscriptionContractRepository) {
            providers.push(
                asProvider(
                    SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN,
                    options.subscriptionContractRepository,
                ),
            );
        }
        if (options.subscriptionBundleRepository) {
            providers.push(
                asProvider(
                    SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN,
                    options.subscriptionBundleRepository,
                ),
            );
        }
        if (options.bundleRepository) {
            providers.push(asProvider(BUNDLE_REPOSITORY_TOKEN, options.bundleRepository));
        }

        return {
            module: EntitlementModule,
            global: options.global ?? false,
            providers,
            exports: [EntitlementService, SUBSCRIPTION_REPOSITORY_TOKEN],
        };
    }
}
