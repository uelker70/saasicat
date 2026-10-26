// The register of every invoice the installation issued: what an operator
// hands an advisor for a month or a quarter — each invoice by its date and
// number, and what they add up to per month, tax treatment and rate
// (`SC-ADM-042`).

import type { TaxAtRate } from './money.js';
import type {
    SubscriptionInvoiceCorrection,
    SubscriptionInvoiceRecord,
} from './subscription-invoice.types.js';
import type { TaxTreatmentKind } from './tax.types.js';
import type { CalendarDay } from './zoned-day.js';

/** A calendar month, `YYYY-MM`, in the installation's time zone. */
export type CalendarMonth = string;

/** The most months one view of the register spans: a year, so a read stays bounded. */
export const INVOICE_REGISTER_MAX_MONTHS = 12;

/** How many invoices one page of the register holds. */
export const INVOICE_REGISTER_PAGE_SIZE = 50;

/** The issue dates a read of the register covers, both days included. */
export interface InvoiceRegisterRange {
    from: CalendarDay;
    until: CalendarDay;
}

/** An issued invoice as the register reads it: the invoice, and the cancellation invoice that cancelled it. */
export interface RegisteredInvoice {
    invoice: SubscriptionInvoiceRecord;
    /** `null` while it stands; named however long after the range it was cancelled. */
    cancelledBy: { invoiceId: string; number: string } | null;
}

/** A page of the register, by issue date and then number, and whether another page follows. */
export interface InvoiceRegisterPage {
    invoices: RegisteredInvoice[];
    hasMore: boolean;
}

/** What one issued invoice adds to the register's totals. */
export interface IssuedInvoiceAmounts {
    issueDate: CalendarDay;
    currency: string;
    kind: TaxTreatmentKind;
    /** Rate by rate, as the invoice states them; negative on a cancellation invoice. */
    taxes: TaxAtRate[];
}

/** The months the operator asks the register for; a month left out is the other one, both left out the current month. */
export interface InvoiceRegisterQuery {
    from?: CalendarMonth;
    until?: CalendarMonth;
}

/** One sum of the register: the invoices of one currency, treatment and rate. */
export interface AdminInvoiceTotal {
    currency: string;
    kind: TaxTreatmentKind;
    /** In per cent. */
    rate: number;
    net: number;
    tax: number;
    gross: number;
}

/** The sums of one month, in the order `invoiceRegisterTotalsOf` gives them; none in a month without invoices. */
export interface AdminInvoiceMonthTotals {
    month: CalendarMonth;
    totals: AdminInvoiceTotal[];
}

/** What the invoices of the months asked for add up to, month by month and over all of them. */
export interface AdminInvoiceRegisterTotals {
    from: CalendarMonth;
    until: CalendarMonth;
    /** Every month of the range, the earliest first. */
    months: AdminInvoiceMonthTotals[];
    /** The sums of the whole range. */
    range: AdminInvoiceTotal[];
}

/** One invoice as the register lists it. */
export interface AdminInvoiceRegisterRow {
    id: string;
    number: string;
    issueDate: CalendarDay;
    /** What it corrects, on a cancellation invoice or a replacement; `null` on any other. */
    correction: Pick<SubscriptionInvoiceCorrection, 'kind' | 'of'> | null;
    /** The subscriber as the invoice names it, and the record it leads to. */
    subscriber: { id: string; customerNumber: string; legalName: string };
    tenantId: string;
    currency: string;
    totalNet: number;
    totalTax: number;
    totalGross: number;
    /** Whether its document is archived; until then it is neither sent nor cancelled. */
    documentArchived: boolean;
    cancelledBy: { invoiceId: string; number: string } | null;
}

/** A page of the register as the operator reads it, and the invoice the next one continues after. */
export interface AdminInvoiceRegisterPage {
    from: CalendarMonth;
    until: CalendarMonth;
    invoices: AdminInvoiceRegisterRow[];
    /** `null` on the last page. */
    next: string | null;
}
