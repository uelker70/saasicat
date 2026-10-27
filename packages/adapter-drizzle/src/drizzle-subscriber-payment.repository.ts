import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, lt, notExists, sql } from 'drizzle-orm';
import type {
    CalendarDay,
    ClosedReconciliationCase,
    CloseReconciliationCase,
    CreditPart,
    InvoicePaymentShare,
    InvoiceSettlementRecord,
    MovedPaymentPart,
    NewSubscriberPayment,
    NewSubscriberPayout,
    OpenItemTotals,
    OwedCreditPage,
    OwingInvoicePage,
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
    columnAmountOf,
    invoiceSettlementsOf,
    isEndedRefund,
    openOfCredit,
    owedByInvoice,
    paymentSettlement,
    paymentSharesOf,
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
import { alias } from 'drizzle-orm/pg-core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import {
    correctedStateOf,
    correctedStatesOf,
    standingInvoiceIdOf,
} from './drizzle-invoice-chain.js';
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
import { openOfCreditSql, owedOnInvoice, paidOutOfCredit, stillOwes } from './drizzle-open-sums.js';
import { recordReversalIn } from './drizzle-subscriber-reversal.js';
import {
    subscriberCreditEntries,
    subscriberCredits,
    subscriberPayments,
    subscriberRefunds,
    subscriberReversals,
    subscriptionInvoiceCancellations,
    subscriptionInvoiceSettlements,
    subscriptionInvoices,
} from './schema.js';

/**
 * `SubscriberPaymentRepository` against the seven tables of fragment 24.
 *
 * A payment is written in the turn of its invoice's chain — the row of the
 * chain's first invoice, locked for the transaction — and a refund or a payout holds the credits it reads, so
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
            // It settles the invoice that stands in the chain when it holds the
            // turn: a replacement, where the invoice it was collected for was
            // cancelled meanwhile, or none, where nothing is owed any more
            // (`SC-PRIC-036`).
            const standingId = await standingInvoiceIdOf(db, invoice.id);
            const standing =
                standingId === null
                    ? null
                    : standingId === invoice.id
                      ? invoice
                      : await readInvoice(db, standingId);
            const owed = standing ? await owedIn(db, standing) : 0;
            const { settles, credits } = paymentSettlement(recorded.amount, owed);
            if (standing && settles > 0) {
                await db.insert(subscriptionInvoiceSettlements).values({
                    id: randomUUID(),
                    invoiceId: standing.id,
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
            // The invoice a cancellation invoice cancels takes its total back.
            if ((await correctedStateOf(db, invoice.id)).isCancellation) return null;
            return createCredit(db, invoice, -gross, { originInvoiceId: invoice.id }, at);
        });
    }

    async sharesOf(invoiceId: string, tx: TransactionContext): Promise<InvoicePaymentShare[]> {
        const db = resolveDb(this.db, tx);
        const settlements = await db
            .select({
                id: subscriptionInvoiceSettlements.id,
                kind: subscriptionInvoiceSettlements.kind,
                amount: subscriptionInvoiceSettlements.amount,
                paymentId: subscriptionInvoiceSettlements.paymentId,
            })
            .from(subscriptionInvoiceSettlements)
            .where(eq(subscriptionInvoiceSettlements.invoiceId, invoiceId));
        const paymentIds = [...new Set(settlements.map((row) => row.paymentId))];
        const payments =
            paymentIds.length === 0
                ? []
                : await db
                      .select({
                          id: subscriberPayments.id,
                          recordedAt: subscriberPayments.recordedAt,
                      })
                      .from(subscriberPayments)
                      .where(inArray(subscriberPayments.id, paymentIds));
        return paymentSharesOf(
            settlements.map((row) => ({ paymentId: row.paymentId, amount: settledAmountOf(row) })),
            new Map(payments.map((payment) => [payment.id, payment.recordedAt])),
        );
    }

    async moveShares(
        move: {
            cancellationId: string;
            cancelledInvoiceId: string;
            replacementInvoiceId: string | null;
            parts: readonly MovedPaymentPart[];
            at: Date;
        },
        tx: TransactionContext,
    ): Promise<SubscriberCreditRecord[]> {
        const db = resolveDb(this.db, tx);
        const cancelled = await readInvoice(db, move.cancelledInvoiceId);
        if (!cancelled) throw new Error(`Invoice ${move.cancelledInvoiceId} does not exist.`);
        const settlement = (
            kind: 'MOVED_OUT' | 'MOVED_IN',
            invoiceId: string,
            paymentId: string,
            amount: number,
        ) => ({
            id: randomUUID(),
            invoiceId,
            paymentId,
            kind,
            amount: toDecimalString(amount),
            cancellationId: move.cancellationId,
            recordedAt: move.at,
        });
        const rows = move.parts.flatMap((part) => [
            settlement('MOVED_OUT', cancelled.id, part.paymentId, part.movedOut),
            ...(move.replacementInvoiceId && part.movedIn > 0
                ? [settlement('MOVED_IN', move.replacementInvoiceId, part.paymentId, part.movedIn)]
                : []),
        ]);
        if (rows.length > 0) await db.insert(subscriptionInvoiceSettlements).values(rows);
        const credits: SubscriberCreditRecord[] = [];
        for (const part of move.parts) {
            if (part.credited <= 0) continue;
            const credit = await createCredit(
                db,
                cancelled,
                part.credited,
                { originPaymentId: part.paymentId, originCancellationId: move.cancellationId },
                move.at,
            );
            if (credit) credits.push(credit);
        }
        return credits;
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
                    notExists(
                        db
                            .select({ one: sql`1` })
                            .from(subscriptionInvoiceCancellations)
                            .where(
                                eq(
                                    subscriptionInvoiceCancellations.cancellationInvoiceId,
                                    subscriptionInvoices.id,
                                ),
                            ),
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
        const correctedState = await correctedStatesOf(db, invoiceIds);
        return invoices.map((invoice) => ({
            invoiceId: invoice.id,
            owed: owedByInvoice(
                grossOf(invoice),
                settled.filter((row) => row.invoiceId === invoice.id).map(settledAmountOf),
                correctedState(invoice.id),
            ),
        }));
    }

    async listSettlements(invoiceIds: readonly string[]): Promise<InvoiceSettlementRecord[]> {
        if (invoiceIds.length === 0) return [];
        const db = resolveDb(this.db);
        const rows = await db
            .select()
            .from(subscriptionInvoiceSettlements)
            .where(inArray(subscriptionInvoiceSettlements.invoiceId, [...invoiceIds]));
        const paymentIds = [...new Set(rows.map(({ paymentId }) => paymentId))];
        const payments =
            paymentIds.length === 0
                ? []
                : await db
                      .select()
                      .from(subscriberPayments)
                      .where(inArray(subscriberPayments.id, paymentIds));
        const reversalIds = [
            ...new Set(rows.flatMap(({ reversalId }) => (reversalId === null ? [] : [reversalId]))),
        ];
        const reversals =
            reversalIds.length === 0
                ? []
                : await db
                      .select()
                      .from(subscriberReversals)
                      .where(inArray(subscriberReversals.id, reversalIds));
        return invoiceSettlementsOf(rows, payments, reversals);
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

    async listOpenInvoices(page: {
        limit: number;
        after?: string;
        overdueOn?: CalendarDay;
    }): Promise<OwingInvoicePage> {
        const rows = await resolveDb(this.db)
            .select({
                id: subscriptionInvoices.id,
                owed: sql<string>`${owedOnInvoice}::text`,
            })
            .from(subscriptionInvoices)
            .where(
                and(
                    stillOwes,
                    page.overdueOn ? lt(subscriptionInvoices.dueDate, page.overdueOn) : undefined,
                    page.after
                        ? notExists(
                              resolveDb(this.db)
                                  .select({ id: afterInvoice.id })
                                  .from(afterInvoice)
                                  .where(
                                      and(
                                          eq(afterInvoice.id, page.after),
                                          sql`(${subscriptionInvoices.dueDate}, ${subscriptionInvoices.numberYear}, ${subscriptionInvoices.numberSequence})
                                              <= (${afterInvoice.dueDate}, ${afterInvoice.numberYear}, ${afterInvoice.numberSequence})`,
                                      ),
                                  ),
                          )
                        : undefined,
                ),
            )
            .orderBy(
                asc(subscriptionInvoices.dueDate),
                asc(subscriptionInvoices.numberYear),
                asc(subscriptionInvoices.numberSequence),
            )
            .limit(page.limit + 1);
        return {
            invoices: rows.slice(0, page.limit).map((row) => ({
                invoiceId: row.id,
                owed: columnAmountOf(row.owed, {
                    table: 'subscription_invoices',
                    column: 'owed',
                    id: row.id,
                }),
            })),
            hasMore: rows.length > page.limit,
        };
    }

    async listOpenCredits(page: { limit: number; after?: string }): Promise<OwedCreditPage> {
        const db = resolveDb(this.db);
        const rows = await db
            .select({ credit: subscriberCredits, open: sql<string>`${openOfCreditSql}::text` })
            .from(subscriberCredits)
            .where(
                and(
                    sql`${openOfCreditSql} > 0`,
                    page.after
                        ? notExists(
                              db
                                  .select({ id: afterCredit.id })
                                  .from(afterCredit)
                                  .where(
                                      and(
                                          eq(afterCredit.id, page.after),
                                          sql`(${subscriberCredits.createdAt}, ${subscriberCredits.id})
                                              <= (${afterCredit.createdAt}, ${afterCredit.id})`,
                                      ),
                                  ),
                          )
                        : undefined,
                ),
            )
            .orderBy(asc(subscriberCredits.createdAt), asc(subscriberCredits.id))
            .limit(page.limit + 1);
        return {
            credits: rows.slice(0, page.limit).map((row) => ({
                credit: toSubscriberCreditRecord(row.credit),
                open: columnAmountOf(row.open, {
                    table: 'subscriber_credits',
                    column: 'open',
                    id: row.credit.id,
                }),
            })),
            hasMore: rows.length > page.limit,
        };
    }

    async openItemTotals(today: CalendarDay): Promise<OpenItemTotals> {
        const db = resolveDb(this.db);
        const invoiceRows = await db
            .select({
                currency: subscriptionInvoices.currency,
                owed: sql<string>`SUM(${owedOnInvoice})::text`,
                overdue: sql<string>`COALESCE(SUM(${owedOnInvoice}) FILTER (WHERE ${subscriptionInvoices.dueDate} < ${today}::date), 0)::text`,
            })
            .from(subscriptionInvoices)
            .where(stillOwes)
            .groupBy(subscriptionInvoices.currency)
            .orderBy(asc(subscriptionInvoices.currency));
        const creditRows = await db
            .select({
                currency: subscriberCredits.currency,
                open: sql<string>`SUM(${openOfCreditSql})::text`,
            })
            .from(subscriberCredits)
            .where(sql`${openOfCreditSql} > 0`)
            .groupBy(subscriberCredits.currency)
            .orderBy(asc(subscriberCredits.currency));
        const amount = (text: string, table: string, column: string, id: string) =>
            columnAmountOf(text, { table, column, id });
        return {
            invoices: invoiceRows.map((row) => ({
                currency: row.currency,
                owed: amount(row.owed, 'subscription_invoices', 'owed', row.currency),
                overdue: amount(row.overdue, 'subscription_invoices', 'overdue', row.currency),
            })),
            credits: creditRows.map((row) => ({
                currency: row.currency,
                open: amount(row.open, 'subscriber_credits', 'open', row.currency),
            })),
        };
    }

    async accountsHoldingCredits(tx?: TransactionContext): Promise<string[]> {
        // A credit from a reversal given back is held at the account of the
        // payment the reversal took back; one from an invoice at no account.
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
            .where(gt(subscriberCredits.amount, paidOutOfCredit))
            .orderBy(asc(subscriberPayments.gatewayAccount));
        return rows.map((row) => row.account);
    }
}

/** The invoice a page of open invoices goes on after, beside the one the query lists. */
const afterInvoice = alias(subscriptionInvoices, 'after_invoice');

/** The credit a page of open credits goes on after, beside the one the query lists. */
const afterCredit = alias(subscriberCredits, 'after_credit');

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
