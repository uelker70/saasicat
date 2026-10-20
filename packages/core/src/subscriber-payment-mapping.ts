// Canonical row -> record mapping for payments, credits, refunds and reversals,
// shared by both adapters for the reason `subscription-contract-mapping.ts`
// gives.
//
// These rows are money, read by releases that did not write them: a kind, a
// status or an amount of the wrong shape fails loudly here rather than
// reaching a balance as something it is not.

import { oneOf } from './closed-value.js';
import { columnAmountOf } from './column-amount.js';
import { dayOf } from './column-day.js';
import { toDecimalString } from './decimal-string.js';
import { toCents } from './money.js';
import type {
    NewSubscriberPayment,
    NewSubscriberPayout,
    ReportedSubscriberRefund,
    ReportedSubscriberReversal,
    SubscriberCreditEntryKind,
    SubscriberCreditEntryRecord,
    SubscriberCreditOrigin,
    SubscriberCreditRecord,
    SubscriberPaymentRecord,
    SubscriberRefundRecord,
    SubscriberRefundStatus,
    SubscriberReversalRecord,
} from './subscriber-payment.types.js';

const PAYMENTS = 'subscriber_payments';
const CREDITS = 'subscriber_credits';
const CREDIT_ENTRIES = 'subscriber_credit_entries';
const REFUNDS = 'subscriber_refunds';
const SETTLEMENTS = 'subscription_invoice_settlements';
const REVERSALS = 'subscriber_reversals';

/**
 * What an entry against an invoice is: a payment that settles it, a reversal
 * that opens it again by part of what a payment settled, and the same part
 * settled again where the gateway gave the reversal back; and what a
 * cancellation moved of a payment's share, out of the cancelled invoice and
 * into its replacement (`SC-PRIC-091`).
 */
export type InvoiceSettlementKind =
    'PAYMENT' | 'REVERSAL' | 'REINSTATEMENT' | 'MOVED_OUT' | 'MOVED_IN';

export const INVOICE_SETTLEMENT_KINDS: readonly InvoiceSettlementKind[] = [
    'PAYMENT',
    'REVERSAL',
    'REINSTATEMENT',
    'MOVED_OUT',
    'MOVED_IN',
];

/**
 * The settlements that add back to what an invoice owes rather than take off
 * it; an adapter that sums settlements in SQL passes it as a parameter, so the
 * sign is decided here alone.
 */
export const REOPENING_SETTLEMENT_KINDS: readonly InvoiceSettlementKind[] = [
    'REVERSAL',
    'MOVED_OUT',
];

export const SUBSCRIBER_CREDIT_ENTRY_KINDS: readonly SubscriberCreditEntryKind[] = [
    'REFUND',
    'REFUND_FAILED',
    'PAYOUT',
    'REVERSAL',
    'REVERSAL_TAKEN_BACK',
];

/** The credit entries a refund writes, which name it. */
const REFUND_ENTRY_KINDS: ReadonlySet<SubscriberCreditEntryKind> = new Set([
    'REFUND',
    'REFUND_FAILED',
]);

/** The credit entries a reversal writes, which name it. */
const REVERSAL_ENTRY_KINDS: ReadonlySet<SubscriberCreditEntryKind> = new Set([
    'REVERSAL',
    'REVERSAL_TAKEN_BACK',
]);

export const SUBSCRIBER_REFUND_STATUSES: readonly SubscriberRefundStatus[] = [
    'PENDING',
    'SUCCEEDED',
    'FAILED',
    'CANCELED',
];

/** The statuses of a refund that gave its money back to the operator. */
export const ENDED_REFUND_STATUSES: readonly SubscriberRefundStatus[] = ['FAILED', 'CANCELED'];

/** Whether a refund in `status` gave its money back. */
export function isEndedRefund(status: SubscriberRefundStatus): boolean {
    return ENDED_REFUND_STATUSES.includes(status);
}

/** A `subscriber_payments` row as either adapter reads it back. */
export interface CanonicalSubscriberPaymentRow {
    id: string;
    subscriberId: string;
    tenantId: string;
    invoiceId: string;
    collectionId: string;
    gatewayAccount: string;
    provider: string;
    gatewayRef: string;
    amount: unknown;
    currency: string;
    recordedAt: Date;
}

export function toSubscriberPaymentRecord(
    row: CanonicalSubscriberPaymentRow,
): SubscriberPaymentRecord {
    return {
        id: row.id,
        subscriberId: row.subscriberId,
        tenantId: row.tenantId,
        invoiceId: row.invoiceId,
        collectionId: row.collectionId,
        gatewayAccount: row.gatewayAccount,
        provider: row.provider,
        gatewayRef: row.gatewayRef,
        amount: columnAmountOf(row.amount, { table: PAYMENTS, column: 'amount', id: row.id }),
        currency: row.currency,
        recordedAt: row.recordedAt,
    };
}

/** The columns a payment is written with, for the subscriber its invoice names. */
export function subscriberPaymentColumns(
    payment: NewSubscriberPayment,
    invoice: { subscriberId: string; tenantId: string },
): Omit<CanonicalSubscriberPaymentRow, 'id' | 'amount'> & { amount: string } {
    return {
        subscriberId: invoice.subscriberId,
        tenantId: invoice.tenantId,
        invoiceId: payment.invoiceId,
        collectionId: payment.collectionId,
        gatewayAccount: payment.gatewayAccount,
        provider: payment.provider,
        gatewayRef: payment.gatewayRef,
        amount: toDecimalString(payment.amount),
        currency: payment.currency,
        recordedAt: payment.at,
    };
}

/** A `subscription_invoice_settlements` row, as far as what an invoice owes reads it. */
export interface CanonicalInvoiceSettlementRow {
    id: string;
    kind: string;
    amount: unknown;
}

/**
 * The amount a settlement row takes off what its invoice owes: positive for a
 * payment and a reinstatement, negative for a reversal, which opens the invoice
 * again. Its kind is checked, so a kind a later release writes stops the read
 * rather than being counted as a payment.
 */
export function settledAmountOf(row: CanonicalInvoiceSettlementRow): number {
    const kind = oneOf(INVOICE_SETTLEMENT_KINDS, row.kind, {
        table: SETTLEMENTS,
        column: 'kind',
        id: row.id,
    });
    const amount = columnAmountOf(row.amount, { table: SETTLEMENTS, column: 'amount', id: row.id });
    return REOPENING_SETTLEMENT_KINDS.includes(kind) ? -amount : amount;
}

/** A `subscriber_credits` row as either adapter reads it back. */
export interface CanonicalSubscriberCreditRow {
    id: string;
    subscriberId: string;
    tenantId: string;
    amount: unknown;
    currency: string;
    originPaymentId: string | null;
    originInvoiceId: string | null;
    originReversalId: string | null;
    originCancellationId: string | null;
    createdAt: Date;
}

/**
 * Reads a credit back. It comes from exactly one place — a payment, an invoice,
 * a reversal given back, or a payment's share a cancellation's replacement did
 * not take, which names the payment and the cancellation; a row that names
 * several or none cannot be paid out against anything.
 */
export function toSubscriberCreditRecord(
    row: CanonicalSubscriberCreditRow,
): SubscriberCreditRecord {
    return {
        id: row.id,
        subscriberId: row.subscriberId,
        tenantId: row.tenantId,
        amount: columnAmountOf(row.amount, { table: CREDITS, column: 'amount', id: row.id }),
        currency: row.currency,
        origin: creditOriginOf(row),
        createdAt: row.createdAt,
    };
}

function creditOriginOf(row: CanonicalSubscriberCreditRow): SubscriberCreditOrigin {
    const origins: SubscriberCreditOrigin[] = [];
    if (row.originCancellationId !== null) {
        // A cancellation's credit is of a payment's share: without it, it is
        // no origin, and the check below says so.
        if (row.originPaymentId !== null) {
            origins.push({
                kind: 'cancellation',
                cancellationId: row.originCancellationId,
                paymentId: row.originPaymentId,
            });
        }
    } else if (row.originPaymentId !== null) {
        origins.push({ kind: 'payment', paymentId: row.originPaymentId });
    }
    if (row.originInvoiceId !== null) {
        origins.push({ kind: 'invoice', invoiceId: row.originInvoiceId });
    }
    if (row.originReversalId !== null) {
        origins.push({ kind: 'reversal', reversalId: row.originReversalId });
    }
    const [origin] = origins;
    if (origin && origins.length === 1) return origin;
    throw new Error(
        `${CREDITS} row '${row.id}' names ${origins.length === 0 ? 'none' : String(origins.length)} ` +
            'of a payment, an invoice, a reversal and a cancellation of a payment it comes from; ' +
            'a credit comes from exactly one.',
    );
}

/** A `subscriber_credit_entries` row as either adapter reads it back. */
export interface CanonicalSubscriberCreditEntryRow {
    id: string;
    creditId: string;
    kind: string;
    amount: unknown;
    refundId: string | null;
    reversalId: string | null;
    reference: string | null;
    /** A `date` column: a `Date` from Prisma, the text from Drizzle. */
    paidOn: unknown;
    recordedBy: string | null;
    note: string | null;
    recordedAt: Date;
}

export function toSubscriberCreditEntryRecord(
    row: CanonicalSubscriberCreditEntryRow,
): SubscriberCreditEntryRecord {
    const where = (column: string) => ({ table: CREDIT_ENTRIES, column, id: row.id });
    const kind = oneOf(SUBSCRIBER_CREDIT_ENTRY_KINDS, row.kind, where('kind'));
    const paidOn =
        row.paidOn === null || row.paidOn === undefined ? null : dayOf(row.paidOn, where('paidOn'));
    if (REFUND_ENTRY_KINDS.has(kind) !== (row.refundId !== null)) {
        throw new Error(
            `${CREDIT_ENTRIES} row '${row.id}' is a ${kind} ` +
                `${row.refundId === null ? 'without' : 'with'} a refund; the entries of a refund ` +
                'name it, and no other entry does.',
        );
    }
    if (REVERSAL_ENTRY_KINDS.has(kind) !== (row.reversalId !== null)) {
        throw new Error(
            `${CREDIT_ENTRIES} row '${row.id}' is a ${kind} ` +
                `${row.reversalId === null ? 'without' : 'with'} a reversal; the entries of a ` +
                'reversal name it, and no other entry does.',
        );
    }
    return {
        id: row.id,
        creditId: row.creditId,
        kind,
        amount: columnAmountOf(row.amount, where('amount')),
        refundId: row.refundId,
        reversalId: row.reversalId,
        reference: row.reference,
        paidOn,
        recordedBy: row.recordedBy,
        note: row.note,
        recordedAt: row.recordedAt,
    };
}

/**
 * The columns of an entry a refund writes against one credit, carrying the
 * refund's own reference at the gateway, which the operator finds it under.
 */
export function refundEntryColumns(
    creditId: string,
    refund: { id: string; gatewayRef: string },
    kind: 'REFUND' | 'REFUND_FAILED',
    amount: number,
    at: Date,
): Omit<CanonicalSubscriberCreditEntryRow, 'id' | 'amount' | 'paidOn'> & {
    amount: string;
    paidOn: null;
} {
    return {
        creditId,
        kind,
        amount: toDecimalString(amount),
        refundId: refund.id,
        reversalId: null,
        reference: refund.gatewayRef,
        paidOn: null,
        recordedBy: null,
        note: null,
        recordedAt: at,
    };
}

/** The columns of the entry a payout writes against its credit. */
export function payoutEntryColumns(payout: NewSubscriberPayout): Omit<
    CanonicalSubscriberCreditEntryRow,
    'id' | 'amount' | 'paidOn'
> & {
    amount: string;
    paidOn: string;
} {
    return {
        creditId: payout.creditId,
        kind: 'PAYOUT',
        amount: toDecimalString(payout.amount),
        refundId: null,
        reversalId: null,
        reference: payout.reference,
        paidOn: payout.paidOn,
        recordedBy: payout.recordedBy,
        note: payout.note,
        recordedAt: payout.at,
    };
}

/** A `subscriber_refunds` row as either adapter reads it back. */
export interface CanonicalSubscriberRefundRow {
    id: string;
    subscriberId: string;
    paymentId: string;
    gatewayAccount: string;
    gatewayRef: string;
    amount: unknown;
    currency: string;
    status: string;
    recordedAt: Date;
    endedAt: Date | null;
}

export function toSubscriberRefundRecord(
    row: CanonicalSubscriberRefundRow,
): SubscriberRefundRecord {
    const where = (column: string) => ({ table: REFUNDS, column, id: row.id });
    const status = oneOf(SUBSCRIBER_REFUND_STATUSES, row.status, where('status'));
    if (isEndedRefund(status) !== (row.endedAt !== null)) {
        throw new Error(
            `${REFUNDS}.endedAt of ${row.id} does not fit its status ${status}: a refund that ` +
                'failed or was canceled carries when, and one that pays out does not.',
        );
    }
    return {
        id: row.id,
        subscriberId: row.subscriberId,
        paymentId: row.paymentId,
        gatewayAccount: row.gatewayAccount,
        gatewayRef: row.gatewayRef,
        amount: columnAmountOf(row.amount, where('amount')),
        currency: row.currency,
        status,
        recordedAt: row.recordedAt,
        endedAt: row.endedAt,
    };
}

/** The columns a refund is first written with, against the payment it pays back. */
export function subscriberRefundColumns(
    refund: ReportedSubscriberRefund,
    payment: { id: string; subscriberId: string },
): Omit<CanonicalSubscriberRefundRow, 'id' | 'amount'> & { amount: string } {
    return {
        subscriberId: payment.subscriberId,
        paymentId: payment.id,
        gatewayAccount: refund.gatewayAccount,
        gatewayRef: refund.gatewayRef,
        amount: toDecimalString(refund.amount),
        currency: refund.currency,
        status: refund.status,
        recordedAt: refund.at,
        endedAt: isEndedRefund(refund.status) ? refund.at : null,
    };
}

/**
 * The columns of an entry a reversal writes against one credit: what it takes
 * of it, or gives back, carrying the reversal's own reference at the gateway.
 */
export function reversalEntryColumns(
    creditId: string,
    reversal: { id: string; gatewayRef: string },
    kind: 'REVERSAL' | 'REVERSAL_TAKEN_BACK',
    amount: number,
    at: Date,
): Omit<CanonicalSubscriberCreditEntryRow, 'id' | 'amount' | 'paidOn'> & {
    amount: string;
    paidOn: null;
} {
    return {
        creditId,
        kind,
        amount: toDecimalString(amount),
        refundId: null,
        reversalId: reversal.id,
        reference: reversal.gatewayRef,
        paidOn: null,
        recordedBy: null,
        note: null,
        recordedAt: at,
    };
}

/** A `subscriber_reversals` row as either adapter reads it back. */
export interface CanonicalSubscriberReversalRow {
    id: string;
    subscriberId: string;
    tenantId: string;
    paymentId: string;
    gatewayAccount: string;
    gatewayRef: string;
    amount: unknown;
    currency: string;
    fromCredit: unknown;
    reinstated: unknown;
    reinstatedToCases: unknown;
    recordedAt: Date;
    reinstatedAt: Date | null;
}

/**
 * Reads a reversal back. What it took from the credit and what the gateway
 * gave back are parts of what it withdrew, and a give-back carries when; a row
 * that says otherwise stops the read.
 */
export function toSubscriberReversalRecord(
    row: CanonicalSubscriberReversalRow,
): SubscriberReversalRecord {
    const where = (column: string) => ({ table: REVERSALS, column, id: row.id });
    const amount = columnAmountOf(row.amount, where('amount'));
    const fromCredit = columnAmountOf(row.fromCredit, where('fromCredit'));
    const reinstated = columnAmountOf(row.reinstated, where('reinstated'));
    const toCases = columnAmountOf(row.reinstatedToCases, where('reinstatedToCases'));
    const within = (part: number) => part >= 0 && toCents(part) <= toCents(amount);
    if (!within(fromCredit) || !within(reinstated)) {
        throw new Error(
            `${REVERSALS} row '${row.id}' takes ${fromCredit} from the credit and is given back ` +
                `${reinstated} of the ${amount} it withdrew; each is a part of it.`,
        );
    }
    if (toCases < 0 || toCents(toCases) > toCents(reinstated)) {
        throw new Error(
            `${REVERSALS} row '${row.id}' covered ${toCases} of its cases with the ${reinstated} ` +
                'given back of it; what covered them is a part of that.',
        );
    }
    if (reinstated > 0 !== (row.reinstatedAt !== null)) {
        throw new Error(
            `${REVERSALS}.reinstatedAt of ${row.id} does not fit what was given back of it: ` +
                'a reversal given something back carries when, and one given nothing does not.',
        );
    }
    return {
        id: row.id,
        subscriberId: row.subscriberId,
        tenantId: row.tenantId,
        paymentId: row.paymentId,
        gatewayAccount: row.gatewayAccount,
        gatewayRef: row.gatewayRef,
        amount,
        currency: row.currency,
        fromCredit,
        reinstated,
        reinstatedToCases: toCases,
        recordedAt: row.recordedAt,
        reinstatedAt: row.reinstatedAt,
    };
}

/**
 * The columns a reversal is first written with, against the payment it takes
 * back: nothing withdrawn or given back yet, which the entries it writes next
 * raise.
 */
export function subscriberReversalColumns(
    reversal: ReportedSubscriberReversal,
    payment: { id: string; subscriberId: string; tenantId: string },
): Omit<
    CanonicalSubscriberReversalRow,
    'id' | 'amount' | 'fromCredit' | 'reinstated' | 'reinstatedToCases'
> & {
    amount: string;
    fromCredit: string;
    reinstated: string;
    reinstatedToCases: string;
} {
    return {
        subscriberId: payment.subscriberId,
        tenantId: payment.tenantId,
        paymentId: payment.id,
        gatewayAccount: reversal.gatewayAccount,
        gatewayRef: reversal.gatewayRef,
        amount: toDecimalString(0),
        currency: reversal.currency,
        fromCredit: toDecimalString(0),
        reinstated: toDecimalString(0),
        reinstatedToCases: toDecimalString(0),
        recordedAt: reversal.at,
        reinstatedAt: null,
    };
}
