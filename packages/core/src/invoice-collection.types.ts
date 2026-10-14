// An invoice's collection attempts: each request the platform makes of a
// gateway to collect it, and what became of it.
//
// An invoice has at most one attempt that is open — planned, submitted and not
// answered, or a direct debit on its way — so two runs that find it open do not
// both collect it. An attempt is written as submitted in the invoice's turn
// before its request leaves, with everything the request carries, so that a
// request whose answer was lost is repeated as exactly the same request under
// the same key, and the gateway is asked what became of it first
// (`SC-PRIC-034`, `SC-PRIC-036`).
//
// An attempt after a failure, or with a payment method that replaced the one
// the invoice named, is planned first, for a day: a card's for the day it is
// charged, a direct debit's for the day its own announcement names
// (`SC-PRIC-028`, `SC-PRIC-080`, `SC-PRIC-082`).

import type {
    CollectionFailureReason,
    CollectionOutcome,
    PaymentMethodType,
} from './payment-gateway.types.js';
import type { CalendarDay } from './zoned-day.js';

/**
 * Where an attempt stands: `SCHEDULED` while it is planned for a day and has
 * not left; `SUBMITTED` once it is written as sent, before its request leaves,
 * and until an answer is recorded; `PENDING` while a direct debit is on its
 * way; `SUCCEEDED` and `FAILED` once it is settled; `WITHDRAWN` where a planned
 * one will not be made, because the payment method it was planned with is no
 * longer in use.
 */
export type InvoiceCollectionStatus =
    'SCHEDULED' | 'SUBMITTED' | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'WITHDRAWN';

/** An attempt as a store reads it back. */
export interface InvoiceCollectionRecord {
    id: string;
    invoiceId: string;
    /** From 1, per invoice. */
    attempt: number;
    /** `collectionAttemptKey(invoiceId, attempt)`: the key every request of this attempt carries. */
    attemptKey: string;
    /** The account in `config/saas.yaml#payments.accounts` the request went to. */
    gatewayAccount: string;
    /** The subscriber's payment method it charges. */
    paymentMethodId: string;
    paymentMethodType: PaymentMethodType;
    customerRef: string;
    paymentMethodRef: string;
    /** The invoice's number, as the request names it. */
    invoiceNumber: string;
    /** The invoice's gross amount, of `currency`; the request carries it in cents. */
    amount: number;
    currency: string;
    status: InvoiceCollectionStatus;
    /** The gateway's reference to what it created; `null` until an answer names one. */
    paymentRef: string | null;
    /** Why it failed; `null` unless it did. */
    failureReason: CollectionFailureReason | null;
    /** The gateway's own code for the failure. */
    failureCode: string | null;
    /**
     * When it was written as sent and its request first left; `null` while it
     * is planned, and for a planned one withdrawn before it left.
     */
    submittedAt: Date | null;
    /**
     * When a run last took it on — to send it, to send it again, or to ask
     * the gateway about it. Another run leaves it alone until this is old
     * enough (`INVOICE_COLLECTION_LEASE_MS`, `INVOICE_COLLECTION_ASK_EVERY_MS`).
     * `null` where `submittedAt` is.
     */
    heldAt: Date | null;
    /** When it was settled, or withdrawn; `null` while it is not. */
    resolvedAt: Date | null;
    /**
     * The day a planned attempt is collected from; `null` for one written as
     * sent from the start, which the invoice's own date governs. A direct
     * debit's is the earliest day until it is announced, and the day its
     * announcement names after.
     */
    collectOn: CalendarDay | null;
    /** When a planned direct debit's announcement reached the subscriber; `null` until it did. */
    announcedAt: Date | null;
    /**
     * When what follows a failure was decided — the subscriber's notice
     * recorded, and the next attempt planned where one is made; `null` until it
     * was, and for an attempt that did not fail.
     */
    followedUpAt: Date | null;
}

/** An attempt that has been sent: its request carries a moment, and a run holds it. */
export type SubmittedInvoiceCollection = InvoiceCollectionRecord & {
    submittedAt: Date;
    heldAt: Date;
};

/**
 * `attempt` as one that has been sent. Throws for one that has not left, which
 * a run never meets where it reads an attempt it sent or holds.
 */
export function sentCollectionOf(attempt: InvoiceCollectionRecord): SubmittedInvoiceCollection {
    const { submittedAt, heldAt } = attempt;
    if (submittedAt === null || heldAt === null) {
        throw new Error(`Collection attempt ${attempt.attemptKey} has not been sent.`);
    }
    return { ...attempt, submittedAt, heldAt };
}

/** An attempt to start: what its request carries, and the moment it is taken on. */
export interface NewInvoiceCollection {
    invoiceId: string;
    gatewayAccount: string;
    paymentMethodId: string;
    paymentMethodType: PaymentMethodType;
    customerRef: string;
    paymentMethodRef: string;
    invoiceNumber: string;
    amount: number;
    currency: string;
    /** Written as both `submittedAt` and `heldAt`. */
    at: Date;
}

/** An attempt to plan for `collectOn`: what its request will carry. */
export interface PlannedInvoiceCollection {
    invoiceId: string;
    /**
     * The number of the invoice's last attempt the plan follows — `0` where it
     * has none. A run decides what follows from the attempts it read; one that
     * read them before another run added an attempt plans nothing.
     */
    after: number;
    gatewayAccount: string;
    paymentMethodId: string;
    paymentMethodType: PaymentMethodType;
    customerRef: string;
    paymentMethodRef: string;
    invoiceNumber: string;
    amount: number;
    currency: string;
    /** The day it is collected from; for a direct debit, the earliest such day. */
    collectOn: CalendarDay;
}

/**
 * How long a run's hold on an attempt lasts. Longer than a request may take,
 * so a run does not ask the gateway about, or send again, a request another
 * run is still waiting for.
 */
export const INVOICE_COLLECTION_LEASE_MS = 15 * 60_000;

/**
 * How often a direct debit on its way is asked about. Most are settled within
 * six business days, and the gateway's own report of it is an event of its
 * own; asking is what finds the outcome where no report arrives.
 */
export const INVOICE_COLLECTION_ASK_EVERY_MS = 60 * 60_000;

/**
 * The key every request of an attempt carries, and that the gateway keeps
 * with what it creates: `saasicat:collect:<invoice>:<attempt>`. The same for
 * one attempt however often its request is repeated, and another for the next
 * attempt of the same invoice.
 */
export function collectionAttemptKey(invoiceId: string, attempt: number): string {
    if (!Number.isInteger(attempt) || attempt < 1) {
        throw new RangeError(`A collection attempt counts from 1; ${attempt} is not one.`);
    }
    return `saasicat:collect:${invoiceId}:${attempt}`;
}

/** The status an outcome settles an attempt in. */
export function collectionStatusOf(outcome: CollectionOutcome): InvoiceCollectionStatus {
    if (outcome.status === 'succeeded') return 'SUCCEEDED';
    if (outcome.status === 'pending') return 'PENDING';
    return 'FAILED';
}
