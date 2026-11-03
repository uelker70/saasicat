// What a tenant's users holding the billing permission read of their
// subscription's invoices and contract confirmations (`SC-UI-022`,
// `SC-UI-024`): every invoice of their subscriber, an earlier tenant's joined
// into it included, with where it stands; and the confirmations beside them.
// Every day is the installation's, named by the server (`SC-UI-028`).

import type { InvoicePaymentStanding, InvoiceReference } from './invoice-standing.js';
import type { SubscriptionInvoiceCorrectionKind } from './subscription-invoice.types.js';
import type { CalendarDay } from './zoned-day.js';

/** How many invoices one page of a tenant's list holds. */
export const TENANT_INVOICE_PAGE_SIZE = 50;

/** One invoice of the tenant's subscription, as its list shows it. */
export interface TenantInvoice {
    id: string;
    number: string;
    issueDate: CalendarDay;
    /** The first and the last day its charges cover. */
    servicePeriod: { from: CalendarDay; until: CalendarDay };
    dueDate: CalendarDay;
    totalGross: number;
    currency: string;
    /** Who issued it, by the legal name the invoice names (`SC-UI-022`). */
    issuer: { legalName: string };
    /** What it corrects, on a cancellation invoice or a replacement; `null` otherwise. */
    correction: { kind: SubscriptionInvoiceCorrectionKind; of: InvoiceReference } | null;
    cancelledBy: InvoiceReference | null;
    replacedBy: InvoiceReference | null;
    /** Where its payment stands; `null` for an invoice cancelled, a cancellation invoice and one of nothing. */
    payment: InvoicePaymentStanding | null;
    /**
     * Whether its document is archived and can be downloaded; until then the
     * invoice is listed and its download is not offered (`SC-AUD-014`).
     */
    documentArchived: boolean;
}

/** One page of the tenant's invoices, the newest first; `next` continues it, `null` at the end. */
export interface TenantInvoicePage {
    invoices: TenantInvoice[];
    next: string | null;
}

/** One contract of the tenant's subscription whose conclusion or change is confirmed. */
export interface TenantContractConfirmation {
    contractId: string;
    /** The day the contract was concluded, or the change made, it confirms. */
    concludedOn: CalendarDay;
    /** The first day it is in force. */
    firstDay: CalendarDay;
    /** The title of the plan it was concluded on, as frozen; `null` for a contract without a plan line. */
    planTitle: string | null;
    /** Whether the confirmation is archived and can be downloaded; until then it is being made. */
    archived: boolean;
}

/** The tenant's contract confirmations, the newest first. */
export interface TenantContractConfirmations {
    confirmations: TenantContractConfirmation[];
}
