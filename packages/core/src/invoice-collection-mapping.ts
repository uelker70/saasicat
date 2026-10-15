// Canonical row -> record mapping for an invoice's collection attempts, shared
// by both adapters for the reason `subscription-contract-mapping.ts` gives.
//
// An attempt is what money moved under, read by releases that did not write
// it: a status, a reason or an amount of the wrong shape fails loudly here
// rather than reaching a collection as something it is not.

import { oneOf } from './closed-value.js';
import { dayOf } from './column-day.js';
import type {
    InvoiceCollectionRecord,
    InvoiceCollectionStatus,
    NewInvoiceCollection,
    PlannedInvoiceCollection,
} from './invoice-collection.types.js';
import { collectionAttemptKey, collectionStatusOf } from './invoice-collection.types.js';
import type { CollectionFailureReason, CollectionOutcome } from './payment-gateway.types.js';
import { PAYMENT_METHOD_TYPES } from './subscriber-payment-method-mapping.js';

const TABLE = 'subscription_invoice_collections';

/** Every status an attempt can stand in. */
export const INVOICE_COLLECTION_STATUSES: readonly InvoiceCollectionStatus[] = [
    'SCHEDULED',
    'SUBMITTED',
    'PENDING',
    'SUCCEEDED',
    'FAILED',
    'WITHDRAWN',
    'REVERSED',
];

/**
 * The statuses of an attempt that has been sent and is not settled: the
 * gateway is asked what became of it.
 */
export const UNSETTLED_COLLECTION_STATUSES: readonly InvoiceCollectionStatus[] = [
    'SUBMITTED',
    'PENDING',
];

/**
 * The statuses that keep an invoice from another attempt: one open — planned,
 * or sent and not settled — or one that succeeded. An invoice has one at most,
 * which `sql/constraints.postgres.sql` holds as well.
 */
export const BLOCKING_COLLECTION_STATUSES: readonly InvoiceCollectionStatus[] = [
    'SCHEDULED',
    ...UNSETTLED_COLLECTION_STATUSES,
    'SUCCEEDED',
];

/** What the turn reads of an invoice's attempts before it writes the next one. */
export interface EarlierCollection {
    attempt: number;
    status: string;
}

/** The number of the last of `earlier`, `0` for none. */
export function lastCollectionOf(earlier: readonly EarlierCollection[]): number {
    return earlier.reduce((last, row) => Math.max(last, row.attempt), 0);
}

/**
 * Whether the invoice's first attempt is refused: it has one already. Every
 * later attempt is planned, so a run that found the invoice due before another
 * run's attempt failed does not charge it again at once.
 */
export function refusesFirstAttempt(earlier: readonly EarlierCollection[]): boolean {
    return earlier.length > 0;
}

/**
 * Whether a planned attempt that follows attempt `after` is refused: one of the
 * invoice's attempts is open or succeeded, or another came after `after`.
 */
export function refusesPlannedAttempt(
    earlier: readonly EarlierCollection[],
    after: number,
): boolean {
    return earlier.some((row) => BLOCKING.has(row.status)) || lastCollectionOf(earlier) !== after;
}

const BLOCKING: ReadonlySet<string> = new Set(BLOCKING_COLLECTION_STATUSES);

/** The statuses of an attempt that has not left, and has no moment it was sent at. */
const NOT_SENT: ReadonlySet<InvoiceCollectionStatus> = new Set(['SCHEDULED', 'WITHDRAWN']);

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
    submittedAt: Date | null;
    heldAt: Date | null;
    resolvedAt: Date | null;
    /** A `date` column: a `Date` from Prisma, the text from Drizzle. */
    collectOn: unknown;
    announcedAt: Date | null;
    followedUpAt: Date | null;
}

/**
 * Reads an attempt row back as a record. An attempt that left carries the
 * moment it left and was held at, and one that did not carries neither; a
 * planned one carries its day. A row that breaks this is not one a run may act
 * on: a planned attempt without a day would never be collected, and a sent one
 * without a moment could not be asked about.
 */
export function toInvoiceCollectionRecord(
    row: CanonicalInvoiceCollectionRow,
): InvoiceCollectionRecord {
    const where = (column: string) => ({ table: TABLE, column, id: row.id });
    const amount = Number(
        // oxlint-disable-next-line typescript/no-base-to-string -- Prisma hands a Decimal, whose text is the number; any other object becomes NaN and is refused below
        row.amount === null || row.amount === undefined ? NaN : String(row.amount),
    );
    if (!Number.isFinite(amount)) {
        throw new Error(`${TABLE}.amount of ${row.id} is not an amount.`);
    }
    const status = oneOf(INVOICE_COLLECTION_STATUSES, row.status, where('status'));
    const sent = !NOT_SENT.has(status);
    if (sent !== (row.submittedAt !== null) || sent !== (row.heldAt !== null)) {
        throw new Error(
            `${TABLE}.submittedAt and heldAt of ${row.id} do not fit its status ${status}: ` +
                'an attempt that left carries both, and one that did not carries neither.',
        );
    }
    const collectOn =
        row.collectOn === null || row.collectOn === undefined
            ? null
            : dayOf(row.collectOn, where('collectOn'));
    if (status === 'SCHEDULED' && collectOn === null) {
        throw new Error(`${TABLE}.collectOn of ${row.id} is missing from a planned attempt.`);
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
        status,
        paymentRef: row.paymentRef,
        failureReason:
            row.failureReason === null
                ? null
                : oneOf(COLLECTION_FAILURE_REASONS, row.failureReason, where('failureReason')),
        failureCode: row.failureCode,
        submittedAt: row.submittedAt,
        heldAt: row.heldAt,
        resolvedAt: row.resolvedAt,
        collectOn,
        announcedAt: row.announcedAt,
        followedUpAt: row.followedUpAt,
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
    submittedAt: Date | null;
    heldAt: Date | null;
    /** The day of a planned attempt; `null` for one written as sent. */
    collectOn: string | null;
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
        collectOn: null,
    };
}

/** The columns of `plan`, numbered `number`, written as planned for its day. */
export function plannedCollectionColumns(
    plan: PlannedInvoiceCollection,
    number: number,
): InvoiceCollectionColumns {
    return {
        invoiceId: plan.invoiceId,
        attempt: number,
        attemptKey: collectionAttemptKey(plan.invoiceId, number),
        gatewayAccount: plan.gatewayAccount,
        paymentMethodId: plan.paymentMethodId,
        paymentMethodType: plan.paymentMethodType,
        customerRef: plan.customerRef,
        paymentMethodRef: plan.paymentMethodRef,
        invoiceNumber: plan.invoiceNumber,
        amount: plan.amount.toFixed(2),
        currency: plan.currency,
        status: 'SCHEDULED',
        submittedAt: null,
        heldAt: null,
        collectOn: plan.collectOn,
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
