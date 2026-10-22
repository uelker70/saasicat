// Whether an installation can issue invoices as it is configured — checked at
// the start, so a misconfiguration is a boot that does not happen rather than
// an invoice that cannot be issued, or one issued wrongly, at the first run.

import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import type {
    PlanCatalogSettings,
    RlsBypassPort,
    SubscriptionInvoiceRepository,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/**
 * What keeps the configuration and the wiring from issuing invoices together;
 * empty where nothing does. `wired` is whether the application wires
 * `tenantBilling.chargeJournal.invoices` and with which ports, `adapterBound`
 * whether a tax adapter decides.
 *
 * The block and the wiring go together: invoices issued without the block
 * would have no number range and no payment term, and a block without the
 * wiring would look like invoicing to an operator reading the file while
 * nothing issues an invoice.
 */
export function invoicingStartProblems(
    settings: Pick<PlanCatalogSettings, 'invoicing' | 'issuer' | 'payments'>,
    wired:
        | { renderer?: unknown; archive?: unknown; mail?: unknown; collections?: unknown }
        | undefined,
    adapterBound: boolean,
): string[] {
    if (!wired) {
        return settings.invoicing
            ? [
                  'config/saas.yaml names invoicing, and the application wires no invoices: ' +
                      'pass tenantBilling.chargeJournal.invoices, or remove the block.',
              ]
            : [];
    }
    const problems: string[] = [];
    if (!settings.invoicing) {
        problems.push(
            'the application wires tenantBilling.chargeJournal.invoices, and config/saas.yaml ' +
                'names no invoicing: name its numberPrefix and paymentTermDays.',
        );
    }
    if (!adapterBound) {
        problems.push(
            'invoices need a tax adapter, which decides their treatment, checks their content ' +
                'and computes their tax: name it under tax in config/saas.yaml and bind it.',
        );
    }
    if (!settings.issuer) {
        problems.push('invoices name their issuer: name it under issuer in config/saas.yaml.');
    }
    // An invoice is paid through the gateway: without one it would stand open
    // with nothing that could ever collect it.
    if (!settings.payments) {
        problems.push(
            'invoices are paid through a payment gateway: name its accounts under payments in ' +
                'config/saas.yaml.',
        );
    }
    // An invoice draws its number before its document is rendered: without
    // any of these it would be numbered and then wait for its document, or its
    // mail, indefinitely.
    if (!wired.renderer) {
        problems.push(
            'invoices need a renderer for their document: pass chargeJournal.invoices.renderer.',
        );
    }
    if (!wired.archive) {
        problems.push(
            'invoices need an archive for their document: pass chargeJournal.invoices.archive, ' +
                'such as persistence.entitlement.subscriptionInvoiceArchive.',
        );
    }
    if (!wired.mail) {
        problems.push('invoices reach the subscriber by email: pass chargeJournal.invoices.mail.');
    }
    // An installation that takes payment methods issues invoices that
    // announce a collection; without the attempts nothing would make it.
    if (settings.payments && !wired.collections) {
        problems.push(
            'config/saas.yaml names payment accounts, so invoices announce how they are collected, ' +
                'and nothing collects them: pass chargeJournal.invoices.collections, such as ' +
                'persistence.entitlement.invoiceCollectionRepository.',
        );
    }
    return problems;
}

/**
 * Why the configured prefix cannot number the next invoice, or `null` where it
 * can: once an invoice exists, its prefix is the range's, and another one would
 * make the invoices before and after the change read as two ranges
 * (`SC-PRIC-024`).
 */
export function prefixProblem(configured: string, issued: readonly string[]): string | null {
    const other = issued.filter((prefix) => prefix !== configured);
    if (other.length === 0) return null;
    return (
        `config/saas.yaml#invoicing.numberPrefix is ${JSON.stringify(configured)}, and invoices ` +
        `have been issued under ${other.map((prefix) => JSON.stringify(prefix)).join(' and ')}. ` +
        'The prefix of an invoice number range cannot change once an invoice exists: name the ' +
        'prefix the issued invoices carry.'
    );
}

/** Refuses a start whose prefix is not the one the issued invoices carry. */
@Injectable()
export class InvoiceNumberPrefixCheck implements OnModuleInit {
    private readonly logger = new Logger(InvoiceNumberPrefixCheck.name);

    constructor(
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: PlanCatalogSettings,
        // The invoices are the installation's, not a tenant's.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {}

    async onModuleInit(): Promise<void> {
        const configured = this.settings.invoicing?.numberPrefix;
        // Refused before this runs by the check of the block itself.
        if (configured === undefined) return;
        const issued = await readAcrossTenants(this.rlsBypass, () =>
            this.invoices.listIssuedNumberPrefixes(),
        );
        const problem = prefixProblem(configured, issued);
        if (problem) {
            this.logger.error(problem);
            throw new Error(`Invoices cannot start:\n- ${problem}`);
        }
    }
}
