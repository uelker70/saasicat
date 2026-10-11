import type { DynamicModule } from '@nestjs/common';

import { InvoiceDocumentModule } from '../../billing/invoices/invoice-document.module.js';
import type { SaaSiCatModuleOptions } from '../module-options.js';

import { adminResourceGuards } from './admin-resources.js';
import { optionsOf, type CompositionContext } from './context.js';

/**
 * Whether the operator is offered an invoice's document: the administration
 * shows tenants and invoices are issued. The route and the capability that
 * announces it both ask this, so neither can exist without the other.
 */
export function servesInvoiceDocuments(options: SaaSiCatModuleOptions): boolean {
    return Boolean(
        options.adminResources && optionsOf(options.tenantBilling).chargeJournal?.invoices,
    );
}

/**
 * The operator's download of an invoice's archived document.
 *
 * Runs after `composeAdminResources` and `composeTenantBilling`, and imports
 * the module tenant billing built rather than building its own: the invoices,
 * the renderer, the archive and the mail are its.
 */
export function composeInvoiceDocuments(ctx: CompositionContext): DynamicModule[] {
    const { adminResourcesModule, tenantBillingModule } = ctx.shared;
    if (!servesInvoiceDocuments(ctx.options) || !adminResourcesModule || !tenantBillingModule) {
        return [];
    }
    return [
        InvoiceDocumentModule.forRoot({
            guards: adminResourceGuards(ctx.options),
            imports: [
                tenantBillingModule,
                ...(optionsOf(ctx.options.adminResources).imports ?? ctx.options.imports ?? []),
            ],
        }),
    ];
}
