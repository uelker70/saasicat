// The open items of the installation: the invoices that still owe something,
// and the credits the operator still owes a subscriber (`SC-ADM-044`). What
// either owes is derived from its rows by the rule in
// `subscriber-payment-rules.ts`; a store reads both by that rule, nothing is
// stored beside the rows.

import type { CollectionFailureReason, PaymentMethodType } from './payment-gateway.types.js';
import type { InvoiceCollectionStatus } from './invoice-collection.types.js';
import type { SubscriberCreditOrigin, SubscriberCreditRecord } from './subscriber-payment.types.js';
import type { CalendarDay } from './zoned-day.js';

/** How many open invoices, or open credits, one page holds. */
export const OPEN_ITEMS_PAGE_SIZE = 50;

/** An invoice that still owes something, and what. */
export interface OwingInvoice {
    invoiceId: string;
    /** Above `0`, of the invoice's currency. */
    owed: number;
}

/** A page of open invoices, the oldest due date first, and whether another follows. */
export interface OwingInvoicePage {
    invoices: OwingInvoice[];
    hasMore: boolean;
}

/** A credit the operator still owes, and what of it. */
export interface OwedCredit {
    credit: SubscriberCreditRecord;
    /** Above `0`, of the credit's currency. */
    open: number;
}

/** A page of open credits, the oldest first, and whether another follows. */
export interface OwedCreditPage {
    credits: OwedCredit[];
    hasMore: boolean;
}

/** What the open items add up to, per currency. */
export interface OpenItemTotals {
    /** Owed, and of it what was due before the day asked about. */
    invoices: { currency: string; owed: number; overdue: number }[];
    credits: { currency: string; open: number }[];
}

/** An open invoice as the operator reads it. */
export interface AdminOpenInvoice {
    id: string;
    number: string;
    issueDate: CalendarDay;
    dueDate: CalendarDay;
    /** Calendar days since its due date, in the installation's zone; `0` while it is not overdue. */
    daysOverdue: number;
    currency: string;
    totalGross: number;
    owed: number;
    /** The subscriber as the invoice names it, and the record it leads to. */
    subscriber: { id: string; customerNumber: string; legalName: string };
    tenantId: string;
    /** The payment method it is collected with; `null` where it is not, and is paid by transfer. */
    payment: { type: PaymentMethodType; last4: string } | null;
    /** The latest attempt to collect it; `null` where none was made. */
    lastAttempt: {
        status: InvoiceCollectionStatus;
        /** ISO 8601, when it left; `null` for one planned and not sent. */
        submittedAt: string | null;
        failureReason: CollectionFailureReason | null;
    } | null;
}

/** A page of open invoices as the operator reads it, and the invoice the next one continues after. */
export interface AdminOpenInvoicePage {
    /** The day they were read on, in the installation's zone. */
    today: CalendarDay;
    overdueOnly: boolean;
    invoices: AdminOpenInvoice[];
    /** `null` on the last page. */
    next: string | null;
}

/** An open credit as the operator reads it. */
export interface AdminOpenCredit {
    id: string;
    currency: string;
    amount: number;
    open: number;
    /** What it arose from; the record names the payment, invoice or reversal. */
    origin: SubscriberCreditOrigin['kind'];
    /** ISO 8601. */
    createdAt: string;
    subscriber: { id: string; customerNumber: string; legalName: string };
    tenantId: string;
}

/** A page of open credits as the operator reads it. */
export interface AdminOpenCreditPage {
    credits: AdminOpenCredit[];
    next: string | null;
    /** The installation's zone, in which a payout's day is judged. */
    timeZone: string;
}

/** What the open items add up to, as the operator reads it. */
export interface AdminOpenItemTotals extends OpenItemTotals {
    today: CalendarDay;
}
