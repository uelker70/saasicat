// The register of every invoice the installation issued, as the operator
// reads it (`SC-ADM-042`): a page of invoices by issue date and number, and
// what the invoices of the months asked for add up to. The months are the
// installation's, so today is read in the zone `config/saas.yaml` names; the
// read is platform-wide, so inside `RlsBypassPort`.

import { Inject, Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import {
    INVOICE_REGISTER_PAGE_SIZE,
    dayInZone,
    invoiceRegisterSpanOf,
    invoiceRegisterTotalsOf,
    type AdminInvoiceRegisterPage,
    type AdminInvoiceRegisterRow,
    type AdminInvoiceRegisterTotals,
    type InvoiceRegisterQuery,
    type InvoiceRegisterSpan,
    type PlanCatalogSettings,
    type RegisteredInvoice,
    type RlsBypassPort,
    type SubscriptionInvoiceRepository,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { codedError } from '../../errors/coded-error.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../plan-catalog.module.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/** One invoice as the register lists it. */
function rowOf(
    { invoice, cancelledBy }: RegisteredInvoice,
    archived: boolean,
): AdminInvoiceRegisterRow {
    return {
        id: invoice.id,
        number: invoice.number,
        issueDate: invoice.issueDate,
        correction: invoice.correction
            ? { kind: invoice.correction.kind, of: invoice.correction.of }
            : null,
        subscriber: {
            id: invoice.subscriberId,
            customerNumber: invoice.subscriber.customerNumber,
            legalName: invoice.subscriber.legalName,
        },
        tenantId: invoice.tenantId,
        currency: invoice.currency,
        totalNet: invoice.totalNet,
        totalTax: invoice.totalTax,
        totalGross: invoice.totalGross,
        documentArchived: archived,
        cancelledBy,
    };
}

/**
 * The months `query` names, the current one where it names none — today read
 * in `timeZone` —; refused with `422` for months the register does not span:
 * reversed, or more than a year. What the register and its export both read.
 */
export function invoiceRegisterSpanAt(
    query: InvoiceRegisterQuery,
    now: Date,
    timeZone: string,
): InvoiceRegisterSpan {
    const { span, refusal } = invoiceRegisterSpanOf(query, dayInZone(now, timeZone));
    if (refusal) {
        throw new UnprocessableEntityException(codedError(refusal.code, refusal.params));
    }
    return span;
}

@Injectable()
export class InvoiceRegisterService {
    constructor(
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: PlanCatalogSettings,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {}

    /**
     * One page of the invoices issued in the months `query` names, by issue
     * date and then number, each with the subscriber it names, whether its
     * document is archived and what cancelled it; the page after the invoice
     * `after` names, where it is given. Rejected with `422` for months the
     * register does not span: reversed, or more than a year.
     */
    async page(
        query: InvoiceRegisterQuery & { after?: string },
        now: Date = new Date(),
    ): Promise<AdminInvoiceRegisterPage> {
        const span = this.spanOf(query, now);
        return readAcrossTenants(this.rlsBypass, async () => {
            const page = await this.invoices.listIssued(
                span.days,
                query.after === undefined
                    ? { limit: INVOICE_REGISTER_PAGE_SIZE }
                    : { limit: INVOICE_REGISTER_PAGE_SIZE, after: query.after },
            );
            const archived = new Set(
                await this.invoices.listArchivedDocuments(
                    page.invoices.map(({ invoice }) => invoice.id),
                ),
            );
            return {
                from: span.from,
                until: span.until,
                invoices: page.invoices.map((each) => rowOf(each, archived.has(each.invoice.id))),
                next: page.hasMore ? (page.invoices.at(-1)?.invoice.id ?? null) : null,
            };
        });
    }

    /**
     * What the invoices issued in the months `query` names add up to, per
     * month, currency, tax treatment and rate, and over all of them. Refused as
     * `page` is.
     */
    async totals(
        query: InvoiceRegisterQuery,
        now: Date = new Date(),
    ): Promise<AdminInvoiceRegisterTotals> {
        const span = this.spanOf(query, now);
        return readAcrossTenants(this.rlsBypass, async () =>
            invoiceRegisterTotalsOf(span, await this.invoices.listIssuedAmounts(span.days)),
        );
    }

    private spanOf(query: InvoiceRegisterQuery, now: Date): InvoiceRegisterSpan {
        // Required with a tax adapter, which invoicing requires.
        return invoiceRegisterSpanAt(query, now, this.settings.timeZone!);
    }
}
