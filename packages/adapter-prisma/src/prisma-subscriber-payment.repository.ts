import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
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
    utcMidnightOf,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN } from './prisma-client-token.js';
import { closeCaseIn, closeCasesOf, listCasesIn, openCase } from './prisma-reconciliation-cases.js';
import {
    createCredit,
    grossOf,
    holdCredits,
    lockInvoice,
    openOf,
    owedOf,
    readInvoice,
    type PaymentPrisma,
} from './prisma-subscriber-payment-rows.js';
import { recordReversalIn } from './prisma-subscriber-reversal.js';
import { idsOf, textsOf } from './raw-ids.js';

/** The root client's interactive transaction. */
interface PaymentRepositoryClient {
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

/** The credit entry kinds that give back, as a parameter of the sum below. */
const GIVING_BACK = [...GIVING_BACK_CREDIT_ENTRY_KINDS];

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
export class PrismaSubscriberPaymentRepository implements SubscriberPaymentRepository {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: PaymentRepositoryClient,
    ) {}

    private db(tx?: TransactionContext): PaymentPrisma {
        // SAFETY: the root client and every transaction client it hands out
        // carry the seven delegates of fragment 24 wherever it is adopted, and
        // `$queryRaw`; the generated-client test compiles this adapter against
        // a client generated from the fragments.
        return (tx ?? this.prisma) as PaymentPrisma;
    }

    /** Runs `work` on `tx`, or on a transaction of its own. */
    private inTransaction<T>(
        tx: TransactionContext,
        work: (db: PaymentPrisma) => Promise<T>,
    ): Promise<T> {
        if (tx) return work(this.db(tx));
        return this.prisma.$transaction((own) => work(this.db(own)));
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
            const [row] = await db.subscriberPayment.createManyAndReturn({
                data: [{ id: randomUUID(), ...subscriberPaymentColumns(payment, invoice) }],
                skipDuplicates: true,
            });
            if (!row) return null;
            const recorded = toSubscriberPaymentRecord(row);
            const owed = await owedOf(db, invoice);
            const { settles, credits } = paymentSettlement(recorded.amount, owed);
            if (settles > 0) {
                await db.subscriptionInvoiceSettlement.createMany({
                    data: [
                        {
                            id: randomUUID(),
                            invoiceId: invoice.id,
                            paymentId: recorded.id,
                            kind: 'PAYMENT',
                            amount: toDecimalString(settles),
                            recordedAt: payment.at,
                        },
                    ],
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
        // An empty text sorts before every id, so no `after` reads from the start.
        const after = page.after ?? '';
        const rows = await this.db(tx).$queryRaw`
            SELECT i."id"
              FROM "subscription_invoices" i
             WHERE i."id" > ${after}
               AND i."totalGross" < 0
               AND NOT EXISTS (
                       SELECT 1 FROM "subscriber_credits" c WHERE c."originInvoiceId" = i."id"
                   )
             ORDER BY i."id"
             LIMIT ${page.limit}`;
        return idsOf(rows);
    }

    recordRefund(
        refund: ReportedSubscriberRefund,
        tx?: TransactionContext,
    ): Promise<RecordedSubscriberRefund> {
        return this.inTransaction(tx, async (db) => {
            const paymentRow = await db.subscriberPayment.findUnique({
                where: {
                    gatewayAccount_gatewayRef: {
                        gatewayAccount: refund.gatewayAccount,
                        gatewayRef: refund.paymentRef,
                    },
                },
            });
            if (!paymentRow) return { outcome: 'unknown-payment' };
            const payment = toSubscriberPaymentRecord(paymentRow);
            refuseOtherCurrency(refund, payment);
            // The subscriber's credits are the refund's to divide: held, in
            // one order, before anything of them is read.
            await holdCredits(db, payment.subscriberId);
            const [inserted] = await db.subscriberRefund.createManyAndReturn({
                data: [{ id: randomUUID(), ...subscriberRefundColumns(refund, payment) }],
                skipDuplicates: true,
            });
            if (inserted) return this.payOut(db, toSubscriberRefundRecord(inserted), payment);
            const existingRow = await db.subscriberRefund.findUnique({
                where: {
                    gatewayAccount_gatewayRef: {
                        gatewayAccount: refund.gatewayAccount,
                        gatewayRef: refund.gatewayRef,
                    },
                },
            });
            if (!existingRow) {
                throw new Error(`Refund ${refund.gatewayRef} was neither written nor found.`);
            }
            return this.restate(db, toSubscriberRefundRecord(existingRow), refund);
        });
    }

    /** Divides a refund seen for the first time across the subscriber's open credits. */
    private async payOut(
        db: PaymentPrisma,
        refund: SubscriberRefundRecord,
        payment: SubscriberPaymentRecord,
    ): Promise<RecordedSubscriberRefund> {
        if (isEndedRefund(refund.status)) {
            return { outcome: 'recorded', refund, parts: [], unmatched: 0, case: null };
        }
        const standings = await this.standingsOf(db, payment.subscriberId, refund.currency);
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
        db: PaymentPrisma,
        refund: SubscriberRefundRecord,
        reported: ReportedSubscriberRefund,
    ): Promise<RecordedSubscriberRefund> {
        if (isEndedRefund(refund.status) || reported.status === refund.status) {
            return { outcome: 'unchanged', refund };
        }
        const ends = isEndedRefund(reported.status);
        const { count } = await db.subscriberRefund.updateMany({
            where: { id: refund.id, status: refund.status },
            data: { status: reported.status, endedAt: ends ? reported.at : null },
        });
        const restated = { ...refund, status: reported.status, endedAt: ends ? reported.at : null };
        if (count !== 1 || !ends) return { outcome: 'unchanged', refund: restated };
        const taken = await db.subscriberCreditEntry.findMany({
            where: { refundId: refund.id, kind: 'REFUND' },
            orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        });
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
            const locked = idsOf(
                await db.$queryRaw`
                    SELECT "id" FROM "subscriber_credits" WHERE "id" = ${payout.creditId} FOR UPDATE`,
            );
            if (locked.length === 0) return { outcome: 'unknown-credit' };
            const open = await openOf(db, payout.creditId);
            if (toCents(payout.amount) > toCents(open)) return { outcome: 'exceeds-open', open };
            const { paidOn, ...written } = payoutEntryColumns(payout);
            const row = await db.subscriberCreditEntry.create({
                data: { id: randomUUID(), ...written, paidOn: utcMidnightOf(paidOn) },
            });
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
        return this.standingsOf(this.db(tx), subscriberId, null);
    }

    /** The subscriber's credits, in `currency` where it is given, the oldest first. */
    private async standingsOf(
        db: PaymentPrisma,
        subscriberId: string,
        currency: string | null,
    ): Promise<SubscriberCreditStanding[]> {
        const credits = await db.subscriberCredit.findMany({
            where: currency === null ? { subscriberId } : { subscriberId, currency },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        if (credits.length === 0) return [];
        const entries = await db.subscriberCreditEntry.findMany({
            where: { creditId: { in: credits.map((credit) => credit.id) } },
            orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        });
        return credits.map((row) => {
            const credit = toSubscriberCreditRecord(row);
            const own = entries
                .filter((entry) => entry.creditId === credit.id)
                .map(toSubscriberCreditEntryRecord);
            return { credit, entries: own, open: openOfCredit(credit.amount, own) };
        });
    }

    async findPaymentById(
        id: string,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentRecord | null> {
        const row = await this.db(tx).subscriberPayment.findUnique({ where: { id } });
        return row ? toSubscriberPaymentRecord(row) : null;
    }

    async findReversalById(
        id: string,
        tx?: TransactionContext,
    ): Promise<SubscriberReversalRecord | null> {
        const row = await this.db(tx).subscriberReversal.findUnique({ where: { id } });
        return row ? toSubscriberReversalRecord(row) : null;
    }

    async findPaymentByRef(
        gatewayAccount: string,
        gatewayRef: string,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentRecord | null> {
        const row = await this.db(tx).subscriberPayment.findUnique({
            where: { gatewayAccount_gatewayRef: { gatewayAccount, gatewayRef } },
        });
        return row ? toSubscriberPaymentRecord(row) : null;
    }

    async listPaymentsByInvoice(
        invoiceId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentRecord[]> {
        const rows = await this.db(tx).subscriberPayment.findMany({
            where: { invoiceId },
            orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        });
        return rows.map(toSubscriberPaymentRecord);
    }

    async owedBy(invoiceId: string, tx?: TransactionContext): Promise<number | null> {
        const db = this.db(tx);
        const invoice = await readInvoice(db, invoiceId);
        return invoice ? owedOf(db, invoice) : null;
    }

    async owedByInvoices(
        invoiceIds: readonly string[],
        tx?: TransactionContext,
    ): Promise<{ invoiceId: string; owed: number }[]> {
        if (invoiceIds.length === 0) return [];
        const db = this.db(tx);
        const invoices = await db.subscriptionInvoice.findMany({
            where: { id: { in: [...invoiceIds] } },
            select: {
                id: true,
                subscriberId: true,
                tenantId: true,
                totalGross: true,
                currency: true,
            },
        });
        const settled = await db.subscriptionInvoiceSettlement.findMany({
            where: { invoiceId: { in: [...invoiceIds] } },
            select: { id: true, invoiceId: true, kind: true, amount: true },
        });
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
        return listCasesIn(this.db(tx), filter, page);
    }

    closeCase(
        close: CloseReconciliationCase,
        tx?: TransactionContext,
    ): Promise<ClosedReconciliationCase> {
        return closeCaseIn(this.db(tx), close);
    }

    async accountsHoldingCredits(tx?: TransactionContext): Promise<string[]> {
        // A credit from a reversal given back is held at the account of the
        // payment the reversal took back; one from an invoice at no account.
        const rows = await this.db(tx).$queryRaw`
            SELECT DISTINCT p."gatewayAccount" AS "account"
              FROM "subscriber_credits" c
              LEFT JOIN "subscriber_reversals" r ON r."id" = c."originReversalId"
              JOIN "subscriber_payments" p ON p."id" = COALESCE(c."originPaymentId", r."paymentId")
             WHERE c."amount" > COALESCE((
                       SELECT SUM(CASE WHEN e."kind" = ANY(${GIVING_BACK}) THEN -e."amount"
                                       ELSE e."amount" END)
                         FROM "subscriber_credit_entries" e
                        WHERE e."creditId" = c."id"
                   ), 0)
             ORDER BY 1`;
        return textsOf(rows, 'account');
    }
}

/** Writes one entry of a refund's per credit it pays out or gives back, once each. */
async function writeRefundEntries(
    db: PaymentPrisma,
    refund: SubscriberRefundRecord,
    kind: 'REFUND' | 'REFUND_FAILED',
    parts: readonly CreditPart[],
    at: Date,
): Promise<void> {
    if (parts.length === 0) return;
    await db.subscriberCreditEntry.createMany({
        data: parts.map((part) => ({
            id: randomUUID(),
            ...refundEntryColumns(part.creditId, refund, kind, part.amount, at),
        })),
        skipDuplicates: true,
    });
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
