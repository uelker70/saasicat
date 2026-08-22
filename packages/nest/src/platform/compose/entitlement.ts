import type { DynamicModule } from '@nestjs/common';
import type {
    PlanVersionRepository,
    SubscriptionRepository,
    TransactionRunner,
} from '@saasicat/types';

import type { ProviderSpec } from '../../core/di.js';
import { EntitlementModule } from '../../entitlement/module.js';

import type { CompositionContext } from './context.js';

/**
 * The V3 entitlement stack.
 *
 * Global when tenant billing or bundles are on, because their controllers
 * resolve entitlements and a non-global module would have to be imported by
 * each of them.
 */
export function composeEntitlement({
    options,
    adapters,
    persistence,
    requiresFullEntitlement,
}: CompositionContext): DynamicModule[] {
    if (!requiresFullEntitlement) return [];
    return [
        EntitlementModule.forRoot({
            subscriptionRepository:
                adapters.subscriptionRepository as ProviderSpec<SubscriptionRepository>,
            planVersionRepository:
                adapters.planVersionRepository as ProviderSpec<PlanVersionRepository>,
            transactionRunner: adapters.transactionRunner as ProviderSpec<TransactionRunner>,
            resolutionConfig: options.entitlement
                ? options.entitlement.resolutionConfig
                : undefined,
            subscriptionContractRepository:
                persistence?.entitlement?.subscriptionContractRepository,
            subscriptionBundleRepository: persistence?.entitlement?.subscriptionBundleRepository,
            bundleRepository: persistence?.entitlement?.bundleRepository,
            imports: options.imports,
            global: Boolean(options.tenantBilling || options.subscriptionBundles),
        }),
    ];
}
