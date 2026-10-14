import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
    CalendarDay,
    CanonicalInvoiceCollectionRow,
    CollectionOutcome,
    InvoiceCollectionRecord,
    InvoiceCollectionRepository,
    NewInvoiceCollection,
    TransactionContext,
} from '@saasicat/core';
import {
    UNSETTLED_COLLECTION_STATUSES,
    collectionOutcomeColumns,
    invoiceCollectionColumns,
    toInvoiceCollectionRecord,
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

/** The statuses that keep an invoice from a new attempt: one not settled, or one that succeeded. */
const BLOCKING: ReadonlySet<string> = new Set([...UNSETTLED_COLLECTION_STATUSES, 'SUCCEEDED']);

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

    async startAttempt(
        attempt: NewInvoiceCollection,
        tx?: TransactionContext,
    ): Promise<InvoiceCollectionRecord | null> {
        if (tx) return this.startIn(this.db(tx), attempt);
        return this.prisma.$transaction((own) => this.startIn(this.db(own), attempt));
    }

    private async startIn(
        db: CollectionPrisma,
        attempt: NewInvoiceCollection,
    ): Promise<InvoiceCollectionRecord | null> {
        // The invoice's turn: a second run starting an attempt for it waits
        // here, and then reads the attempt the first one wrote.
        const locked = idsOf(
            await db.$queryRaw`
                SELECT "id" FROM "subscription_invoices"
                 WHERE "id" = ${attempt.invoiceId}
                   FOR UPDATE`,
        );
        if (locked.length === 0) throw new Error(`Invoice ${attempt.invoiceId} does not exist.`);
        const earlier = await db.subscriptionInvoiceCollection.findMany({
            where: { invoiceId: attempt.invoiceId },
            select: { attempt: true, status: true },
        });
        if (earlier.some((row) => BLOCKING.has(row.status))) return null;
        const number = earlier.reduce((last, row) => Math.max(last, row.attempt), 0) + 1;
        // `ON CONFLICT DO NOTHING` without a target, so any of the unique
        // indexes turns a second attempt into no row rather than an error that
        // would end the caller's transaction.
        const [row] = await db.subscriptionInvoiceCollection.createManyAndReturn({
            data: [{ id: randomUUID(), ...invoiceCollectionColumns(attempt, number) }],
            skipDuplicates: true,
        });
        return row ? toInvoiceCollectionRecord(row) : null;
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
