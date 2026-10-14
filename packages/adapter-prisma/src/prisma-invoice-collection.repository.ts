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
    UNSETTLED_COLLECTION_STATUSES,
    collectionOutcomeColumns,
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
import { idsOf } from './raw-ids.js';

/** Narrow view of the client and of a transaction client, which carry the same delegates. */
interface CollectionPrisma {
    subscriptionInvoiceCollection: PrismaModelDelegateLike<CanonicalInvoiceCollectionRow>;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/** The root client's interactive transaction. */
interface CollectionRepositoryClient {
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

/**
 * `InvoiceCollectionRepository` against `subscription_invoice_collections`.
 *
 * An attempt is started in the invoice's turn — its row in
 * `subscription_invoices`, locked for the transaction — and every write that
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
            (number) => invoiceCollectionColumns(attempt, number),
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
            (number) => plannedCollectionColumns(plan, number),
            tx,
        );
    }

    /** Writes the invoice's next attempt in its turn, unless what it holds by then `refuses` it. */
    private writeNext(
        invoiceId: string,
        refuses: (earlier: readonly EarlierCollection[]) => boolean,
        columns: (number: number) => InvoiceCollectionColumns,
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
        columns: (number: number) => InvoiceCollectionColumns,
    ): Promise<InvoiceCollectionRecord | null> {
        // The invoice's turn: a second run writing an attempt for it waits
        // here, and then reads the attempt the first one wrote.
        const locked = idsOf(
            await db.$queryRaw`
                SELECT "id" FROM "subscription_invoices"
                 WHERE "id" = ${invoiceId}
                   FOR UPDATE`,
        );
        if (locked.length === 0) throw new Error(`Invoice ${invoiceId} does not exist.`);
        // An invoice that owes nothing — a payment came for it — is collected
        // no further.
        if (!(await owes(db, invoiceId))) return null;
        const earlier = await db.subscriptionInvoiceCollection.findMany({
            where: { invoiceId },
            select: { attempt: true, status: true },
        });
        if (refuses(earlier)) return null;
        const number = lastCollectionOf(earlier) + 1;
        const { collectOn, ...written } = columns(number);
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
                           SELECT c."invoiceId" FROM "subscription_invoice_collections" c
                            WHERE c."id" = ${id}
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
            where: { id: { gt: page.after ?? '' }, status: 'FAILED', followedUpAt: null },
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
                    OR (c."status" = 'FAILED' AND c."followedUpAt" IS NOT NULL))
               AND m."id" <> c."paymentMethodId"
               AND i."totalGross" > COALESCE((
                       SELECT SUM(s."amount") FROM "subscription_invoice_settlements" s
                        WHERE s."invoiceId" = i."id"
                   ), 0)
             ORDER BY i."id"
             LIMIT ${page.limit}`;
        return idsOf(rows);
    }

    async markFollowedUp(id: string, at: Date, tx?: TransactionContext): Promise<boolean> {
        const { count } = await this.db(tx).subscriptionInvoiceCollection.updateMany({
            where: { id, status: 'FAILED', followedUpAt: null },
            data: { followedUpAt: at },
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
            if (await owes(db, row.invoiceId)) return 'resend';
            const { count } = await db.subscriptionInvoiceCollection.updateMany({
                where: { id, status: 'SUBMITTED' },
                data: collectionOutcomeColumns(COLLECTION_NOT_SENT_PAID, at),
            });
            return count === 1 ? 'abandoned' : 'settled';
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
 * Whether invoice `invoiceId` still owes something: its total exceeds what is
 * settled against it. Exact in the database's numeric arithmetic.
 */
async function owes(db: CollectionPrisma, invoiceId: string): Promise<boolean> {
    const rows = await db.$queryRaw`
        SELECT i."id" FROM "subscription_invoices" i
         WHERE i."id" = ${invoiceId}
           AND i."totalGross" > COALESCE((
                   SELECT SUM(s."amount") FROM "subscription_invoice_settlements" s
                    WHERE s."invoiceId" = i."id"
               ), 0)`;
    return idsOf(rows).length === 1;
}
