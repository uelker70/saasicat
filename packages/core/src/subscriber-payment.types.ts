// What money moved between a subscriber and the operator, as the gateway
// reports it: a payment collected for an invoice and what it settles there, a
// credit where the subscriber is owed money, and what pays a credit out — a
// refund the operator makes in the gateway, or a payout outside it
// (`SC-PRIC-029`, `SC-PRIC-031`, `SC-PRIC-083`).
//
// Nothing here is edited once written. A payment is recorded once, by its
// gateway account and the gateway's reference, however often and in whatever
// order it is reported; what it settles is an entry of its own, so a reversal
// or a cancellation's replacement later adds an entry rather than changing
// one. A credit is never offset against a later invoice: the operator pays it
// out, and SaaSiCat initiates nothing (ADR 0012, `SC-PRIC-076`).

import type { CalendarDay } from './zoned-day.js';

/** A payment the gateway confirmed for an invoice, as a store reads it back. */
export interface SubscriberPaymentRecord {
    id: string;
    subscriberId: string;
    /** The tenant the invoice was for, as a trace. */
    tenantId: string;
    /** The invoice it was collected for. */
    invoiceId: string;
    /** The attempt that collected it. */
    collectionId: string;
    /** The account in `config/saas.yaml#payments.accounts` it was collected at. */
    gatewayAccount: string;
    provider: string;
    /** The gateway's own reference to the payment, unique within its account. */
    gatewayRef: string;
    /** What the gateway received, of `currency`. */
    amount: number;
    currency: string;
    recordedAt: Date;
}

/** A payment to record: what the gateway reported for an attempt. */
export interface NewSubscriberPayment {
    invoiceId: string;
    collectionId: string;
    gatewayAccount: string;
    provider: string;
    gatewayRef: string;
    amount: number;
    currency: string;
    at: Date;
}

/** What recording a payment did: what it settles of its invoice, and the credit it left. */
export interface RecordedSubscriberPayment {
    payment: SubscriberPaymentRecord;
    /** The part of the payment that settles its invoice; `0` where the invoice owed nothing. */
    settled: number;
    /** What the payment brought beyond what its invoice owed; `null` where it brought nothing more. */
    credit: SubscriberCreditRecord | null;
}

/** Where a credit comes from. */
export type SubscriberCreditOrigin =
    /** What a payment brought beyond what its invoice still owed. */
    | { kind: 'payment'; paymentId: string }
    /** An invoice whose total is negative: the subscriber is owed its amount. */
    | { kind: 'invoice'; invoiceId: string };

/** Money the operator owes a subscriber, as a store reads it back. */
export interface SubscriberCreditRecord {
    id: string;
    subscriberId: string;
    /** The tenant it arose in, as a trace. */
    tenantId: string;
    /** What the subscriber is owed, positive, of `currency`. */
    amount: number;
    currency: string;
    origin: SubscriberCreditOrigin;
    createdAt: Date;
}

/**
 * What changed how much of a credit is paid out: a refund the gateway reported
 * against it, the same refund given back because it failed, or a payout the
 * operator recorded.
 */
export type SubscriberCreditEntryKind = 'REFUND' | 'REFUND_FAILED' | 'PAYOUT';

/** One change to what a credit has paid out, as a store reads it back. */
export interface SubscriberCreditEntryRecord {
    id: string;
    creditId: string;
    kind: SubscriberCreditEntryKind;
    /**
     * Positive. A `REFUND` and a `PAYOUT` pay this much of the credit out; a
     * `REFUND_FAILED` gives it back.
     */
    amount: number;
    /** The refund, for a `REFUND` and its `REFUND_FAILED`; `null` for a `PAYOUT`. */
    refundId: string | null;
    /**
     * Where the operator finds it: the refund's reference at the gateway, or
     * the payout's, such as the transfer's.
     */
    reference: string | null;
    /** The day the payout left; `null` for a refund's entries. */
    paidOn: CalendarDay | null;
    /** Who recorded the payout; `null` for a refund's entries. */
    recordedBy: string | null;
    /** What the operator noted with the payout. */
    note: string | null;
    recordedAt: Date;
}

/** A credit with what has been paid out of it, and what is still open. */
export interface SubscriberCreditStanding {
    credit: SubscriberCreditRecord;
    entries: SubscriberCreditEntryRecord[];
    /** What the subscriber is still owed of it; never below `0`. */
    open: number;
}

/**
 * Where a refund stands, as the gateway reports it: `PENDING` and `SUCCEEDED`
 * pay out, `FAILED` and `CANCELED` gave the money back to the operator.
 */
export type SubscriberRefundStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

/** A refund the operator made in the gateway, as a store reads it back. */
export interface SubscriberRefundRecord {
    id: string;
    subscriberId: string;
    /** The payment it pays back. */
    paymentId: string;
    gatewayAccount: string;
    /** The gateway's reference to the refund, unique within its account. */
    gatewayRef: string;
    amount: number;
    currency: string;
    status: SubscriberRefundStatus;
    recordedAt: Date;
    /** When it was recorded as failed or canceled; `null` while it pays out. */
    endedAt: Date | null;
}

/** A refund as the gateway reported it, to record against the payment it pays back. */
export interface ReportedSubscriberRefund {
    gatewayAccount: string;
    gatewayRef: string;
    /** The gateway's reference to the payment it pays back. */
    paymentRef: string;
    amount: number;
    currency: string;
    status: SubscriberRefundStatus;
    at: Date;
}

/** What recording a refund did. */
export type RecordedSubscriberRefund =
    /** No payment of this installation's is under its reference. */
    | { outcome: 'unknown-payment' }
    /** Recorded for the first time: the credits it pays out, and the part that matches none. */
    | {
          outcome: 'recorded';
          refund: SubscriberRefundRecord;
          parts: CreditPart[];
          unmatched: number;
      }
    /** Recorded before; it failed or was canceled now, and gave back what it paid out. */
    | { outcome: 'given-back'; refund: SubscriberRefundRecord; parts: CreditPart[] }
    /** Recorded before, and nothing it reports changes what is paid out. */
    | { outcome: 'unchanged'; refund: SubscriberRefundRecord };

/** The part of an amount that one credit takes. */
export interface CreditPart {
    creditId: string;
    amount: number;
}

/** A payout the operator made outside the gateway, to record against a credit. */
export interface NewSubscriberPayout {
    creditId: string;
    amount: number;
    /** The transfer's reference, which the operator's bank statement names. */
    reference: string;
    paidOn: CalendarDay;
    note: string | null;
    /** Who records it. */
    recordedBy: string;
    at: Date;
}

/** What recording a payout did. */
export type RecordedSubscriberPayout =
    | { outcome: 'recorded'; entry: SubscriberCreditEntryRecord; open: number }
    | { outcome: 'unknown-credit' }
    /** More than the credit still owes; nothing is written. */
    | { outcome: 'exceeds-open'; open: number };

/**
 * The manifest capability that announces the operator's view of a
 * subscriber's credits. The platform sets it where it serves the view.
 */
export const SUBSCRIBER_CREDIT_CAPABILITY = 'credits.read';

/**
 * The manifest capability that announces recording a payout the operator
 * made outside the gateway, beside the view of the credits.
 */
export const SUBSCRIBER_PAYOUT_CAPABILITY = 'credits.payout';

/** What paid a credit out, or gave it back, as the operator reads it. */
export interface AdminSubscriberCreditEntry {
    kind: SubscriberCreditEntryKind;
    amount: number;
    /** The refund's reference at the gateway, or the payout's. */
    reference: string | null;
    /** The day a payout left; `null` for a refund's entries. */
    paidOn: CalendarDay | null;
    note: string | null;
    /** ISO 8601. */
    recordedAt: string;
}

/** A credit as the operator reads it: where it comes from, what was paid out, what is open. */
export interface AdminSubscriberCredit {
    id: string;
    amount: number;
    currency: string;
    /** The payment that brought more than its invoice owed, or the invoice whose total is negative. */
    origin:
        | { kind: 'payment'; paymentRef: string; invoiceNumber: string | null }
        | { kind: 'invoice'; invoiceNumber: string | null };
    /** ISO 8601. */
    createdAt: string;
    open: number;
    entries: AdminSubscriberCreditEntry[];
}

/** A tenant's credits as the operator reads them, the oldest first. */
export interface AdminSubscriberCredits {
    credits: AdminSubscriberCredit[];
    /**
     * The installation's time zone, in which a payout's day is judged: no
     * payout lies after today there, wherever the operator sits.
     */
    timeZone: string;
}

/** A payout the operator records against a credit. */
export interface AdminSubscriberPayout {
    amount: number;
    reference: string;
    paidOn: CalendarDay;
    note?: string | null;
}
