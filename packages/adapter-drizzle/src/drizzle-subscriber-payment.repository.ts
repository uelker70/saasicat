import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, lt, notExists, sql } from 'drizzle-orm';
import type {
    ClosedReconciliationCase,
    CloseReconciliationCase,
    CreditPart,
    NewSubscriberPayment,
    NewSubscriberPayout,
    ReconciliationCaseState,
    RecordedSubscriberPayment,
    RecordedSubscriberPayout,
    RecordedSubscriberRefund,
    RecordedSubscriberReversal,
    ReportedSubscriberRefund,
    ReportedSubscriberReversal,
    SubscriberCreditRecord,
    SubscriberCreditStanding,
    SubscriberPaymentRecord,
    SubscriberPaymentRepository,
    SubscriberReconciliationCaseRecord,
    SubscriberRefundRecord,
    SubscriberReversalRecord,
    TransactionContext,
} from '@saasicat/core';
import {
    CASE_CLOSED_REFUND_ENDED,
    GIVING_BACK_CREDIT_ENTRY_KINDS,
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
    toSubscriberReversalRecord,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import {
    closeCaseIn,
    closeCasesOf,
    listCasesIn,
    openCase,
} from './drizzle-reconciliation-cases.js';
import {
    createCredit,
    type Db,
    grossOf,
    holdCredits,
    lockInvoice,
    owedIn,
    readInvoice,
} from './drizzle-subscriber-payment-rows.js';
import { recordReversalIn } from './drizzle-subscriber-reversal.js';
import {
    subscriberCreditEntries,
    subscriberCredits,
    subscriberPayments,
    subscriberRefunds,
    subscriberReversals,
    subscriptionInvoiceSettlements,
    subscriptionInvoices,
} from './schema.js';

/**
 * `SubscriberPaymentRepository` against the seven tables of fragment 24.
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
            await holdCredits(db, payment.subscriberId);
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
            return { outcome: 'recorded', refund, parts: [], unmatched: 0, case: null };
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
        const opened =
            unmatched > 0
                ? await openCase(db, {
                      kind: 'REFUND_UNMATCHED',
                      amount: unmatched,
                      currency: refund.currency,
                      payment,
                      about: refund,
                      at: refund.recordedAt,
                  })
                : null;
        return { outcome: 'recorded', refund, parts, unmatched, case: opened };
    }

    /**
     * A refund seen again: a failure or a cancellation gives back what it paid
     * out of each credit, once, and closes the case its unmatched part opened;
     * anything else changes nothing paid out.
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
        const closedCases = await closeCasesOf(
            db,
            { refundId: refund.id },
            CASE_CLOSED_REFUND_ENDED,
            reported.at,
        );
        return { outcome: 'given-back', refund: restated, parts, closedCases };
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

    async findReversalById(
        id: string,
        tx?: TransactionContext,
    ): Promise<SubscriberReversalRecord | null> {
        const [row] = await resolveDb(this.db, tx)
            .select()
            .from(subscriberReversals)
            .where(eq(subscriberReversals.id, id));
        return row ? toSubscriberReversalRecord(row) : null;
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

    async owedByInvoices(
        invoiceIds: readonly string[],
        tx?: TransactionContext,
    ): Promise<{ invoiceId: string; owed: number }[]> {
        if (invoiceIds.length === 0) return [];
        const db = resolveDb(this.db, tx);
        const invoices = await db
            .select({ id: subscriptionInvoices.id, totalGross: subscriptionInvoices.totalGross })
            .from(subscriptionInvoices)
            .where(inArray(subscriptionInvoices.id, [...invoiceIds]));
        const settled = await db
            .select({
                id: subscriptionInvoiceSettlements.id,
                invoiceId: subscriptionInvoiceSettlements.invoiceId,
                kind: subscriptionInvoiceSettlements.kind,
                amount: subscriptionInvoiceSettlements.amount,
            })
            .from(subscriptionInvoiceSettlements)
            .where(inArray(subscriptionInvoiceSettlements.invoiceId, [...invoiceIds]));
        return invoices.map((invoice) => ({
            invoiceId: invoice.id,
            owed: owedOn(
                grossOf(invoice),
                settled.filter((row) => row.invoiceId === invoice.id).map(settledAmountOf),
            ),
        }));
    }

    recordReversal(
        reversal: ReportedSubscriberReversal,
        tx?: TransactionContext,
    ): Promise<RecordedSubscriberReversal> {
        return this.inTransaction(tx, (db) => recordReversalIn(db, reversal));
    }

    listCases(
        filter: { state: ReconciliationCaseState; subscriberId?: string },
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<SubscriberReconciliationCaseRecord[]> {
        return listCasesIn(resolveDb(this.db, tx), filter, page);
    }

    closeCase(
        close: CloseReconciliationCase,
        tx?: TransactionContext,
    ): Promise<ClosedReconciliationCase> {
        return closeCaseIn(resolveDb(this.db, tx), close);
    }

    async accountsHoldingCredits(tx?: TransactionContext): Promise<string[]> {
        // A credit from a reversal given back is held at the account of the
        // payment the reversal took back; one from an invoice at no account.
        const paidOut = sql<string>`COALESCE((
            SELECT SUM(CASE WHEN ${inArray(subscriberCreditEntries.kind, GIVING_BACK)}
                            THEN -${subscriberCreditEntries.amount}
                            ELSE ${subscriberCreditEntries.amount} END)
              FROM ${subscriberCreditEntries}
             WHERE ${subscriberCreditEntries.creditId} = ${subscriberCredits.id}
        ), 0)`;
        const rows = await resolveDb(this.db, tx)
            .selectDistinct({ account: subscriberPayments.gatewayAccount })
            .from(subscriberCredits)
            .leftJoin(
                subscriberReversals,
                eq(subscriberReversals.id, subscriberCredits.originReversalId),
            )
            .innerJoin(
                subscriberPayments,
                eq(
                    subscriberPayments.id,
                    sql`COALESCE(${subscriberCredits.originPaymentId}, ${subscriberReversals.paymentId})`,
                ),
            )
            .where(gt(subscriberCredits.amount, paidOut))
            .orderBy(asc(subscriberPayments.gatewayAccount));
        return rows.map((row) => row.account);
    }
}

/** The credit entry kinds that give back, as a parameter of the sum above. */
const GIVING_BACK = [...GIVING_BACK_CREDIT_ENTRY_KINDS];

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
