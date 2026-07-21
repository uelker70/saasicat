// EntitlementModule — DI wrapper around EntitlementService.
//
// Consumers register their adapter implementations via
// `EntitlementModule.forRoot({...})` or as custom providers directly in the
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
    /** Consumer implementation of the `SubscriptionRepository` interface. */
    subscriptionRepository: ProviderSpec<SubscriptionRepository>;
    /** Consumer implementation of the `PlanVersionRepository` interface. */
    planVersionRepository: ProviderSpec<PlanVersionRepository>;
    /** Consumer implementation of the `TransactionRunner` interface. */
    transactionRunner: ProviderSpec<TransactionRunner>;
    /** Optional consumer resolution strategy (Pilot/Trial/Pending). */
    resolutionConfig?: EntitlementResolutionConfig;
    /** Optional V3 contract adapter. If set, the service reads contracts first. */
    subscriptionContractRepository?: ProviderSpec<SubscriptionContractRepository>;
    /**
     * Optional (P11.7.3/#61) — BOTH together enable the aggregation of
     * independently booked catalog bundles (`subscription_bundles`) in
     * `computeLimits`. Without them, only plan + BusinessType count — bundles
     * booked mid-cycle would then NOT be in the entitlements (and a contract
     * re-freeze would not freeze them in).
     */
    subscriptionBundleRepository?: ProviderSpec<SubscriptionBundleRepository>;
    /** See `subscriptionBundleRepository` — resolves BundleVersion features/quotas. */
    bundleRepository?: ProviderSpec<BundleRepository>;
    /** Register the module globally — default `false`. */
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
