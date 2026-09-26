import type { DynamicModule } from '@nestjs/common';

import { SubscriberAccountModule } from '../../billing/charges/subscriber-account.module.js';
import type { SaaSiCatModuleOptions } from '../module-options.js';

import { adminResourceGuards } from './admin-resources.js';
import { optionsOf, type CompositionContext } from './context.js';

/**
 * Whether the operator is offered a subscriber's account: the administration
 * shows tenants and a charge journal is kept. The route and the capability
 * that announces it both ask this, so neither can exist without the other.
 */
export function servesSubscriberAccounts(options: SaaSiCatModuleOptions): boolean {
    return Boolean(options.adminResources && optionsOf(options.tenantBilling).chargeJournal);
}

/**
 * The operator's view of a subscriber's account, beside the tenant's detail.
 *
 * Runs after `composeAdminResources` and `composeTenantBilling`, and imports
 * the modules they built rather than building its own: the journal and the
 * tenant lookup are theirs.
 */
export function composeSubscriberAccount(ctx: CompositionContext): DynamicModule[] {
    const { adminResourcesModule, tenantBillingModule } = ctx.shared;
    if (!servesSubscriberAccounts(ctx.options) || !adminResourcesModule || !tenantBillingModule) {
        return [];
    }
    return [
        SubscriberAccountModule.forRoot({
            guards: adminResourceGuards(ctx.options),
            imports: [
                adminResourcesModule,
                tenantBillingModule,
                ...(optionsOf(ctx.options.adminResources).imports ?? ctx.options.imports ?? []),
            ],
        }),
    ];
}
