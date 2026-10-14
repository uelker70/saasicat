// Canonical row -> record mapping for an invoice's collection attempts, shared
// by both adapters for the reason `subscription-contract-mapping.ts` gives.
//
// An attempt is what money moved under, read by releases that did not write
// it: a status, a reason or an amount of the wrong shape fails loudly here
// rather than reaching a collection as something it is not.

import { oneOf } from './closed-value.js';
import type {
    InvoiceCollectionRecord,
    InvoiceCollectionStatus,
    NewInvoiceCollection,
} from './invoice-collection.types.js';
import { collectionAttemptKey, collectionStatusOf } from './invoice-collection.types.js';
import type { CollectionFailureReason, CollectionOutcome } from './payment-gateway.types.js';
import { PAYMENT_METHOD_TYPES } from './subscriber-payment-method-mapping.js';

const TABLE = 'subscription_invoice_collections';

/** Every status an attempt can stand in. */
export const INVOICE_COLLECTION_STATUSES: readonly InvoiceCollectionStatus[] = [
    'SUBMITTED',
    'PENDING',
    'SUCCEEDED',
    'FAILED',
];

/** The statuses of an attempt that is not settled, of which an invoice has one at most. */
export const UNSETTLED_COLLECTION_STATUSES: readonly InvoiceCollectionStatus[] = [
    'SUBMITTED',
    'PENDING',
];

/** Every reason a collection can fail for. */
export const COLLECTION_FAILURE_REASONS: readonly CollectionFailureReason[] = [
    'insufficient-funds',
    'declined',
    'authentication-required',
    'payment-method-unusable',
    'mandate-invalid',
    'other',
];

/**
 * A `subscription_invoice_collections` row as either adapter reads it back.
 * `amount` is `unknown` because a Prisma row carries a `Decimal` where a
 * Drizzle row carries a numeric string.
 */
export interface CanonicalInvoiceCollectionRow {
    id: string;
    invoiceId: string;
    attempt: number;
    attemptKey: string;
    gatewayAccount: string;
    paymentMethodId: string;
    paymentMethodType: string;
    customerRef: string;
    paymentMethodRef: string;
    invoiceNumber: string;
    amount: unknown;
    currency: string;
    status: string;
    paymentRef: string | null;
    failureReason: string | null;
    failureCode: string | null;
    submittedAt: Date;
    heldAt: Date;
    resolvedAt: Date | null;
}

/** Reads an attempt row back as a record. */
export function toInvoiceCollectionRecord(
    row: CanonicalInvoiceCollectionRow,
): InvoiceCollectionRecord {
    const where = (column: string) => ({ table: TABLE, column, id: row.id });
    const amount = Number(
        row.amount === null || row.amount === undefined ? NaN : String(row.amount),
    );
    if (!Number.isFinite(amount)) {
        throw new Error(`${TABLE}.amount of ${row.id} is not an amount.`);
    }
    return {
        id: row.id,
        invoiceId: row.invoiceId,
        attempt: row.attempt,
        attemptKey: row.attemptKey,
        gatewayAccount: row.gatewayAccount,
        paymentMethodId: row.paymentMethodId,
        paymentMethodType: oneOf(
            PAYMENT_METHOD_TYPES,
            row.paymentMethodType,
            where('paymentMethodType'),
        ),
        customerRef: row.customerRef,
        paymentMethodRef: row.paymentMethodRef,
        invoiceNumber: row.invoiceNumber,
        amount,
        currency: row.currency,
        status: oneOf(INVOICE_COLLECTION_STATUSES, row.status, where('status')),
        paymentRef: row.paymentRef,
        failureReason:
            row.failureReason === null
                ? null
                : oneOf(COLLECTION_FAILURE_REASONS, row.failureReason, where('failureReason')),
        failureCode: row.failureCode,
        submittedAt: row.submittedAt,
        heldAt: row.heldAt,
        resolvedAt: row.resolvedAt,
    };
}

/** The columns an attempt is started with, numbered `attempt`. */
export interface InvoiceCollectionColumns {
    invoiceId: string;
    attempt: number;
    attemptKey: string;
    gatewayAccount: string;
    paymentMethodId: string;
    paymentMethodType: string;
    customerRef: string;
    paymentMethodRef: string;
    invoiceNumber: string;
    /** A decimal string of two places, as an invoice's amounts are written. */
    amount: string;
    currency: string;
    status: InvoiceCollectionStatus;
    submittedAt: Date;
    heldAt: Date;
}

/** The columns of `attempt`, numbered `number`, written as submitted at its `at`. */
export function invoiceCollectionColumns(
    attempt: NewInvoiceCollection,
    number: number,
): InvoiceCollectionColumns {
    return {
        invoiceId: attempt.invoiceId,
        attempt: number,
        attemptKey: collectionAttemptKey(attempt.invoiceId, number),
        gatewayAccount: attempt.gatewayAccount,
        paymentMethodId: attempt.paymentMethodId,
        paymentMethodType: attempt.paymentMethodType,
        customerRef: attempt.customerRef,
        paymentMethodRef: attempt.paymentMethodRef,
        invoiceNumber: attempt.invoiceNumber,
        amount: attempt.amount.toFixed(2),
        currency: attempt.currency,
        status: 'SUBMITTED',
        submittedAt: attempt.at,
        heldAt: attempt.at,
    };
}

/** The columns an outcome sets: `PENDING` leaves the attempt open, the others settle it at `at`. */
export function collectionOutcomeColumns(
    outcome: CollectionOutcome,
    at: Date,
): {
    status: InvoiceCollectionStatus;
    paymentRef: string | null;
    failureReason: CollectionFailureReason | null;
    failureCode: string | null;
    resolvedAt: Date | null;
} {
    const failed = outcome.status === 'failed' ? outcome : null;
    return {
        status: collectionStatusOf(outcome),
        paymentRef: outcome.paymentRef,
        failureReason: failed?.reason ?? null,
        failureCode: failed?.gatewayCode ?? null,
        resolvedAt: outcome.status === 'pending' ? null : at,
    };
}
