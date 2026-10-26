// The register of every invoice the installation issued (`SC-ADM-042`): a page
// of the invoices of a span of months, and what those months add up to. An
// invoice itself — its lines, its cancellation, its document — is reached by
// its id through the subscribers descriptor, as from the subscriber's record.
// Served where the manifest announces `invoices.read`; elsewhere the route
// answers 404.

import type {
    AdminInvoiceRegisterPage,
    AdminInvoiceRegisterTotals,
    CalendarMonth,
} from '@saasicat/core';

import { defineResource } from './define-resource.js';
import { requestJsonBody } from './resource-request.js';

/** The months the register is read for; one left out is the other, both left out the current month. */
export interface InvoiceRegisterMonths {
    from?: CalendarMonth;
    until?: CalendarMonth;
}

/** What one page of the register is asked for. */
export interface InvoiceRegisterRequest extends InvoiceRegisterMonths {
    /** The invoice the page before ended with. */
    after?: string;
}

/** `?from=…&until=…&after=…`, each only where it is given; empty where none is. */
function searchOf(request: InvoiceRegisterRequest): string {
    const query = new URLSearchParams();
    if (request.from) query.set('from', request.from);
    if (request.until) query.set('until', request.until);
    if (request.after) query.set('after', request.after);
    const search = query.toString();
    return search === '' ? '' : `?${search}`;
}

export const invoicesResource = defineResource('invoices', {
    /** One page of the register, by issue date and then number. */
    list: (http, ctx, request: InvoiceRegisterRequest = {}): Promise<AdminInvoiceRegisterPage> =>
        requestJsonBody<AdminInvoiceRegisterPage>(
            http,
            `${ctx.apiBase}/invoices${searchOf(request)}`,
            'The invoice register returned no body',
        ),

    /** What the invoices of the months add up to, per month and over all of them. */
    totals: (http, ctx, months: InvoiceRegisterMonths = {}): Promise<AdminInvoiceRegisterTotals> =>
        requestJsonBody<AdminInvoiceRegisterTotals>(
            http,
            `${ctx.apiBase}/invoice-totals${searchOf({ from: months.from, until: months.until })}`,
            'The invoice totals returned no body',
        ),
});
