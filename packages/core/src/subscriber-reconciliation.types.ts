// What the gateway reported about money and nothing matched: the part of a
// refund that no credit takes, and the part of a reversal that meets a credit
// already paid out or goes beyond what its payment brought. Each is a case for
// the operator to reconcile, on a list of its own and on the subscriber's
// tenant page, closed with a note (`SC-ADM-033`). SaaSiCat closes a case
// itself only where the money it was about came back: the refund failed, or
// the gateway gave the reversal back (`SC-PRIC-086`).

import type { CalendarDay } from './zoned-day.js';

/** What a case is about: a refund no credit takes, or a reversal no credit takes. */
export type ReconciliationCaseKind = 'REFUND_UNMATCHED' | 'REVERSAL_UNMATCHED';

/** A case to reconcile, as a store reads it back. */
export interface SubscriberReconciliationCaseRecord {
    id: string;
    subscriberId: string;
    /** The tenant the payment's invoice was for, as a trace. */
    tenantId: string;
    kind: ReconciliationCaseKind;
    /** What matched nothing, positive, of `currency`. */
    amount: number;
    currency: string;
    /** The payment the refund pays back, or the reversal takes back. */
    paymentId: string;
    /** The refund, for a `REFUND_UNMATCHED`; `null` otherwise. */
    refundId: string | null;
    /** The reversal, for a `REVERSAL_UNMATCHED`; `null` otherwise. */
    reversalId: string | null;
    gatewayAccount: string;
    /** The refund's or the reversal's reference at the gateway, which the operator finds it under. */
    gatewayRef: string;
    recordedAt: Date;
    /** When it was closed; `null` while it is open. */
    closedAt: Date | null;
    /** Who closed it; `null` while it is open, and where SaaSiCat closed it. */
    closedBy: string | null;
    /** Why it was closed, in the operator's words or SaaSiCat's; `null` while it is open. */
    note: string | null;
}

/** An operator closing a case. */
export interface CloseReconciliationCase {
    caseId: string;
    note: string;
    /** Who closes it. */
    closedBy: string;
    at: Date;
}

/** What closing a case did. */
export type ClosedReconciliationCase =
    | { outcome: 'closed'; case: SubscriberReconciliationCaseRecord }
    | { outcome: 'unknown-case' }
    /** Closed before, by the operator or by SaaSiCat; nothing is written. */
    | { outcome: 'already-closed'; case: SubscriberReconciliationCaseRecord };

/** Whether a list reads the cases still open or the ones closed. */
export type ReconciliationCaseState = 'open' | 'closed';

/**
 * The manifest capability that announces the operator's list of cases to
 * reconcile. The platform sets it where it serves the list.
 */
export const RECONCILIATION_READ_CAPABILITY = 'reconciliation.read';

/**
 * The manifest capability that announces closing a case with a note, beside
 * the list.
 */
export const RECONCILIATION_CLOSE_CAPABILITY = 'reconciliation.close';

/**
 * The manifest capability that announces a tenant's invoices with what each
 * still owes, and its open cases, on its page.
 */
export const SUBSCRIBER_PAYMENTS_CAPABILITY = 'payments.read';

/** A case as the operator reads it. */
export interface AdminReconciliationCase {
    id: string;
    kind: ReconciliationCaseKind;
    amount: number;
    currency: string;
    /** The tenant the payment's invoice was for, which the administration's tenant list names. */
    tenantId: string;
    subscriber: { id: string; customerNumber: string; legalName: string };
    /** The payment it is about, and the invoice that payment was collected for. */
    payment: { ref: string; invoiceNumber: string | null };
    gatewayAccount: string;
    /** The refund's or the reversal's reference at the gateway. */
    reference: string;
    /** ISO 8601. */
    recordedAt: string;
    /** ISO 8601; `null` while it is open. */
    closedAt: string | null;
    /** Who closed it; `null` while it is open, and where SaaSiCat closed it. */
    closedBy: string | null;
    note: string | null;
}

/** One page of cases, the oldest first; `next` continues it, `null` at the end. */
export interface AdminReconciliationCases {
    cases: AdminReconciliationCase[];
    next: string | null;
}

/** The longest note a case is closed with, which the route and the form both hold to. */
export const RECONCILIATION_NOTE_MAX_LENGTH = 500;

/** An operator's note closing a case. */
export interface AdminReconciliationClose {
    note: string;
}

/** An invoice on its tenant's page: what it asked for, and what it still owes. */
export interface AdminTenantInvoice {
    id: string;
    number: string;
    /** ISO 8601. */
    issuedAt: string;
    dueDate: CalendarDay;
    totalGross: number;
    currency: string;
    /**
     * What it still owes after every payment, reversal and reinstatement
     * against it; negative where the subscriber is owed, as by an invoice whose
     * total is negative.
     */
    owed: number;
}

/** A tenant's invoices, the newest first, and its cases still open, the oldest first. */
export interface AdminTenantPayments {
    invoices: AdminTenantInvoice[];
    openCases: AdminReconciliationCase[];
}
