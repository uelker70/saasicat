import type { DynamicModule } from '@nestjs/common';

import { InvoiceCancellationModule } from '../../billing/invoices/invoice-cancellation.module.js';
import { InvoiceDocumentModule } from '../../billing/invoices/invoice-document.module.js';
import type { SaaSiCatModuleOptions } from '../module-options.js';

import { adminResourceGuards } from './admin-resources.js';
import { optionsOf, type CompositionContext } from './context.js';

/**
 * Whether the operator is offered an invoice's document and its cancellation:
 * the administration shows tenants and invoices are issued. The routes and the
 * capabilities that announce them all ask this, so none can exist without the
 * others; a cancellation needs the archived document (`SC-PRIC-091`).
 */
export function servesInvoiceDocuments(options: SaaSiCatModuleOptions): boolean {
    return Boolean(
        options.adminResources && optionsOf(options.tenantBilling).chargeJournal?.invoices,
    );
}

/**
 * The operator's download of an invoice's archived document, and the
 * cancellation of an issued invoice with its preview.
 *
 * Runs after `composeAdminResources` and `composeTenantBilling`, and imports
 * the modules they built rather than building its own: the invoices, the
 * renderer, the archive and the mail are tenant billing's, the tenant lookup
 * the administration's.
 */
export function composeInvoiceDocuments(ctx: CompositionContext): DynamicModule[] {
    const { adminResourcesModule, tenantBillingModule } = ctx.shared;
    if (!servesInvoiceDocuments(ctx.options) || !adminResourcesModule || !tenantBillingModule) {
        return [];
    }
    const applicationImports =
        optionsOf(ctx.options.adminResources).imports ?? ctx.options.imports ?? [];
    const guards = adminResourceGuards(ctx.options);
    return [
        InvoiceDocumentModule.forRoot({
            guards,
            imports: [tenantBillingModule, ...applicationImports],
        }),
        InvoiceCancellationModule.forRoot({
            guards,
            imports: [adminResourcesModule, tenantBillingModule, ...applicationImports],
        }),
    ];
}
