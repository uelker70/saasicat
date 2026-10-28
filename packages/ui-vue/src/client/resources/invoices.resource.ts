// The register of every invoice the installation issued (`SC-ADM-042`): a page
// of the invoices of a span of months, what those months add up to, and their
// export as of a moment for a tax advisor (`SC-ADM-043`). An invoice itself —
// its lines, its cancellation, its document — is reached by its id through the
// subscribers descriptor, as from the subscriber's record. Served where the
// manifest announces `invoices.read`; elsewhere the route answers 404.

import type {
    AdminInvoiceRegisterPage,
    AdminInvoiceRegisterTotals,
    CalendarMonth,
    InvoiceExportLocale,
    LocalMoment,
} from '@saasicat/core';

import { defineResource } from './define-resource.js';
import { requestFile, requestJsonBody, type DownloadedFile } from './resource-request.js';

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

/** What the export of the months is asked for: the moment it is as of and its language. */
export interface InvoiceExportQuery extends InvoiceRegisterMonths {
    /** A day and a time on a clock of the installation's zone; five minutes ago where none. */
    asOf?: LocalMoment;
    /** The language of the CSV tables; English where none. */
    locale?: InvoiceExportLocale;
}

/** `?from=…&until=…`, and each further parameter, only where it is given; empty where none is. */
function searchOf(request: InvoiceRegisterRequest & InvoiceExportQuery): string {
    const query = new URLSearchParams();
    for (const name of ['from', 'until', 'after', 'asOf', 'locale'] as const) {
        const value = request[name];
        if (value) query.set(name, value);
    }
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

    /**
     * The ZIP of the months as of a moment: the three tables, `export.json` and
     * the manifest, under the name the platform offers.
     */
    export: (http, ctx, query: InvoiceExportQuery = {}): Promise<DownloadedFile> =>
        requestFile(
            http,
            `${ctx.apiBase}/invoice-export${searchOf({
                from: query.from,
                until: query.until,
                asOf: query.asOf,
                locale: query.locale,
            })}`,
            'invoices.zip',
        ),
});
