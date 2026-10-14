import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
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
    BLOCKING_COLLECTION_STATUSES,
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

    async submitPlanned(
        id: string,
        at: Date,
        tx?: TransactionContext,
    ): Promise<SubmittedInvoiceCollection | null> {
        const db = this.db(tx);
        const { count } = await db.subscriptionInvoiceCollection.updateMany({
            where: { id, status: 'SCHEDULED' },
            data: { status: 'SUBMITTED', submittedAt: at, heldAt: at },
        });
        if (count !== 1) return null;
        const row = await db.subscriptionInvoiceCollection.findUnique({ where: { id } });
        return row ? sentCollectionOf(toInvoiceCollectionRecord(row)) : null;
    }

    async withdraw(id: string, at: Date, tx?: TransactionContext): Promise<boolean> {
        const { count } = await this.db(tx).subscriptionInvoiceCollection.updateMany({
            where: { id, status: 'SCHEDULED' },
            data: { status: 'WITHDRAWN', resolvedAt: at },
        });
        return count === 1;
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

    async listUncollected(
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        // An empty text sorts before every id, as in `listDue`.
        const after = page.after ?? '';
        const rows = await this.db(tx).$queryRaw`
            SELECT DISTINCT c."invoiceId" AS "id"
              FROM "subscription_invoice_collections" c
             WHERE c."invoiceId" > ${after}
               AND NOT EXISTS (
                       SELECT 1 FROM "subscription_invoice_collections" o
                        WHERE o."invoiceId" = c."invoiceId"
                          AND o."status" = ANY(${[...BLOCKING_COLLECTION_STATUSES]})
                   )
             ORDER BY c."invoiceId"
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
        const { count } = await this.db(tx).subscriptionInvoiceCollection.updateMany({
            where: { id, status: { in: [...UNSETTLED_COLLECTION_STATUSES] } },
            data: collectionOutcomeColumns(outcome, at),
        });
        return count === 1;
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

/** The ids a raw query selected as `id`. */
function idsOf(rows: unknown): string[] {
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row: unknown) => {
        const id: unknown =
            row !== null && typeof row === 'object'
                ? Object.getOwnPropertyDescriptor(row, 'id')?.value
                : undefined;
        return typeof id === 'string' ? [id] : [];
    });
}
