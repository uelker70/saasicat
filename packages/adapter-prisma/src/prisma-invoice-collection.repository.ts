import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
    AbandonPaidOutcome,
    CalendarDay,
    CanonicalInvoiceCollectionRow,
    CollectionOutcome,
    EarlierCollection,
    InvoiceCollectionColumns,
    InvoiceCollectionRecord,
    InvoiceCollectionRepository,
    NewInvoiceCollection,
    PlannedInvoiceCollection,
    SubmittedInvoiceCollection,
    TransactionContext,
} from '@saasicat/core';
import {
    COLLECTION_NOT_SENT_PAID,
    FOLLOWED_UP_COLLECTION_STATUSES,
    REOPENING_SETTLEMENT_KINDS,
    REVERSIBLE_COLLECTION_STATUSES,
    UNSETTLED_COLLECTION_STATUSES,
    collectionOutcomeColumns,
    columnAmountOf,
    invoiceCollectionColumns,
    lastCollectionOf,
    plannedCollectionColumns,
    refusesFirstAttempt,
    refusesPlannedAttempt,
    sentCollectionOf,
    toInvoiceCollectionRecord,
    utcMidnightOf,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';
import { lockChainOf } from './prisma-invoice-chain.js';
import { idsOf, textsOf } from './raw-ids.js';

/** Narrow view of the client and of a transaction client, which carry the same delegates. */
interface CollectionPrisma {
    subscriptionInvoiceCollection: PrismaModelDelegateLike<CanonicalInvoiceCollectionRow>;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/** The root client's interactive transaction. */
interface CollectionRepositoryClient {
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

/** The attempts what follows is decided for, as a parameter of the query below. */
const FOLLOWED_UP = [...FOLLOWED_UP_COLLECTION_STATUSES];

/** The settlement kinds that add back to what an invoice owes, as a parameter of the sums below. */
const REOPENING = [...REOPENING_SETTLEMENT_KINDS];

/**
 * The attempts of a chain that hold every other invoice of it back: sent, and
 * not settled (`SC-PRIC-036`).
 */
const OPEN_IN_CHAIN = [...UNSETTLED_COLLECTION_STATUSES];

/**
 * `InvoiceCollectionRepository` against `subscription_invoice_collections`.
 *
 * An attempt is started in the turn of the invoice's chain — the row of the
 * chain's first invoice in `subscription_invoices`, locked for the
 * transaction — and every write that
 * settles or takes on an attempt is one conditional `UPDATE` naming the state
 * it expects, so of two runs one wins and the other is told.
 */
@Injectable()
export class PrismaInvoiceCollectionRepository implements InvoiceCollectionRepository {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: CollectionRepositoryClient,
    ) {}

    private db(tx?: TransactionContext): CollectionPrisma {
        // SAFETY: the root client and every transaction client it hands out
        // carry the `subscriptionInvoiceCollection` delegate wherever fragment
        // 23 is adopted, and `$queryRaw`; the generated-client test compiles
        // this adapter against a client generated from the fragments.
        return (tx ?? this.prisma) as CollectionPrisma;
    }

    async listDue(
        today: CalendarDay,
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        // An empty text sorts before every id, so no `after` reads from the start.
        const after = page.after ?? '';
        const rows = await this.db(tx).$queryRaw`
            SELECT i."id"
              FROM "subscription_invoices" i
              JOIN "subscription_invoice_documents" d ON d."invoiceId" = i."id"
             WHERE i."id" > ${after}
               AND i."payment" IS NOT NULL
               AND d."deliveredAt" IS NOT NULL
               AND (i."collectionDate" IS NULL OR i."collectionDate" <= ${today}::date)
               AND NOT EXISTS (
                       SELECT 1 FROM "subscription_invoice_collections" c
                        WHERE c."invoiceId" = i."id"
                   )
               AND NOT EXISTS (
                       SELECT 1 FROM "subscription_invoice_cancellations" x
                        WHERE x."cancelledInvoiceId" = i."id"
                   )
               AND NOT EXISTS (
                       SELECT 1 FROM "subscription_invoice_collections" c
                         JOIN "subscription_invoices" o ON o."id" = c."invoiceId"
                        WHERE o."chainId" = i."chainId"
                          AND c."status" = ANY(${OPEN_IN_CHAIN})
                   )
             ORDER BY i."id"
             LIMIT ${page.limit}`;
        return idsOf(rows);
    }

    startAttempt(
        attempt: NewInvoiceCollection,
        tx?: TransactionContext,
    ): Promise<InvoiceCollectionRecord | null> {
        return this.writeNext(
            attempt.invoiceId,
            refusesFirstAttempt,
            (number, amount) => invoiceCollectionColumns(attempt, number, amount),
            tx,
        );
    }

    plan(
        plan: PlannedInvoiceCollection,
        tx?: TransactionContext,
    ): Promise<InvoiceCollectionRecord | null> {
        return this.writeNext(
            plan.invoiceId,
            (earlier) => refusesPlannedAttempt(earlier, plan.after),
            (number, amount) => plannedCollectionColumns(plan, number, amount),
            tx,
        );
    }

    /** Writes the invoice's next attempt in its turn, unless what it holds by then `refuses` it. */
    private writeNext(
        invoiceId: string,
        refuses: (earlier: readonly EarlierCollection[]) => boolean,
        columns: (number: number, amount: number) => InvoiceCollectionColumns,
        tx?: TransactionContext,
    ): Promise<InvoiceCollectionRecord | null> {
        const write = (db: CollectionPrisma) => this.writeNextIn(db, invoiceId, refuses, columns);
        if (tx) return write(this.db(tx));
        return this.prisma.$transaction((own) => write(this.db(own)));
    }

    private async writeNextIn(
        db: CollectionPrisma,
        invoiceId: string,
        refuses: (earlier: readonly EarlierCollection[]) => boolean,
        columns: (number: number, amount: number) => InvoiceCollectionColumns,
    ): Promise<InvoiceCollectionRecord | null> {
        // The turn of the invoice's chain: a second run writing an attempt for
        // it waits here, and then reads the attempt the first one wrote.
        const chainId = await lockChainOf(db, invoiceId);
        if (chainId === null) throw new Error(`Invoice ${invoiceId} does not exist.`);
        // An invoice that owes nothing — a payment came for it, or it was
        // cancelled — is collected no further; one that owes is collected for
        // what it owes now, in the turn no payment or reversal moves it in.
        const owed = await owedIn(db, invoiceId);
        if (owed <= 0) return null;
        const earlier = await db.subscriptionInvoiceCollection.findMany({
            where: { invoiceId },
            select: { attempt: true, status: true },
        });
        if (refuses(earlier)) return null;
        const number = lastCollectionOf(earlier) + 1;
        const { collectOn, ...written } = columns(number, owed);
        if (await heldBackByItsChain(db, chainId, invoiceId, written.paymentMethodId)) return null;
        // `ON CONFLICT DO NOTHING` without a target, so any of the unique
        // indexes turns a second attempt into no row rather than an error that
        // would end the caller's transaction.
        const [row] = await db.subscriptionInvoiceCollection.createManyAndReturn({
            data: [
                {
                    id: randomUUID(),
                    ...written,
                    collectOn: collectOn === null ? null : utcMidnightOf(collectOn),
                },
            ],
            skipDuplicates: true,
        });
        return row ? toInvoiceCollectionRecord(row) : null;
    }

    async announce(
        id: string,
        collectOn: CalendarDay,
        at: Date,
        tx?: TransactionContext,
    ): Promise<boolean> {
        const { count } = await this.db(tx).subscriptionInvoiceCollection.updateMany({
            where: { id, status: 'SCHEDULED', announcedAt: null },
            data: { collectOn: utcMidnightOf(collectOn), announcedAt: at },
        });
        return count === 1;
    }

    submitPlanned(
        id: string,
        at: Date,
        tx?: TransactionContext,
    ): Promise<SubmittedInvoiceCollection | null> {
        return this.inTurnOf(id, tx, async (db) => {
            const planned = await db.subscriptionInvoiceCollection.findUnique({ where: { id } });
            if (!planned || !(await owes(db, planned.invoiceId))) return null;
            const { count } = await db.subscriptionInvoiceCollection.updateMany({
                where: { id, status: 'SCHEDULED' },
                data: { status: 'SUBMITTED', submittedAt: at, heldAt: at },
            });
            if (count !== 1) return null;
            const row = await db.subscriptionInvoiceCollection.findUnique({ where: { id } });
            return row ? sentCollectionOf(toInvoiceCollectionRecord(row)) : null;
        });
    }

    withdraw(id: string, at: Date, tx?: TransactionContext): Promise<boolean> {
        return this.inTurnOf(id, tx, async (db) => {
            const { count } = await db.subscriptionInvoiceCollection.updateMany({
                where: { id, status: 'SCHEDULED' },
                data: { status: 'WITHDRAWN', resolvedAt: at },
            });
            return count === 1;
        });
    }

    /** Runs `work` in the turn of the invoice attempt `id` belongs to, as `writeNext` takes it. */
    private inTurnOf<T>(
        id: string,
        tx: TransactionContext,
        work: (db: CollectionPrisma) => Promise<T>,
    ): Promise<T> {
        const take = async (db: CollectionPrisma) => {
            await db.$queryRaw`
                SELECT i."id" FROM "subscription_invoices" i
                 WHERE i."id" = (
                           SELECT o."chainId" FROM "subscription_invoices" o
                            WHERE o."id" = (
                                      SELECT c."invoiceId" FROM "subscription_invoice_collections" c
                                       WHERE c."id" = ${id}
                                  )
                       )
                   FOR UPDATE`;
            return work(db);
        };
        if (tx) return take(this.db(tx));
        return this.prisma.$transaction((own) => take(this.db(own)));
    }

    async listPlanned(
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        const rows = await this.db(tx).subscriptionInvoiceCollection.findMany({
            // An empty text sorts before every id, as in `listDue`.
            where: { id: { gt: page.after ?? '' }, status: 'SCHEDULED' },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: page.limit,
        });
        return rows.map((row) => row.id);
    }

    async listToFollowUp(
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        const rows = await this.db(tx).subscriptionInvoiceCollection.findMany({
            // An empty text sorts before every id, as in `listDue`.
            where: {
                id: { gt: page.after ?? '' },
                status: { in: [...FOLLOWED_UP_COLLECTION_STATUSES] },
                followedUpAt: null,
            },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: page.limit,
        });
        return rows.map((row) => row.id);
    }

    async listCollectableAgain(
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        // An empty text sorts before every id, as in `listDue`. The last
        // attempt only: a later one exists only where none before it was open
        // or succeeded, so a last one that failed or was withdrawn means none
        // of the invoice's is.
        const after = page.after ?? '';
        const rows = await this.db(tx).$queryRaw`
            SELECT i."id"
              FROM "subscription_invoices" i
              JOIN "subscription_invoice_collections" c ON c."invoiceId" = i."id"
              JOIN "subscriber_payment_methods" m
                ON m."subscriberId" = i."subscriberId" AND m."status" = 'ACTIVE'
             WHERE i."id" > ${after}
               AND c."attempt" = (
                       SELECT max(o."attempt") FROM "subscription_invoice_collections" o
                        WHERE o."invoiceId" = i."id"
                   )
               AND (c."status" = 'WITHDRAWN'
                    OR (c."status" = ANY(${FOLLOWED_UP}) AND c."followedUpAt" IS NOT NULL))
               AND m."id" <> c."paymentMethodId"
               AND NOT EXISTS (
                       SELECT 1 FROM "subscription_invoice_collections" r
                         JOIN "subscription_invoices" o ON o."id" = r."invoiceId"
                        WHERE o."chainId" = i."chainId"
                          AND r."status" = 'REVERSED'
                          AND (r."followedUpAt" IS NULL OR r."paymentMethodId" = m."id")
                   )
               AND NOT EXISTS (
                       SELECT 1 FROM "subscription_invoice_cancellations" x
                        WHERE x."cancelledInvoiceId" = i."id" OR x."cancellationInvoiceId" = i."id"
                   )
               AND i."totalGross" > COALESCE((
                       SELECT SUM(CASE WHEN s."kind" = ANY(${REOPENING}) THEN -s."amount"
                                       ELSE s."amount" END)
                         FROM "subscription_invoice_settlements" s
                        WHERE s."invoiceId" = i."id"
                   ), 0)
             ORDER BY i."id"
             LIMIT ${page.limit}`;
        return idsOf(rows);
    }

    async markFollowedUp(id: string, at: Date, tx?: TransactionContext): Promise<boolean> {
        const { count } = await this.db(tx).subscriptionInvoiceCollection.updateMany({
            where: { id, status: { in: [...FOLLOWED_UP_COLLECTION_STATUSES] }, followedUpAt: null },
            data: { followedUpAt: at },
        });
        return count === 1;
    }

    async markReversed(id: string, at: Date, tx?: TransactionContext): Promise<boolean> {
        const { count } = await this.db(tx).subscriptionInvoiceCollection.updateMany({
            where: { id, status: { in: [...REVERSIBLE_COLLECTION_STATUSES] } },
            data: { status: 'REVERSED', resolvedAt: at, followedUpAt: null },
        });
        return count === 1;
    }

    async recordOutcome(
        id: string,
        outcome: CollectionOutcome,
        at: Date,
        tx?: TransactionContext,
    ): Promise<boolean> {
        const settle = async (db: CollectionPrisma) => {
            const { count } = await db.subscriptionInvoiceCollection.updateMany({
                where: { id, status: { in: [...UNSETTLED_COLLECTION_STATUSES] } },
                data: collectionOutcomeColumns(outcome, at),
            });
            return count === 1;
        };
        if (outcome.status !== 'succeeded') return settle(this.db(tx));
        return this.inTurnOf(id, tx, async (db) => {
            if (await settle(db)) return true;
            const row = await db.subscriptionInvoiceCollection.findUnique({ where: { id } });
            if (!row || row.status !== 'FAILED') return false;
            // The money arrived after all: what was planned after the failure
            // is not made, and the attempt succeeded — where no other attempt
            // of its invoice is on its way or succeeded.
            await db.subscriptionInvoiceCollection.updateMany({
                where: { invoiceId: row.invoiceId, status: 'SCHEDULED' },
                data: { status: 'WITHDRAWN', resolvedAt: at },
            });
            const others = await db.subscriptionInvoiceCollection.count({
                where: {
                    invoiceId: row.invoiceId,
                    id: { not: id },
                    status: { in: [...UNSETTLED_COLLECTION_STATUSES, 'SUCCEEDED'] },
                },
            });
            if (others > 0) return false;
            const { count } = await db.subscriptionInvoiceCollection.updateMany({
                where: { id, status: 'FAILED' },
                data: collectionOutcomeColumns(outcome, at),
            });
            return count === 1;
        });
    }

    abandonPaid(id: string, at: Date, tx?: TransactionContext): Promise<AbandonPaidOutcome> {
        return this.inTurnOf(id, tx, async (db) => {
            const row = await db.subscriptionInvoiceCollection.findUnique({ where: { id } });
            if (row?.status !== 'SUBMITTED') return 'settled';
            const resend = await owes(db, row.invoiceId);
            // A failure or a pending answer is recorded outside the invoice's
            // turn, so the status read above may be stale: the answer rests on
            // a write conditioned on it, which waits for such a report still
            // being recorded and then finds the attempt settled.
            const { count } = await db.subscriptionInvoiceCollection.updateMany({
                where: { id, status: 'SUBMITTED' },
                data: resend
                    ? { heldAt: at }
                    : collectionOutcomeColumns(COLLECTION_NOT_SENT_PAID, at),
            });
            if (count !== 1) return 'settled';
            return resend ? 'resend' : 'abandoned';
        });
    }

    async hold(id: string, heldBefore: Date, at: Date, tx?: TransactionContext): Promise<boolean> {
        const { count } = await this.db(tx).subscriptionInvoiceCollection.updateMany({
            where: {
                id,
                status: { in: [...UNSETTLED_COLLECTION_STATUSES] },
                heldAt: { lt: heldBefore },
            },
            data: { heldAt: at },
        });
        return count === 1;
    }

    async listUnsettled(
        before: { submittedBefore: Date; pendingBefore: Date },
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        const rows = await this.db(tx).subscriptionInvoiceCollection.findMany({
            where: {
                // An empty text sorts before every id, as in `listDue`.
                id: { gt: page.after ?? '' },
                OR: [
                    { status: 'SUBMITTED', heldAt: { lt: before.submittedBefore } },
                    { status: 'PENDING', heldAt: { lt: before.pendingBefore } },
                ],
            },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: page.limit,
        });
        return rows.map((row) => row.id);
    }

    async findById(id: string, tx?: TransactionContext): Promise<InvoiceCollectionRecord | null> {
        const row = await this.db(tx).subscriptionInvoiceCollection.findUnique({ where: { id } });
        return row ? toInvoiceCollectionRecord(row) : null;
    }

    async findByKey(
        attemptKey: string,
        tx?: TransactionContext,
    ): Promise<InvoiceCollectionRecord | null> {
        const row = await this.db(tx).subscriptionInvoiceCollection.findUnique({
            where: { attemptKey },
        });
        return row ? toInvoiceCollectionRecord(row) : null;
    }

    async accountsInUse(tx?: TransactionContext): Promise<string[]> {
        const rows = await this.db(tx).subscriptionInvoiceCollection.findMany({
            where: { status: { in: [...UNSETTLED_COLLECTION_STATUSES] } },
            select: { gatewayAccount: true },
            distinct: ['gatewayAccount'],
            orderBy: { gatewayAccount: 'asc' },
        });
        return rows.map((row) => row.gatewayAccount);
    }

    async listByInvoice(
        invoiceId: string,
        tx?: TransactionContext,
    ): Promise<InvoiceCollectionRecord[]> {
        const rows = await this.db(tx).subscriptionInvoiceCollection.findMany({
            where: { invoiceId },
            orderBy: { attempt: 'asc' },
        });
        return rows.map(toInvoiceCollectionRecord);
    }
}

/**
 * Whether another invoice of chain `chainId` holds this attempt of
 * `invoiceId` back: one of its attempts is on its way and not settled — no
 * invoice of a chain is collected while one submitted for any of them is
 * unresolved —, or a reversal was made on `paymentMethodId` — nothing of a
 * chain is collected again with a payment method one of its payments was
 * reversed on (`SC-PRIC-036`, `SC-PRIC-085`). The invoice's own attempts are
 * its own `refuses`'s.
 */
async function heldBackByItsChain(
    db: CollectionPrisma,
    chainId: string,
    invoiceId: string,
    paymentMethodId: string,
): Promise<boolean> {
    const rows = await db.$queryRaw`
        SELECT c."id" FROM "subscription_invoice_collections" c
          JOIN "subscription_invoices" o ON o."id" = c."invoiceId"
         WHERE o."chainId" = ${chainId}
           AND c."invoiceId" <> ${invoiceId}
           AND (c."status" = ANY(${OPEN_IN_CHAIN})
                OR (c."status" = 'REVERSED' AND c."paymentMethodId" = ${paymentMethodId}))
         LIMIT 1`;
    return idsOf(rows).length > 0;
}

/**
 * Whether invoice `invoiceId` still owes something: its total exceeds what is
 * settled against it, and it is neither cancelled nor a cancellation invoice.
 * Exact in the database's numeric arithmetic.
 */
async function owes(db: CollectionPrisma, invoiceId: string): Promise<boolean> {
    return (await owedIn(db, invoiceId)) > 0;
}

/**
 * What invoice `invoiceId` still owes: its total less what is settled against
 * it, computed in the database's numeric arithmetic; nothing where it is
 * cancelled, is a cancellation invoice, or is settled.
 */
async function owedIn(db: CollectionPrisma, invoiceId: string): Promise<number> {
    const rows = await db.$queryRaw`
        SELECT (i."totalGross" - COALESCE((
                   SELECT SUM(CASE WHEN s."kind" = ANY(${REOPENING}) THEN -s."amount"
                                   ELSE s."amount" END)
                     FROM "subscription_invoice_settlements" s
                    WHERE s."invoiceId" = i."id"
               ), 0))::text AS "owed"
          FROM "subscription_invoices" i
         WHERE i."id" = ${invoiceId}
           AND NOT EXISTS (
                   SELECT 1 FROM "subscription_invoice_cancellations" x
                    WHERE x."cancelledInvoiceId" = i."id" OR x."cancellationInvoiceId" = i."id"
               )
           AND i."totalGross" > COALESCE((
                   SELECT SUM(CASE WHEN s."kind" = ANY(${REOPENING}) THEN -s."amount"
                                   ELSE s."amount" END)
                     FROM "subscription_invoice_settlements" s
                    WHERE s."invoiceId" = i."id"
               ), 0)`;
    const [owed] = textsOf(rows, 'owed');
    return owed === undefined
        ? 0
        : columnAmountOf(owed, {
              table: 'subscription_invoices',
              column: 'totalGross',
              id: invoiceId,
          });
}
