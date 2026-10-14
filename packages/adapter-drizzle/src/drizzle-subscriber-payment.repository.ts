import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, lt, notExists, sql } from 'drizzle-orm';
import type {
    CreditPart,
    NewSubscriberPayment,
    NewSubscriberPayout,
    RecordedSubscriberPayment,
    RecordedSubscriberPayout,
    RecordedSubscriberRefund,
    ReportedSubscriberRefund,
    SubscriberCreditRecord,
    SubscriberCreditStanding,
    SubscriberPaymentRecord,
    SubscriberPaymentRepository,
    SubscriberRefundRecord,
    TransactionContext,
} from '@saasicat/core';
import {
    columnAmountOf,
    isEndedRefund,
    openOfCredit,
    owedOn,
    paymentSettlement,
    payoutEntryColumns,
    refundEntryColumns,
    refundParts,
    settledAmountOf,
    subscriberPaymentColumns,
    subscriberRefundColumns,
    toCents,
    toDecimalString,
    toSubscriberCreditEntryRecord,
    toSubscriberCreditRecord,
    toSubscriberPaymentRecord,
    toSubscriberRefundRecord,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import {
    subscriberCreditEntries,
    subscriberCredits,
    subscriberPayments,
    subscriberRefunds,
    subscriptionInvoiceSettlements,
    subscriptionInvoices,
} from './schema.js';

type Db = ReturnType<typeof resolveDb>;

/** What the invoice's turn reads of it. */
interface LockedInvoice {
    id: string;
    subscriberId: string;
    tenantId: string;
    totalGross: string;
    currency: string;
}

/**
 * `SubscriberPaymentRepository` against the five tables of fragment 24.
 *
 * A payment is written in its invoice's turn — the invoice's row, locked for
 * the transaction — and a refund or a payout holds the credits it reads, so
 * two writes at the same moment never pay the same credit out twice. Every
 * write that must happen once is an insert the database refuses a second
 * time, which `ON CONFLICT DO NOTHING` turns into no row rather than an error
 * that would end the caller's transaction.
 */
@Injectable()
export class DrizzleSubscriberPaymentRepository implements SubscriberPaymentRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    /** Runs `work` on a savepoint of `tx`, or on a transaction of its own. */
    private inTransaction<T>(tx: TransactionContext, work: (db: Db) => Promise<T>): Promise<T> {
        return resolveDb(this.db, tx).transaction((transaction) =>
            work(resolveDb(this.db, transaction)),
        );
    }

    recordPayment(
        payment: NewSubscriberPayment,
        tx?: TransactionContext,
    ): Promise<RecordedSubscriberPayment | null> {
        return this.inTransaction(tx, async (db) => {
            const invoice = await lockInvoice(db, payment.invoiceId);
            if (invoice.currency !== payment.currency) {
                throw new Error(
                    `Payment ${payment.gatewayRef} at '${payment.gatewayAccount}' is in ` +
                        `${payment.currency}, and invoice ${invoice.id} in ${invoice.currency}.`,
                );
            }
            const [row] = await db
                .insert(subscriberPayments)
                .values({ id: randomUUID(), ...subscriberPaymentColumns(payment, invoice) })
                .onConflictDoNothing()
                .returning();
            if (!row) return null;
            const recorded = toSubscriberPaymentRecord(row);
            const owed = await owedIn(db, invoice);
            const { settles, credits } = paymentSettlement(recorded.amount, owed);
            if (settles > 0) {
                await db.insert(subscriptionInvoiceSettlements).values({
                    id: randomUUID(),
                    invoiceId: invoice.id,
                    paymentId: recorded.id,
                    kind: 'PAYMENT',
                    amount: toDecimalString(settles),
                    recordedAt: payment.at,
                });
            }
            const credit =
                credits > 0
                    ? await createCredit(
                          db,
                          invoice,
                          credits,
                          { originPaymentId: recorded.id },
                          payment.at,
                      )
                    : null;
            return { payment: recorded, settled: settles, credit };
        });
    }

    creditInvoice(
        invoiceId: string,
        at: Date,
        tx?: TransactionContext,
    ): Promise<SubscriberCreditRecord | null> {
        return this.inTransaction(tx, async (db) => {
            const invoice = await lockInvoice(db, invoiceId);
            const gross = grossOf(invoice);
            if (gross >= 0) return null;
            return createCredit(db, invoice, -gross, { originInvoiceId: invoice.id }, at);
        });
    }

    async listUncredited(
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .select({ id: subscriptionInvoices.id })
            .from(subscriptionInvoices)
            .where(
                and(
                    page.after === undefined ? undefined : gt(subscriptionInvoices.id, page.after),
                    lt(subscriptionInvoices.totalGross, '0'),
                    notExists(
                        db
                            .select({ one: sql`1` })
                            .from(subscriberCredits)
                            .where(eq(subscriberCredits.originInvoiceId, subscriptionInvoices.id)),
                    ),
                ),
            )
            .orderBy(asc(subscriptionInvoices.id))
            .limit(page.limit);
        return rows.map((row) => row.id);
    }

    recordRefund(
        refund: ReportedSubscriberRefund,
        tx?: TransactionContext,
    ): Promise<RecordedSubscriberRefund> {
        return this.inTransaction(tx, async (db) => {
            const [paymentRow] = await db
                .select()
                .from(subscriberPayments)
                .where(
                    and(
                        eq(subscriberPayments.gatewayAccount, refund.gatewayAccount),
                        eq(subscriberPayments.gatewayRef, refund.paymentRef),
                    ),
                );
            if (!paymentRow) return { outcome: 'unknown-payment' };
            const payment = toSubscriberPaymentRecord(paymentRow);
            refuseOtherCurrency(refund, payment);
            // The subscriber's credits are the refund's to divide: held, in
            // one order, before anything of them is read.
            await db
                .select({ id: subscriberCredits.id })
                .from(subscriberCredits)
                .where(eq(subscriberCredits.subscriberId, payment.subscriberId))
                .orderBy(asc(subscriberCredits.id))
                .for('update');
            const [inserted] = await db
                .insert(subscriberRefunds)
                .values({ id: randomUUID(), ...subscriberRefundColumns(refund, payment) })
                .onConflictDoNothing()
                .returning();
            if (inserted) return this.payOut(db, toSubscriberRefundRecord(inserted), payment);
            const [existing] = await db
                .select()
                .from(subscriberRefunds)
                .where(
                    and(
                        eq(subscriberRefunds.gatewayAccount, refund.gatewayAccount),
                        eq(subscriberRefunds.gatewayRef, refund.gatewayRef),
                    ),
                );
            if (!existing) {
                throw new Error(`Refund ${refund.gatewayRef} was neither written nor found.`);
            }
            return this.restate(db, toSubscriberRefundRecord(existing), refund);
        });
    }

    /** Divides a refund seen for the first time across the subscriber's open credits. */
    private async payOut(
        db: Db,
        refund: SubscriberRefundRecord,
        payment: SubscriberPaymentRecord,
    ): Promise<RecordedSubscriberRefund> {
        if (isEndedRefund(refund.status)) {
            return { outcome: 'recorded', refund, parts: [], unmatched: 0 };
        }
        const standings = await standingsOf(db, payment.subscriberId, refund.currency);
        const { parts, unmatched } = refundParts(
            refund.amount,
            payment.id,
            standings.map(({ credit, open }) => ({
                id: credit.id,
                origin: credit.origin,
                createdAt: credit.createdAt,
                open,
            })),
        );
        await writeRefundEntries(db, refund, 'REFUND', parts, refund.recordedAt);
        return { outcome: 'recorded', refund, parts, unmatched };
    }

    /**
     * A refund seen again: a failure or a cancellation gives back what it paid
     * out of each credit, once; anything else changes nothing paid out.
     */
    private async restate(
        db: Db,
        refund: SubscriberRefundRecord,
        reported: ReportedSubscriberRefund,
    ): Promise<RecordedSubscriberRefund> {
        if (isEndedRefund(refund.status) || reported.status === refund.status) {
            return { outcome: 'unchanged', refund };
        }
        const ends = isEndedRefund(reported.status);
        const updated = await db
            .update(subscriberRefunds)
            .set({ status: reported.status, endedAt: ends ? reported.at : null })
            .where(
                and(
                    eq(subscriberRefunds.id, refund.id),
                    eq(subscriberRefunds.status, refund.status),
                ),
            )
            .returning({ id: subscriberRefunds.id });
        const restated = { ...refund, status: reported.status, endedAt: ends ? reported.at : null };
        if (updated.length !== 1 || !ends) return { outcome: 'unchanged', refund: restated };
        const taken = await db
            .select()
            .from(subscriberCreditEntries)
            .where(
                and(
                    eq(subscriberCreditEntries.refundId, refund.id),
                    eq(subscriberCreditEntries.kind, 'REFUND'),
                ),
            )
            .orderBy(asc(subscriberCreditEntries.recordedAt), asc(subscriberCreditEntries.id));
        const parts: CreditPart[] = taken.map((row) => {
            const entry = toSubscriberCreditEntryRecord(row);
            return { creditId: entry.creditId, amount: entry.amount };
        });
        await writeRefundEntries(db, refund, 'REFUND_FAILED', parts, reported.at);
        return { outcome: 'given-back', refund: restated, parts };
    }

    recordPayout(
        payout: NewSubscriberPayout,
        tx?: TransactionContext,
    ): Promise<RecordedSubscriberPayout> {
        return this.inTransaction(tx, async (db) => {
            const [credit] = await db
                .select()
                .from(subscriberCredits)
                .where(eq(subscriberCredits.id, payout.creditId))
                .for('update');
            if (!credit) return { outcome: 'unknown-credit' };
            const entries = await db
                .select()
                .from(subscriberCreditEntries)
                .where(eq(subscriberCreditEntries.creditId, payout.creditId));
            const open = openOfCredit(
                toSubscriberCreditRecord(credit).amount,
                entries.map(toSubscriberCreditEntryRecord),
            );
            if (toCents(payout.amount) > toCents(open)) return { outcome: 'exceeds-open', open };
            const [row] = await db
                .insert(subscriberCreditEntries)
                .values({ id: randomUUID(), ...payoutEntryColumns(payout) })
                .returning();
            if (!row)
                throw new Error(`The payout against credit ${payout.creditId} was not written.`);
            return {
                outcome: 'recorded',
                entry: toSubscriberCreditEntryRecord(row),
                open: (toCents(open) - toCents(payout.amount)) / 100,
            };
        });
    }

    async listCredits(
        subscriberId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberCreditStanding[]> {
        return standingsOf(resolveDb(this.db, tx), subscriberId, null);
    }

    async findPaymentById(
        id: string,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentRecord | null> {
        const [row] = await resolveDb(this.db, tx)
            .select()
            .from(subscriberPayments)
            .where(eq(subscriberPayments.id, id));
        return row ? toSubscriberPaymentRecord(row) : null;
    }

    async findPaymentByRef(
        gatewayAccount: string,
        gatewayRef: string,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentRecord | null> {
        const [row] = await resolveDb(this.db, tx)
            .select()
            .from(subscriberPayments)
            .where(
                and(
                    eq(subscriberPayments.gatewayAccount, gatewayAccount),
                    eq(subscriberPayments.gatewayRef, gatewayRef),
                ),
            );
        return row ? toSubscriberPaymentRecord(row) : null;
    }

    async listPaymentsByInvoice(
        invoiceId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentRecord[]> {
        const rows = await resolveDb(this.db, tx)
            .select()
            .from(subscriberPayments)
            .where(eq(subscriberPayments.invoiceId, invoiceId))
            .orderBy(asc(subscriberPayments.recordedAt), asc(subscriberPayments.id));
        return rows.map(toSubscriberPaymentRecord);
    }

    async owedBy(invoiceId: string, tx?: TransactionContext): Promise<number | null> {
        const db = resolveDb(this.db, tx);
        const invoice = await readInvoice(db, invoiceId);
        return invoice ? owedIn(db, invoice) : null;
    }
}

/** Takes the invoice's turn and reads what a payment against it needs; throws where it does not exist. */
async function lockInvoice(db: Db, invoiceId: string): Promise<LockedInvoice> {
    const [row] = await invoiceQuery(db, invoiceId).for('update');
    if (!row) throw new Error(`Invoice ${invoiceId} does not exist.`);
    return row;
}

async function readInvoice(db: Db, invoiceId: string): Promise<LockedInvoice | null> {
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
        })
        .from(subscriptionInvoices)
        .where(eq(subscriptionInvoices.id, invoiceId));
}

function grossOf(invoice: LockedInvoice): number {
    return columnAmountOf(invoice.totalGross, {
        table: 'subscription_invoices',
        column: 'totalGross',
        id: invoice.id,
    });
}

/** What `invoice` still owes after what is settled against it. */
async function owedIn(db: Db, invoice: LockedInvoice): Promise<number> {
    const settled = await db
        .select({
            id: subscriptionInvoiceSettlements.id,
            kind: subscriptionInvoiceSettlements.kind,
            amount: subscriptionInvoiceSettlements.amount,
        })
        .from(subscriptionInvoiceSettlements)
        .where(eq(subscriptionInvoiceSettlements.invoiceId, invoice.id));
    return owedOn(grossOf(invoice), settled.map(settledAmountOf));
}

/** Writes a credit for the subscriber `invoice` names, once for its origin. */
async function createCredit(
    db: Db,
    invoice: LockedInvoice,
    amount: number,
    origin: { originPaymentId: string } | { originInvoiceId: string },
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
            createdAt: at,
        })
        .onConflictDoNothing()
        .returning();
    return row ? toSubscriberCreditRecord(row) : null;
}

/** The subscriber's credits, in `currency` where it is given, the oldest first. */
async function standingsOf(
    db: Db,
    subscriberId: string,
    currency: string | null,
): Promise<SubscriberCreditStanding[]> {
    const credits = await db
        .select()
        .from(subscriberCredits)
        .where(
            and(
                eq(subscriberCredits.subscriberId, subscriberId),
                currency === null ? undefined : eq(subscriberCredits.currency, currency),
            ),
        )
        .orderBy(asc(subscriberCredits.createdAt), asc(subscriberCredits.id));
    if (credits.length === 0) return [];
    const entries = await db
        .select()
        .from(subscriberCreditEntries)
        .where(
            inArray(
                subscriberCreditEntries.creditId,
                credits.map((credit) => credit.id),
            ),
        )
        .orderBy(asc(subscriberCreditEntries.recordedAt), asc(subscriberCreditEntries.id));
    return credits.map((row) => {
        const credit = toSubscriberCreditRecord(row);
        const own = entries
            .filter((entry) => entry.creditId === credit.id)
            .map(toSubscriberCreditEntryRecord);
        return { credit, entries: own, open: openOfCredit(credit.amount, own) };
    });
}

/** Writes one entry of a refund's per credit it pays out or gives back, once each. */
async function writeRefundEntries(
    db: Db,
    refund: SubscriberRefundRecord,
    kind: 'REFUND' | 'REFUND_FAILED',
    parts: readonly CreditPart[],
    at: Date,
): Promise<void> {
    if (parts.length === 0) return;
    await db
        .insert(subscriberCreditEntries)
        .values(
            parts.map((part) => ({
                id: randomUUID(),
                ...refundEntryColumns(part.creditId, refund, kind, part.amount, at),
            })),
        )
        .onConflictDoNothing();
}

/**
 * Refuses a refund in another currency than the payment it pays back: it
 * would be divided across credits of a currency the payment never brought.
 */
function refuseOtherCurrency(
    refund: ReportedSubscriberRefund,
    payment: SubscriberPaymentRecord,
): void {
    if (refund.currency === payment.currency) return;
    throw new Error(
        `Refund ${refund.gatewayRef} at '${refund.gatewayAccount}' is in ${refund.currency}, ` +
            `and payment ${payment.gatewayRef} it pays back in ${payment.currency}.`,
    );
}
