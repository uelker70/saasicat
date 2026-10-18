// What the payment repository and its reversals and cases share: the reads
// and writes each of them takes its turn with, against the seven tables of
// fragment 24.

import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { SubscriberCreditRecord } from '@saasicat/core';
import {
    columnAmountOf,
    openOfCredit,
    owedByInvoice,
    settledAmountOf,
    toDecimalString,
    toSubscriberCreditEntryRecord,
    toSubscriberCreditRecord,
} from '@saasicat/core';
import type { resolveDb } from './client.js';
import { correctedStateOf, lockChainOf } from './drizzle-invoice-chain.js';
import {
    subscriberCreditEntries,
    subscriberCredits,
    subscriptionInvoiceSettlements,
    subscriptionInvoices,
} from './schema.js';

export type Db = ReturnType<typeof resolveDb>;

/** What the turn reads of an invoice. */
export interface LockedInvoice {
    id: string;
    subscriberId: string;
    tenantId: string;
    totalGross: string;
    currency: string;
    chainId: string;
}

/**
 * Takes the turn of the invoice's chain and reads what a payment against it
 * needs; throws where it does not exist.
 */
export async function lockInvoice(db: Db, invoiceId: string): Promise<LockedInvoice> {
    await lockChainOf(db, invoiceId);
    const row = await readInvoice(db, invoiceId);
    if (!row) throw new Error(`Invoice ${invoiceId} does not exist.`);
    return row;
}

export async function readInvoice(db: Db, invoiceId: string): Promise<LockedInvoice | null> {
    const [row] = await invoiceQuery(db, invoiceId);
    return row ?? null;
}

function invoiceQuery(db: Db, invoiceId: string) {
    return db
        .select({
            id: subscriptionInvoices.id,
            subscriberId: subscriptionInvoices.subscriberId,
            tenantId: subscriptionInvoices.tenantId,
            totalGross: subscriptionInvoices.totalGross,
            currency: subscriptionInvoices.currency,
            chainId: subscriptionInvoices.chainId,
        })
        .from(subscriptionInvoices)
        .where(eq(subscriptionInvoices.id, invoiceId));
}

export function grossOf(invoice: Pick<LockedInvoice, 'id' | 'totalGross'>): number {
    return columnAmountOf(invoice.totalGross, {
        table: 'subscription_invoices',
        column: 'totalGross',
        id: invoice.id,
    });
}

/**
 * What `invoice` still owes after every settlement against it: nothing where
 * it is cancelled or is a cancellation invoice (`owedByInvoice`).
 */
export async function owedIn(db: Db, invoice: LockedInvoice): Promise<number> {
    const settled = await db
        .select({
            id: subscriptionInvoiceSettlements.id,
            kind: subscriptionInvoiceSettlements.kind,
            amount: subscriptionInvoiceSettlements.amount,
        })
        .from(subscriptionInvoiceSettlements)
        .where(eq(subscriptionInvoiceSettlements.invoiceId, invoice.id));
    return owedByInvoice(
        grossOf(invoice),
        settled.map(settledAmountOf),
        await correctedStateOf(db, invoice.id),
    );
}

/** Holds every credit of the subscriber, in one order, before anything of them is read. */
export async function holdCredits(db: Db, subscriberId: string): Promise<void> {
    await db
        .select({ id: subscriberCredits.id })
        .from(subscriberCredits)
        .where(eq(subscriberCredits.subscriberId, subscriberId))
        .orderBy(asc(subscriberCredits.id))
        .for('update');
}

/** What the credit `creditId` still owes. */
export async function openOf(db: Db, creditId: string): Promise<number> {
    const [row] = await db
        .select()
        .from(subscriberCredits)
        .where(eq(subscriberCredits.id, creditId));
    if (!row) throw new Error(`Credit ${creditId} does not exist.`);
    const entries = await db
        .select()
        .from(subscriberCreditEntries)
        .where(eq(subscriberCreditEntries.creditId, creditId));
    return openOfCredit(
        toSubscriberCreditRecord(row).amount,
        entries.map(toSubscriberCreditEntryRecord),
    );
}

/** Where a credit comes from, as its columns name it. */
export type CreditOriginColumns =
    | { originPaymentId: string }
    | { originInvoiceId: string }
    | { originReversalId: string }
    | { originPaymentId: string; originCancellationId: string };

/**
 * Writes a credit for the subscriber `invoice` names. One from a payment or an
 * invoice is written once for its origin, which the database holds; one from a
 * reversal is written once per give-back, which its reversal's turn holds.
 */
export async function createCredit(
    db: Db,
    invoice: Pick<LockedInvoice, 'subscriberId' | 'tenantId' | 'currency'>,
    amount: number,
    origin: CreditOriginColumns,
    at: Date,
): Promise<SubscriberCreditRecord | null> {
    const [row] = await db
        .insert(subscriberCredits)
        .values({
            id: randomUUID(),
            subscriberId: invoice.subscriberId,
            tenantId: invoice.tenantId,
            amount: toDecimalString(amount),
            currency: invoice.currency,
            originPaymentId: 'originPaymentId' in origin ? origin.originPaymentId : null,
            originInvoiceId: 'originInvoiceId' in origin ? origin.originInvoiceId : null,
            originReversalId: 'originReversalId' in origin ? origin.originReversalId : null,
            originCancellationId:
                'originCancellationId' in origin ? origin.originCancellationId : null,
            createdAt: at,
        })
        .onConflictDoNothing()
        .returning();
    return row ? toSubscriberCreditRecord(row) : null;
}
