// What the payment repository and its reversals and cases share: the narrow
// view of the client over the seven tables of fragment 24, and the reads and
// writes each of them takes its turn with.

import { randomUUID } from 'node:crypto';
import type {
    CanonicalInvoiceSettlementRow,
    CanonicalReconciliationCaseRow,
    CanonicalSubscriberCreditEntryRow,
    CanonicalSubscriberCreditRow,
    CanonicalSubscriberPaymentRow,
    CanonicalSubscriberRefundRow,
    CanonicalSubscriberReversalRow,
    SubscriberCreditRecord,
} from '@saasicat/core';
import {
    columnAmountOf,
    openOfCredit,
    owedOn,
    settledAmountOf,
    toDecimalString,
    toSubscriberCreditEntryRecord,
    toSubscriberCreditRecord,
} from '@saasicat/core';
import type { PrismaModelDelegateLike } from './prisma-client-token.js';

/** A settlement as the turn reads it: what it is, for which invoice and payment, and how much. */
export interface SettlementRow extends CanonicalInvoiceSettlementRow {
    invoiceId: string;
    paymentId: string;
    reversalId: string | null;
    recordedAt: Date;
}

/** Narrow view of the client and of a transaction client, which carry the same delegates. */
export interface PaymentPrisma {
    subscriberPayment: PrismaModelDelegateLike<CanonicalSubscriberPaymentRow>;
    subscriptionInvoiceSettlement: PrismaModelDelegateLike<SettlementRow>;
    subscriberCredit: PrismaModelDelegateLike<CanonicalSubscriberCreditRow>;
    subscriberCreditEntry: PrismaModelDelegateLike<CanonicalSubscriberCreditEntryRow>;
    subscriberRefund: PrismaModelDelegateLike<CanonicalSubscriberRefundRow>;
    subscriberReversal: PrismaModelDelegateLike<CanonicalSubscriberReversalRow>;
    subscriberReconciliationCase: PrismaModelDelegateLike<CanonicalReconciliationCaseRow>;
    subscriptionInvoice: PrismaModelDelegateLike<LockedInvoice>;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/** What the invoice's turn reads of it. */
export interface LockedInvoice {
    id: string;
    subscriberId: string;
    tenantId: string;
    totalGross: unknown;
    currency: string;
}

/** Takes the invoice's turn and reads what a payment against it needs; throws where it does not exist. */
export async function lockInvoice(db: PaymentPrisma, invoiceId: string): Promise<LockedInvoice> {
    await db.$queryRaw`
        SELECT "id" FROM "subscription_invoices" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const row = await readInvoice(db, invoiceId);
    if (!row) throw new Error(`Invoice ${invoiceId} does not exist.`);
    return row;
}

export function readInvoice(db: PaymentPrisma, invoiceId: string): Promise<LockedInvoice | null> {
    return db.subscriptionInvoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, subscriberId: true, tenantId: true, totalGross: true, currency: true },
    });
}

export function grossOf(invoice: LockedInvoice): number {
    return columnAmountOf(invoice.totalGross, {
        table: 'subscription_invoices',
        column: 'totalGross',
        id: invoice.id,
    });
}

/** What `invoice` owes after every settlement against it. */
export async function owedOf(db: PaymentPrisma, invoice: LockedInvoice): Promise<number> {
    const settled = await db.subscriptionInvoiceSettlement.findMany({
        where: { invoiceId: invoice.id },
        select: { id: true, kind: true, amount: true },
    });
    return owedOn(grossOf(invoice), settled.map(settledAmountOf));
}

/** Holds every credit of the subscriber, in one order, before anything of them is read. */
export async function holdCredits(db: PaymentPrisma, subscriberId: string): Promise<void> {
    await db.$queryRaw`
        SELECT "id" FROM "subscriber_credits"
         WHERE "subscriberId" = ${subscriberId}
         ORDER BY "id"
           FOR UPDATE`;
}

/** What the credit `creditId` still owes. */
export async function openOf(db: PaymentPrisma, creditId: string): Promise<number> {
    const row = await db.subscriberCredit.findUnique({ where: { id: creditId } });
    if (!row) throw new Error(`Credit ${creditId} does not exist.`);
    const credit = toSubscriberCreditRecord(row);
    const entries = await db.subscriberCreditEntry.findMany({ where: { creditId } });
    return openOfCredit(credit.amount, entries.map(toSubscriberCreditEntryRecord));
}

/** Where a credit comes from, as its columns name it. */
export type CreditOriginColumns =
    { originPaymentId: string } | { originInvoiceId: string } | { originReversalId: string };

/**
 * Writes a credit for the subscriber `invoice` names. One from a payment or an
 * invoice is written once for its origin, which the database holds; one from a
 * reversal is written once per give-back, which its reversal's turn holds.
 */
export async function createCredit(
    db: PaymentPrisma,
    invoice: Pick<LockedInvoice, 'subscriberId' | 'tenantId' | 'currency'>,
    amount: number,
    origin: CreditOriginColumns,
    at: Date,
): Promise<SubscriberCreditRecord | null> {
    const [row] = await db.subscriberCredit.createManyAndReturn({
        data: [
            {
                id: randomUUID(),
                subscriberId: invoice.subscriberId,
                tenantId: invoice.tenantId,
                amount: toDecimalString(amount),
                currency: invoice.currency,
                originPaymentId: 'originPaymentId' in origin ? origin.originPaymentId : null,
                originInvoiceId: 'originInvoiceId' in origin ? origin.originInvoiceId : null,
                originReversalId: 'originReversalId' in origin ? origin.originReversalId : null,
                createdAt: at,
            },
        ],
        skipDuplicates: true,
    });
    return row ? toSubscriberCreditRecord(row) : null;
}
