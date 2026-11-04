// What the tenant's invoice list shows of each invoice, worded from the
// catalogue and written with the application's formatters. The server decided
// where each invoice stands and named every day (`SC-UI-028`); this only
// words it. A link names the other invoice by its number and points at its
// row, so a cancelled invoice leads to its cancellation and its replacement,
// and each of those back (`SC-UI-024`).

import { invoicePaymentOf } from '@saasicat/ui-vue';
import type { InvoiceReference, TenantInvoice } from '@saasicat/core';

import type { TenantPlanSectionI18n } from '../default-i18n.js';
import { writeDay } from '../day-as-instant.js';
import { messageParts, type MessagePart } from '../message-parts.js';

/** How the application writes a day, and an amount in its ISO 4217 currency. */
export interface InvoiceRowFormats {
    formatDate: (iso: string) => string;
    formatCurrency: (amount: number, currency: string) => string;
}

/** A sentence naming another invoice, whose number leads to that invoice's row. */
export interface InvoiceRowLink {
    parts: MessagePart[];
    /** The invoice it names, which may stand on a page not read yet. */
    invoiceId: string;
    /** The element id of the row the number leads to. */
    target: string;
}

export interface InvoiceRow {
    id: string;
    /** The element id of its own row, which the other invoices' links lead to. */
    anchor: string;
    number: string;
    issued: string;
    period: string;
    due: string;
    total: string;
    /** Who issued it, where the list holds invoices of more than one issuer; `null` otherwise. */
    issuer: string | null;
    links: InvoiceRowLink[];
    payment: string;
    documentArchived: boolean;
}

/** The element id of an invoice's row. */
export function invoiceAnchorOf(invoiceId: string): string {
    return `sp-invoice-${invoiceId}`;
}

/** The issuers the invoices name, in the order they first appear. */
export function issuersOf(invoices: readonly TenantInvoice[]): string[] {
    return [...new Set(invoices.map((invoice) => invoice.issuer.legalName))];
}

/** Every invoice as the list shows it. */
export function invoiceRowsOf(
    invoices: readonly TenantInvoice[],
    i18n: TenantPlanSectionI18n,
    formats: InvoiceRowFormats,
): InvoiceRow[] {
    const severalIssuers = issuersOf(invoices).length > 1;
    const day = (value: string) => writeDay(formats.formatDate, value);
    return invoices.map((invoice) => ({
        id: invoice.id,
        anchor: invoiceAnchorOf(invoice.id),
        number: invoice.number,
        issued: day(invoice.issueDate),
        period: messageParts(i18n.invoicesPeriod, {
            from: day(invoice.servicePeriod.from),
            until: day(invoice.servicePeriod.until),
        })
            .map((part) => part.text)
            .join(''),
        due: day(invoice.dueDate),
        total: formats.formatCurrency(invoice.totalGross, invoice.currency),
        issuer: severalIssuers ? invoice.issuer.legalName : null,
        links: linksOf(invoice, i18n),
        payment: invoicePaymentOf(invoice, paymentMessagesOf(i18n), {
            day,
            money: (amount) => formats.formatCurrency(amount, invoice.currency),
        }),
        documentArchived: invoice.documentArchived,
    }));
}

function linksOf(invoice: TenantInvoice, i18n: TenantPlanSectionI18n): InvoiceRowLink[] {
    const links: Array<[string, InvoiceReference | null]> = [
        [
            invoice.correction?.kind === 'cancellation'
                ? i18n.invoiceCancellationOf
                : i18n.invoiceReplacementOf,
            invoice.correction?.of ?? null,
        ],
        [i18n.invoiceCancelledBy, invoice.cancelledBy],
        [i18n.invoiceReplacedBy, invoice.replacedBy],
    ];
    return links.flatMap(([template, other]) =>
        other
            ? [
                  {
                      parts: messageParts(template, { number: other.number }, ['number']),
                      invoiceId: other.invoiceId,
                      target: invoiceAnchorOf(other.invoiceId),
                  },
              ]
            : [],
    );
}

function paymentMessagesOf(i18n: TenantPlanSectionI18n) {
    return {
        paymentOpen: i18n.invoicePaymentOpen,
        paymentOverdue: i18n.invoicePaymentOverdue,
        paymentOpenPart: i18n.invoicePaymentOpenPart,
        paymentOverduePart: i18n.invoicePaymentOverduePart,
        paymentReversed: i18n.invoicePaymentReversed,
        paymentPaid: i18n.invoicePaymentPaid,
        paymentToBeRefunded: i18n.invoicePaymentToBeRefunded,
        paymentToBeRefundedPart: i18n.invoicePaymentToBeRefundedPart,
        paymentRefunded: i18n.invoicePaymentRefunded,
    };
}
