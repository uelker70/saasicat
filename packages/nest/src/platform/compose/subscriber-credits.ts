import type { DynamicModule } from '@nestjs/common';

import { SubscriberCreditModule } from '../../billing/invoices/subscriber-credit.module.js';
import { SubscriberReconciliationModule } from '../../billing/invoices/subscriber-reconciliation.module.js';
import type { SaaSiCatModuleOptions } from '../module-options.js';

import { adminResourceGuards } from './admin-resources.js';
import { optionsOf, type CompositionContext } from './context.js';

/**
 * Whether the operator is offered a subscriber's credits and the payout
 * against one, the cases to reconcile and a tenant's invoices with what each
 * still owes: the administration shows tenants, invoices are collected, and
 * what the collections bring is recorded — by the payments the application
 * names, or the bundle's. The routes and the capabilities that announce them
 * all ask this, so none exists without the others; where the payments are
 * missing, the start says so instead.
 */
export function servesSubscriberCredits(options: SaaSiCatModuleOptions): boolean {
    const invoices = optionsOf(options.tenantBilling).chargeJournal?.invoices;
    return Boolean(
        options.adminResources &&
        invoices?.collections &&
        (invoices.payments ?? options.persistence?.entitlement?.subscriberPaymentRepository),
    );
}

/**
 * The operator's view of a subscriber's credits and the payout recorded
 * against one, and the cases to reconcile with a tenant's invoices beside them.
 *
 * Runs after `composeAdminResources` and `composeTenantBilling`, and imports
 * the modules they built rather than building its own: the payments and the
 * tenant lookup are theirs.
 */
export function composeSubscriberCredits(ctx: CompositionContext): DynamicModule[] {
    const { adminResourcesModule, tenantBillingModule } = ctx.shared;
    if (!servesSubscriberCredits(ctx.options) || !adminResourcesModule || !tenantBillingModule) {
        return [];
    }
    const served = {
        guards: adminResourceGuards(ctx.options),
        imports: [
            adminResourcesModule,
            tenantBillingModule,
            ...(optionsOf(ctx.options.adminResources).imports ?? ctx.options.imports ?? []),
        ],
    };
    return [SubscriberCreditModule.forRoot(served), SubscriberReconciliationModule.forRoot(served)];
}
