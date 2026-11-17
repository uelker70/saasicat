import type { DynamicModule } from '@nestjs/common';

import { TenantDeletionAdminModule } from '../../billing/deletion/tenant-deletion-admin.module.js';
import type { SaaSiCatModuleOptions } from '../module-options.js';

import { adminResourceGuards } from './admin-resources.js';
import { optionsOf, type CompositionContext } from './context.js';

/**
 * Whether the operator is offered where a tenant's deletion stands: the
 * administration shows tenants and their subscriptions are billed, which
 * records every end and deletes on its day — `tenantBilling.subscriptionEnds`
 * is required wherever tenants are billed. The routes and the capability that
 * announces them both ask this, so neither can exist without the other.
 */
export function servesTenantDeletions(options: SaaSiCatModuleOptions): boolean {
    return Boolean(options.adminResources && options.tenantBilling);
}

/**
 * The operator's view of a tenant's deletion, on the tenant's page and in its
 * subscriber's record.
 *
 * Runs after `composeAdminResources` and `composeTenantBilling`, and imports
 * the modules they built rather than building its own: the tenant lookup and
 * the deletions are theirs.
 */
export function composeTenantDeletions(ctx: CompositionContext): DynamicModule[] {
    const { adminResourcesModule, tenantBillingModule } = ctx.shared;
    if (!servesTenantDeletions(ctx.options) || !adminResourcesModule || !tenantBillingModule) {
        return [];
    }
    return [
        TenantDeletionAdminModule.forRoot({
            guards: adminResourceGuards(ctx.options),
            imports: [
                adminResourcesModule,
                tenantBillingModule,
                ...(optionsOf(ctx.options.adminResources).imports ?? ctx.options.imports ?? []),
            ],
        }),
    ];
}
