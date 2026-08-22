// The four features that are one module each and read one slice of persistence.
//
// Together in one file because they are the same shape: a config object, a port
// that comes from the option or from the bundle, and the shared `imports`. A
// file each would be four files that say the same thing four times; a file for
// the shape says it once.

import type { DynamicModule } from '@nestjs/common';

import { AdminStatsModule, type AdminStatsModuleOptions } from '../../admin/admin-stats.module.js';
import { SuperAdminGuard } from '../../admin/super-admin.guard.js';
import { CheckoutOfferModule } from '../../checkout-offer/checkout-offer.module.js';
import { SetupModule, type SetupModuleOptions } from '../../setup/setup.module.js';
import {
    SubscriptionContractModule,
    type SubscriptionContractModuleOptions,
} from '../../subscription-contract/subscription-contract.module.js';

import { optionsOf, type CompositionContext } from './context.js';

/** First-run provisioning of the first SuperAdmin. */
export function composeSetup({ options, persistence }: CompositionContext): DynamicModule[] {
    if (!options.setup) return [];
    const config = optionsOf(options.setup);
    return [
        SetupModule.forRoot({
            ...config,
            provisioningPort:
                config.provisioningPort ??
                (persistence?.core
                    .superAdminProvisioning as SetupModuleOptions['provisioningPort']),
            imports: config.imports ?? options.imports,
        }),
    ];
}

/** The aggregates behind the SuperAdmin dashboard. */
export function composeAdminStats({ options, persistence }: CompositionContext): DynamicModule[] {
    const config = options.adminStats;
    if (!config) return [];
    return [
        AdminStatsModule.forRoot({
            ...config,
            guards: config.guards ?? [...options.controller.guards, SuperAdminGuard],
            auditStatsPort:
                config.auditStatsPort ??
                (persistence?.core.auditStats as AdminStatsModuleOptions['auditStatsPort']),
            imports: config.imports ?? options.imports,
        }),
    ];
}

/** The offer a prospect is shown before there is a tenant to bill. */
export function composeCheckoutOffer({
    options,
    persistence,
}: CompositionContext): DynamicModule[] {
    const config = options.checkoutOffer;
    if (!config) return [];
    return [
        CheckoutOfferModule.forRoot({
            ...config,
            bundleRepository: config.bundleRepository ?? persistence?.catalog?.bundleRepository,
            planRepository: config.planRepository ?? persistence?.catalog?.planRepository,
            catalogEntryRepository:
                config.catalogEntryRepository ?? persistence?.catalog?.catalogEntryRepository,
            imports: config.imports ?? options.imports,
        }),
    ];
}

/** The frozen record of what a tenant agreed to. */
export function composeSubscriptionContract({
    options,
    persistence,
}: CompositionContext): DynamicModule[] {
    if (!options.subscriptionContract) return [];
    const config = optionsOf(options.subscriptionContract);
    return [
        SubscriptionContractModule.forRoot({
            ...config,
            subscriptionContractRepository:
                config.subscriptionContractRepository ??
                (persistence?.entitlement
                    ?.subscriptionContractRepository as SubscriptionContractModuleOptions['subscriptionContractRepository']),
            imports: config.imports ?? options.imports,
        }),
    ];
}
