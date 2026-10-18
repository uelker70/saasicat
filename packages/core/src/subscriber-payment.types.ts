// What money moved between a subscriber and the operator, as the gateway
// reports it: a payment collected for an invoice and what it settles there, a
// credit where the subscriber is owed money, what pays a credit out — a refund
// the operator makes in the gateway, or a payout outside it —, and what the
// gateway takes back from the operator — a returned direct debit or a
// chargeback — and gives back again (`SC-PRIC-029`, `SC-PRIC-083`,
// `SC-PRIC-084`, `SC-PRIC-086`).
//
// Nothing here is edited once written. A payment is recorded once, by its
// gateway account and the gateway's reference, however often and in whatever
// order it is reported; what it settles is an entry of its own, so a reversal
// or a cancellation's replacement later adds an entry rather than changing
// one. A credit is never offset against a later invoice: the operator pays it
// out, and SaaSiCat initiates nothing (ADR 0012, `SC-PRIC-076`).

import type { SubscriberReconciliationCaseRecord } from './subscriber-reconciliation.types.js';
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
    | { kind: 'invoice'; invoiceId: string }
    /**
     * What a reversal the gateway gave back brought beyond what the invoices
     * it had opened again still owed: the subscriber paid them meanwhile.
     */
    | { kind: 'reversal'; reversalId: string }
    /**
     * What a payment settled of an invoice that was cancelled, which the
     * replacement did not take (`SC-PRIC-025`); a reversal of the payment takes
     * it back as the payment's own (`SC-PRIC-084`).
     */
    | { kind: 'cancellation'; cancellationId: string; paymentId: string };

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
 * against it, the same refund given back because it failed, a payout the
 * operator recorded, a reversal that took the credit's open part back to the
 * subscriber's bank, and the same reversal given back by the gateway.
 */
export type SubscriberCreditEntryKind =
    'REFUND' | 'REFUND_FAILED' | 'PAYOUT' | 'REVERSAL' | 'REVERSAL_TAKEN_BACK';

/** One change to what a credit has paid out, as a store reads it back. */
export interface SubscriberCreditEntryRecord {
    id: string;
    creditId: string;
    kind: SubscriberCreditEntryKind;
    /**
     * Positive. A `REFUND`, a `PAYOUT` and a `REVERSAL` pay this much of the
     * credit out; a `REFUND_FAILED` and a `REVERSAL_TAKEN_BACK` give it back.
     */
    amount: number;
    /** The refund, for a `REFUND` and its `REFUND_FAILED`; `null` otherwise. */
    refundId: string | null;
    /** The reversal, for a `REVERSAL` and its `REVERSAL_TAKEN_BACK`; `null` otherwise. */
    reversalId: string | null;
    /**
     * Where the operator finds it: the refund's or the reversal's reference
     * at the gateway, or the payout's, such as the transfer's.
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
    /**
     * Recorded for the first time: the credits it pays out, and the part that
     * matches none, which is a case to reconcile.
     */
    | {
          outcome: 'recorded';
          refund: SubscriberRefundRecord;
          parts: CreditPart[];
          unmatched: number;
          case: SubscriberReconciliationCaseRecord | null;
      }
    /**
     * Recorded before; it failed or was canceled now, gave back what it paid
     * out, and closed the case its unmatched part had opened.
     */
    | {
          outcome: 'given-back';
          refund: SubscriberRefundRecord;
          parts: CreditPart[];
          closedCases: SubscriberReconciliationCaseRecord[];
      }
    /** Recorded before, and nothing it reports changes what is paid out. */
    | { outcome: 'unchanged'; refund: SubscriberRefundRecord };

/** The part of an amount that one credit takes. */
export interface CreditPart {
    creditId: string;
    amount: number;
}

/** The part of an amount that one invoice takes. */
export interface InvoicePart {
    invoiceId: string;
    amount: number;
}

/**
 * Money the gateway took back from the operator for a payment — a returned
 * direct debit or a chargeback — as a store reads it back. What it withdrew and
 * what the gateway gave back of it only grow; each change is recorded as the
 * entries it adds.
 */
export interface SubscriberReversalRecord {
    id: string;
    subscriberId: string;
    /** The tenant the payment's invoice was for, as a trace. */
    tenantId: string;
    /** The payment it takes back. */
    paymentId: string;
    gatewayAccount: string;
    /** The gateway's reference to it, such as a dispute's, unique within its account. */
    gatewayRef: string;
    /** What the gateway withdrew, positive, of `currency`. */
    amount: number;
    currency: string;
    /**
     * The part of `amount` taken from the credit the payment left — its open
     * part and the part already paid out alike —, so a later reversal of the
     * same payment takes from what of that credit is left.
     */
    fromCredit: number;
    /** What the gateway gave back of `amount`, a dispute won; `0` until it gives anything back. */
    reinstated: number;
    recordedAt: Date;
    /** When the gateway last gave something back; `null` until it does. */
    reinstatedAt: Date | null;
}

/**
 * A reversal as the gateway reports it, as it stands when it is reported: what
 * it withdrew and what it gave back so far, each in total.
 */
export interface ReportedSubscriberReversal {
    gatewayAccount: string;
    gatewayRef: string;
    /** The gateway's reference to the payment it takes back. */
    paymentRef: string;
    currency: string;
    withdrawn: number;
    reinstated: number;
    at: Date;
}

/** What withdrawing part of a reversal's amount took back. */
export interface ReversalWithdrawal {
    /**
     * What it took of the credits the payment left that was still open: what it
     * brought beyond its invoice, then its share of a cancelled invoice the
     * replacement did not take.
     */
    credits: CreditPart[];
    /**
     * What it took instead of opening an invoice again, of the credits other
     * payments collected for that invoice left, the oldest first.
     */
    covering: CreditPart[];
    /** The invoices it opened again, each by how much, the oldest first. */
    invoices: InvoicePart[];
    /**
     * The covers the payment's own credit gave other reversals of its invoice,
     * lifted before anything else: each of those reversals now opens the
     * invoice by what it took (`SC-PRIC-088`).
     */
    uncovered: LiftedCover[];
    /**
     * What met the part of that credit already paid out, or went beyond what
     * the payment brought: a case to reconcile.
     */
    unmatched: number;
    case: SubscriberReconciliationCaseRecord | null;
}

/** A cover lifted: the reversal it was given to, that reversal's payment, and what it opens now. */
export interface LiftedCover {
    reversalId: string;
    paymentId: string;
    invoiceId: string;
    amount: number;
}

/** What giving back part of a reversal's amount took back in turn. */
export interface ReversalReinstatement {
    /** The cases of the reversal it covered, closed. */
    closedCases: SubscriberReconciliationCaseRecord[];
    /** What it gave back to the credits the reversal had taken from. */
    credits: CreditPart[];
    /** The invoices it settled again, each by how much. */
    invoices: InvoicePart[];
    /** What the invoices no longer owed, as a credit; `null` where they owed all of it. */
    credit: SubscriberCreditRecord | null;
}

/** What recording a reversal did. */
export type RecordedSubscriberReversal =
    /** No payment of this installation's is under its reference. */
    | { outcome: 'unknown-payment' }
    /**
     * Recorded, or recorded before and changed now: what the newly withdrawn
     * part took back, and what the newly given back part gave back, each
     * `null` where nothing of it changed.
     */
    | {
          outcome: 'recorded';
          reversal: SubscriberReversalRecord;
          withdrawal: ReversalWithdrawal | null;
          reinstatement: ReversalReinstatement | null;
      }
    /** Recorded before, and nothing it reports changes it. */
    | { outcome: 'unchanged'; reversal: SubscriberReversalRecord };

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
    /** The refund's or the reversal's reference at the gateway, or the payout's. */
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
    /**
     * The payment that brought more than its invoice owed, the invoice whose
     * total is negative, the reversal the gateway gave back, or the payment
     * whose share of a cancelled invoice the replacement did not take — with
     * the cancelled invoice's number.
     */
    origin:
        | { kind: 'payment'; paymentRef: string; invoiceNumber: string | null }
        | { kind: 'invoice'; invoiceNumber: string | null }
        | { kind: 'reversal'; reversalRef: string; invoiceNumber: string | null }
        | { kind: 'cancellation'; paymentRef: string; invoiceNumber: string | null };
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
