// Canonical row -> record mapping for payments, credits and refunds, shared by
// both adapters for the reason `subscription-contract-mapping.ts` gives.
//
// These rows are money, read by releases that did not write them: a kind, a
// status or an amount of the wrong shape fails loudly here rather than
// reaching a balance as something it is not.

import { oneOf } from './closed-value.js';
import { columnAmountOf } from './column-amount.js';
import { dayOf } from './column-day.js';
import { toDecimalString } from './decimal-string.js';
import type {
    NewSubscriberPayment,
    NewSubscriberPayout,
    ReportedSubscriberRefund,
    SubscriberCreditEntryKind,
    SubscriberCreditEntryRecord,
    SubscriberCreditOrigin,
    SubscriberCreditRecord,
    SubscriberPaymentRecord,
    SubscriberRefundRecord,
    SubscriberRefundStatus,
} from './subscriber-payment.types.js';

const PAYMENTS = 'subscriber_payments';
const CREDITS = 'subscriber_credits';
const CREDIT_ENTRIES = 'subscriber_credit_entries';
const REFUNDS = 'subscriber_refunds';
const SETTLEMENTS = 'subscription_invoice_settlements';

/** What an entry against an invoice is: so far only a payment that settles it. */
export type InvoiceSettlementKind = 'PAYMENT';

export const INVOICE_SETTLEMENT_KINDS: readonly InvoiceSettlementKind[] = ['PAYMENT'];

export const SUBSCRIBER_CREDIT_ENTRY_KINDS: readonly SubscriberCreditEntryKind[] = [
    'REFUND',
    'REFUND_FAILED',
    'PAYOUT',
];

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
 * The amount a settlement row takes off what its invoice owes. Its kind is
 * checked, so a kind a later release writes stops the read rather than being
 * counted as a payment.
 */
export function settledAmountOf(row: CanonicalInvoiceSettlementRow): number {
    oneOf(INVOICE_SETTLEMENT_KINDS, row.kind, { table: SETTLEMENTS, column: 'kind', id: row.id });
    return columnAmountOf(row.amount, { table: SETTLEMENTS, column: 'amount', id: row.id });
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
    createdAt: Date;
}

/**
 * Reads a credit back. It comes from exactly one place — a payment or an
 * invoice — which the database holds as well; a row that names both or neither
 * cannot be paid out against anything.
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
    const { originPaymentId, originInvoiceId } = row;
    if (originPaymentId !== null && originInvoiceId === null) {
        return { kind: 'payment', paymentId: originPaymentId };
    }
    if (originInvoiceId !== null && originPaymentId === null) {
        return { kind: 'invoice', invoiceId: originInvoiceId };
    }
    throw new Error(
        `${CREDITS} row '${row.id}' names ${originPaymentId === null ? 'neither' : 'both'} ` +
            'a payment and an invoice it comes from; a credit comes from exactly one.',
    );
}

/** A `subscriber_credit_entries` row as either adapter reads it back. */
export interface CanonicalSubscriberCreditEntryRow {
    id: string;
    creditId: string;
    kind: string;
    amount: unknown;
    refundId: string | null;
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
    if ((kind === 'PAYOUT') !== (row.refundId === null)) {
        throw new Error(
            `${CREDIT_ENTRIES} row '${row.id}' is a ${kind} ` +
                `${row.refundId === null ? 'without' : 'with'} a refund; a payout names none, ` +
                'and the entries of a refund name it.',
        );
    }
    return {
        id: row.id,
        creditId: row.creditId,
        kind,
        amount: columnAmountOf(row.amount, where('amount')),
        refundId: row.refundId,
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
