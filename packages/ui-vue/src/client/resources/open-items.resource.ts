// The open items of the installation (`SC-ADM-044`): a page of the invoices
// that still owe something, a page of the credits the operator still owes, and
// what both add up to. A credit is paid out through the subscribers descriptor,
// as from the subscriber's record. Served where the manifest announces
// `payments.read`; elsewhere the routes answer 404.

import type {
    AdminOpenCreditPage,
    AdminOpenInvoicePage,
    AdminOpenItemTotals,
} from '@saasicat/core';

import { defineResource } from './define-resource.js';
import { requestJsonBody } from './resource-request.js';

/** What one page of the open invoices is asked for. */
export interface OpenInvoicesRequest {
    /** Only those overdue today. */
    overdue?: boolean;
    /** The invoice the page before ended with. */
    after?: string;
}

/** What one page of the open credits is asked for. */
export interface OpenCreditsRequest {
    /** The credit the page before ended with. */
    after?: string;
}

/** `?…` of the parameters given, or nothing. */
function searchOf(entries: ReadonlyArray<[string, string | undefined]>): string {
    const query = new URLSearchParams();
    for (const [key, value] of entries) if (value) query.set(key, value);
    const search = query.toString();
    return search === '' ? '' : `?${search}`;
}

export const openItemsResource = defineResource('openItems', {
    /** One page of the invoices that still owe something, the oldest due date first. */
    invoices: (http, ctx, request: OpenInvoicesRequest = {}): Promise<AdminOpenInvoicePage> =>
        requestJsonBody<AdminOpenInvoicePage>(
            http,
            `${ctx.apiBase}/open-items${searchOf([
                ['overdue', request.overdue ? 'true' : undefined],
                ['after', request.after],
            ])}`,
            'The open invoices returned no body',
        ),

    /** One page of the credits the operator still owes, the oldest first. */
    credits: (http, ctx, request: OpenCreditsRequest = {}): Promise<AdminOpenCreditPage> =>
        requestJsonBody<AdminOpenCreditPage>(
            http,
            `${ctx.apiBase}/open-credits${searchOf([['after', request.after]])}`,
            'The open credits returned no body',
        ),

    /** What the open invoices and credits add up to per currency. */
    totals: (http, ctx): Promise<AdminOpenItemTotals> =>
        requestJsonBody<AdminOpenItemTotals>(
            http,
            `${ctx.apiBase}/open-item-totals`,
            'The totals of the open items returned no body',
        ),
});
