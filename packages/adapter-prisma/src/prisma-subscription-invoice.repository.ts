import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
    CanonicalSubscriberChargeRow,
    CanonicalSubscriptionInvoiceCancellationRow,
    CanonicalSubscriptionInvoiceDocumentRow,
    CanonicalSubscriptionInvoiceLineRow,
    CanonicalSubscriptionInvoiceRow,
    IssuedSubscriptionInvoiceCancellation,
    NewCorrectionInvoice,
    NewInvoiceRendering,
    NewSubscriptionInvoice,
    NewSubscriptionInvoiceCancellation,
    SubscriberChargeRecord,
    SubscriptionInvoiceCancellationRecord,
    SubscriptionInvoiceChain,
    SubscriptionInvoiceDocumentRecord,
    SubscriptionInvoiceRecord,
    SubscriptionInvoiceRepository,
    TransactionContext,
} from '@saasicat/core';
import {
    CORRECTION_ORIGIN,
    formatInvoiceNumber,
    subscriptionInvoiceAlreadyCancelled,
    subscriptionInvoiceCancellationColumns,
    subscriptionInvoiceChainOf,
    subscriptionInvoiceChargeInvoiced,
    subscriptionInvoiceDocumentChanged,
    toSubscriptionInvoiceCancellationRecord,
    toSubscriptionInvoiceDocumentRecord,
    subscriptionInvoiceColumns,
    subscriptionInvoiceLineColumns,
    toSubscriberChargeRecord,
    toSubscriptionInvoiceRecord,
    utcMidnightOf,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';
import { lockChainOf } from './prisma-invoice-chain.js';

/** A cancellation as a read of an invoice takes it, with the invoice it cancels. */
type CancellationOfRow = CanonicalSubscriptionInvoiceCancellationRow & {
    cancelledInvoice: { id: string; number: string; issueDate: unknown };
};

type InvoiceRow = CanonicalSubscriptionInvoiceRow & {
    lines?: CanonicalSubscriptionInvoiceLineRow[];
    /** The cancellation this invoice is the cancellation invoice of. */
    cancels?: CancellationOfRow | null;
    /** The cancellation this invoice is the replacement of. */
    replaces?: CancellationOfRow | null;
};

/** Narrow view of the client and of a transaction client, which carry the same delegates. */
interface InvoicePrisma {
    subscriptionInvoice: PrismaModelDelegateLike<InvoiceRow>;
    subscriptionInvoiceLine: PrismaModelDelegateLike<CanonicalSubscriptionInvoiceLineRow>;
    subscriberLedgerEntry: PrismaModelDelegateLike<CanonicalSubscriberChargeRow>;
    subscriptionInvoiceDocument: PrismaModelDelegateLike<CanonicalSubscriptionInvoiceDocumentRow>;
    subscriptionInvoiceCancellation: PrismaModelDelegateLike<CanonicalSubscriptionInvoiceCancellationRow>;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/** Root-client fields used directly: a delegate and the interactive transaction. */
interface InvoiceRepositoryClient {
    subscriptionInvoice: unknown;
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

/** The invoice it cancels, as a cancellation invoice or a replacement names it. */
const CANCELLED = {
    include: { cancelledInvoice: { select: { id: true, number: true, issueDate: true } } },
} as const;

/** What a read of an invoice takes with it: its lines, and what it corrects. */
const WITH_LINES = {
    lines: { orderBy: { position: 'asc' } },
    cancels: CANCELLED,
    replaces: CANCELLED,
} as const;

/** An invoice row read with `WITH_LINES`, as a record. */
function recordOf(row: InvoiceRow): SubscriptionInvoiceRecord {
    const correcting = row.cancels ?? row.replaces ?? null;
    return toSubscriptionInvoiceRecord(
        row,
        row.lines ?? [],
        correcting && { cancellation: correcting, cancelled: correcting.cancelledInvoice },
    );
}

/**
 * `SubscriptionInvoiceRepository` against `subscription_invoices`,
 * `subscription_invoice_lines` and `subscription_invoice_numbers`.
 *
 * An invoice's number is drawn by raising its year's row in
 * `subscription_invoice_numbers` in the transaction that writes the invoice:
 * the `UPDATE` holds that row until the transaction ends, so a second invoice
 * waits for the first and takes the next number, and one that is not written
 * hands its number back with everything else it wrote.
 */
@Injectable()
export class PrismaSubscriptionInvoiceRepository implements SubscriptionInvoiceRepository {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: InvoiceRepositoryClient,
    ) {}

    private db(tx?: TransactionContext): InvoicePrisma {
        return (tx ?? this.prisma) as unknown as InvoicePrisma;
    }

    /**
     * In a transaction of its own, or on the caller's inside a savepoint: what
     * `fn` wrote is undone with any error it throws either way, so a caller
     * that catches the error and commits keeps nothing of it. A refusal is
     * thrown after statements that succeeded — the number drawn, the invoice
     * written — and without the savepoint they would stay on the caller's
     * transaction.
     */
    private inTransaction<T>(
        tx: TransactionContext,
        fn: (db: InvoicePrisma) => Promise<T>,
    ): Promise<T> {
        if (!tx) return this.prisma.$transaction((own) => fn(own as InvoicePrisma));
        return onSavepoint(this.db(tx), fn);
    }

    /**
     * A subscription counts for a charge on no invoice whose group — the
     * charges booked at the same moment under the same contract, which one
     * invoice issues together — carries an amount: a group that is all zero
     * issues no invoice (`SC-PRIC-048`), and counting it would let free plans
     * fill every page.
     */
    async listSubscriptionsWithUninvoicedCharges(
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        // An empty text sorts before every id, so no `after` reads from the start.
        const after = page.after ?? '';
        // SAFETY: the statement selects one column, "subscriptionId", a NOT NULL
        // text of subscriber_ledger_entries, so each row is that and nothing else.
        const rows = (await this.db(tx).$queryRaw`
            SELECT DISTINCT e."subscriptionId"
              FROM "subscriber_ledger_entries" e
             WHERE e."subscriptionId" > ${after}
               AND e."origin" <> ${CORRECTION_ORIGIN}
               AND NOT EXISTS (
                       SELECT 1 FROM "subscription_invoice_lines" l
                        WHERE l."chargeId" = e."id"
                   )
             GROUP BY e."subscriptionId", e."contractId", e."bookedAt"
            HAVING bool_or(e."amountNet" <> 0)
             ORDER BY e."subscriptionId"
             LIMIT ${page.limit}`) as { subscriptionId: string }[];
        return rows.map((row) => row.subscriptionId);
    }

    async listUninvoicedCharges(
        subscriptionId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberChargeRecord[]> {
        const rows = await this.db(tx).subscriberLedgerEntry.findMany({
            where: {
                subscriptionId,
                invoiceLines: { none: {} },
                origin: { not: CORRECTION_ORIGIN },
            },
            orderBy: [
                { periodStart: 'asc' },
                { source: 'asc' },
                { sourceRef: 'asc' },
                { origin: 'asc' },
            ],
        });
        return rows.map(toSubscriberChargeRecord);
    }

    async issue(
        invoice: NewSubscriptionInvoice,
        tx?: TransactionContext,
    ): Promise<SubscriptionInvoiceRecord> {
        return this.inTransaction(tx, async (db) => {
            const id = randomUUID();
            // An invoice issued on the journal's charges begins a chain of its own.
            const { row, lines } = await writeInvoice(db, invoice, {
                id,
                chainId: id,
                chainStep: 0,
            });
            return toSubscriptionInvoiceRecord(row, lines);
        });
    }

    async findById(id: string, tx?: TransactionContext): Promise<SubscriptionInvoiceRecord | null> {
        const row = await this.db(tx).subscriptionInvoice.findUnique({
            where: { id },
            include: WITH_LINES,
        });
        return row ? recordOf(row) : null;
    }

    async holdChain(
        invoiceId: string,
        tx: TransactionContext,
    ): Promise<SubscriptionInvoiceChain | null> {
        const db = this.db(tx);
        const chainId = await lockChainOf(db, invoiceId);
        if (chainId === null) return null;
        const rows = await db.subscriptionInvoice.findMany({
            where: { chainId },
            include: WITH_LINES,
            orderBy: { chainStep: 'asc' },
        });
        const cancellations = await db.subscriptionInvoiceCancellation.findMany({
            where: { cancelledInvoiceId: { in: rows.map((row) => row.id) } },
        });
        return subscriptionInvoiceChainOf(
            rows.map(recordOf),
            cancellations.map(toSubscriptionInvoiceCancellationRecord),
        );
    }

    async issueCancellation(
        write: NewSubscriptionInvoiceCancellation,
        tx: TransactionContext,
    ): Promise<IssuedSubscriptionInvoiceCancellation> {
        return onSavepoint(this.db(tx), async (db) => {
            const cancelled = await db.subscriptionInvoice.findUnique({
                where: { id: write.cancelledInvoiceId },
                select: { id: true, number: true, issueDate: true, chainId: true, chainStep: true },
            });
            if (!cancelled) throw new Error(`Invoice ${write.cancelledInvoiceId} does not exist.`);
            if (
                await db.subscriptionInvoiceCancellation.findUnique({
                    where: { cancelledInvoiceId: cancelled.id },
                })
            ) {
                throw subscriptionInvoiceAlreadyCancelled(cancelled.number);
            }
            const cancellationId = randomUUID();
            const cancellation = await writeInvoice(db, write.cancellation, {
                id: randomUUID(),
                chainId: cancelled.chainId,
                chainStep: cancelled.chainStep + 1,
            });
            const replacement =
                write.replacement &&
                (await writeInvoice(db, write.replacement, {
                    id: randomUUID(),
                    chainId: cancelled.chainId,
                    chainStep: cancelled.chainStep + 2,
                }));
            const { correctedSubscriber, ...columns } = subscriptionInvoiceCancellationColumns(
                write,
                {
                    id: cancellationId,
                    cancellationInvoiceId: cancellation.row.id,
                    replacementInvoiceId: replacement?.row.id ?? null,
                },
            );
            // No plain null for a JSON column, as `writeInvoice` says: a
            // cancellation that corrected nothing carries no
            // `correctedSubscriber`, and the column keeps NULL.
            const [row] = await db.subscriptionInvoiceCancellation.createManyAndReturn({
                data: [
                    correctedSubscriber === null ? columns : { ...columns, correctedSubscriber },
                ],
                skipDuplicates: true,
            });
            // The unique invoice cancelled holds a second cancellation off,
            // even one that did not take the chain's turn first.
            if (!row) throw subscriptionInvoiceAlreadyCancelled(cancelled.number);
            const correction = { cancellation: row, cancelled };
            return {
                cancellation: toSubscriptionInvoiceCancellationRecord(row),
                cancellationInvoice: toSubscriptionInvoiceRecord(
                    cancellation.row,
                    cancellation.lines,
                    correction,
                ),
                replacement:
                    replacement &&
                    toSubscriptionInvoiceRecord(replacement.row, replacement.lines, correction),
            };
        });
    }

    async findCancellation(
        invoiceId: string,
        tx?: TransactionContext,
    ): Promise<SubscriptionInvoiceCancellationRecord | null> {
        const db = this.db(tx);
        // Its own cancellation first: a replacement cancelled in turn is named
        // by two.
        const row =
            (await db.subscriptionInvoiceCancellation.findUnique({
                where: { cancelledInvoiceId: invoiceId },
            })) ??
            (await db.subscriptionInvoiceCancellation.findFirst({
                where: {
                    OR: [{ cancellationInvoiceId: invoiceId }, { replacementInvoiceId: invoiceId }],
                },
            }));
        return row ? toSubscriptionInvoiceCancellationRecord(row) : null;
    }

    async findCancellationById(
        cancellationId: string,
        tx?: TransactionContext,
    ): Promise<SubscriptionInvoiceCancellationRecord | null> {
        const row = await this.db(tx).subscriptionInvoiceCancellation.findUnique({
            where: { id: cancellationId },
        });
        return row ? toSubscriptionInvoiceCancellationRecord(row) : null;
    }

    async listBySubscriber(
        subscriberId: string,
        tx?: TransactionContext,
    ): Promise<SubscriptionInvoiceRecord[]> {
        const rows = await this.db(tx).subscriptionInvoice.findMany({
            where: { subscriberId },
            include: WITH_LINES,
            orderBy: [{ numberYear: 'desc' }, { numberSequence: 'desc' }],
        });
        return rows.map(recordOf);
    }

    async listIssuedNumberPrefixes(tx?: TransactionContext): Promise<string[]> {
        const rows = await this.db(tx).subscriptionInvoice.findMany({
            distinct: ['numberPrefix'],
            select: { numberPrefix: true },
            orderBy: { numberPrefix: 'asc' },
            take: 2,
        });
        return rows.map((row) => row.numberPrefix);
    }

    async recordRendering(
        invoiceId: string,
        rendering: NewInvoiceRendering,
        tx?: TransactionContext,
    ): Promise<SubscriptionInvoiceDocumentRecord> {
        const db = this.db(tx);
        // `ON CONFLICT DO NOTHING` on the invoice: a rendering recorded before
        // stays, and the one asked for now is compared with it.
        const [written] = await db.subscriptionInvoiceDocument.createManyAndReturn({
            data: [{ invoiceId, ...rendering }],
            skipDuplicates: true,
        });
        const row =
            written ?? (await db.subscriptionInvoiceDocument.findUnique({ where: { invoiceId } }));
        if (!row)
            throw new Error(`The rendering of invoice ${invoiceId} was neither written nor found.`);
        if (row.checksum !== rendering.checksum) {
            throw subscriptionInvoiceDocumentChanged(invoiceId, row.checksum, rendering.checksum);
        }
        return toSubscriptionInvoiceDocumentRecord(row);
    }

    async replaceRendering(
        invoiceId: string,
        rendering: NewInvoiceRendering,
        replaced: string,
        tx?: TransactionContext,
    ): Promise<SubscriptionInvoiceDocumentRecord | null> {
        const db = this.db(tx);
        const { count } = await db.subscriptionInvoiceDocument.updateMany({
            where: { invoiceId, checksum: replaced, archivedAt: null },
            data: { ...rendering },
        });
        if (count !== 1) return null;
        const row = await db.subscriptionInvoiceDocument.findUnique({ where: { invoiceId } });
        return row ? toSubscriptionInvoiceDocumentRecord(row) : null;
    }

    async markArchived(
        invoiceId: string,
        at: Date,
        checksum: string,
        tx?: TransactionContext,
    ): Promise<boolean> {
        const { count } = await this.db(tx).subscriptionInvoiceDocument.updateMany({
            where: { invoiceId, checksum, archivedAt: null },
            data: { archivedAt: at },
        });
        return count === 1;
    }

    async claimDelivery(
        invoiceId: string,
        at: Date,
        staleBefore: Date,
        tx?: TransactionContext,
    ): Promise<boolean> {
        // One conditional UPDATE: a second one waiting on the row's lock reads
        // the claim the first wrote, and takes nothing.
        const { count } = await this.db(tx).subscriptionInvoiceDocument.updateMany({
            where: {
                invoiceId,
                archivedAt: { not: null },
                deliveredAt: null,
                OR: [{ deliveryClaimedAt: null }, { deliveryClaimedAt: { lt: staleBefore } }],
            },
            data: { deliveryClaimedAt: at },
        });
        return count === 1;
    }

    async markDelivered(
        invoiceId: string,
        delivery: { claimedAt: Date; at: Date; to: string },
        tx?: TransactionContext,
    ): Promise<boolean> {
        const { count } = await this.db(tx).subscriptionInvoiceDocument.updateMany({
            where: {
                invoiceId,
                archivedAt: { not: null },
                deliveredAt: null,
                deliveryClaimedAt: delivery.claimedAt,
            },
            data: { deliveredAt: delivery.at, deliveredTo: delivery.to },
        });
        return count === 1;
    }

    async releaseDelivery(
        invoiceId: string,
        claimedAt: Date,
        tx?: TransactionContext,
    ): Promise<void> {
        await this.db(tx).subscriptionInvoiceDocument.updateMany({
            where: { invoiceId, deliveredAt: null, deliveryClaimedAt: claimedAt },
            data: { deliveryClaimedAt: null },
        });
    }

    async findDocument(
        invoiceId: string,
        tx?: TransactionContext,
    ): Promise<SubscriptionInvoiceDocumentRecord | null> {
        const row = await this.db(tx).subscriptionInvoiceDocument.findUnique({
            where: { invoiceId },
        });
        return row ? toSubscriptionInvoiceDocumentRecord(row) : null;
    }

    async listAwaitingDocument(
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        const rows = await this.db(tx).subscriptionInvoice.findMany({
            where: {
                ...(page.after === undefined ? {} : { id: { gt: page.after } }),
                OR: [{ document: { is: null } }, { document: { is: { archivedAt: null } } }],
            },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: page.limit,
        });
        return rows.map((row) => row.id);
    }

    async listAwaitingDelivery(
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        const rows = await this.db(tx).subscriptionInvoiceDocument.findMany({
            where: {
                ...(page.after === undefined ? {} : { invoiceId: { gt: page.after } }),
                archivedAt: { not: null },
                deliveredAt: null,
            },
            select: { invoiceId: true },
            orderBy: { invoiceId: 'asc' },
            take: page.limit,
        });
        return rows.map((row) => row.invoiceId);
    }

    async listArchivedDocuments(
        invoiceIds: readonly string[],
        tx?: TransactionContext,
    ): Promise<string[]> {
        if (invoiceIds.length === 0) return [];
        const rows = await this.db(tx).subscriptionInvoiceDocument.findMany({
            where: { invoiceId: { in: [...invoiceIds] }, archivedAt: { not: null } },
            select: { invoiceId: true },
            orderBy: { invoiceId: 'asc' },
        });
        return rows.map((row) => row.invoiceId);
    }
}

/**
 * Draws the invoice's number and writes it with its lines where `placed` puts
 * it in its chain. Refused, by a throw that takes its savepoint back, where a
 * charge stands on a line at the same step of a chain already.
 */
async function writeInvoice(
    db: InvoicePrisma,
    invoice: NewSubscriptionInvoice | NewCorrectionInvoice,
    placed: { id: string; chainId: string; chainStep: number },
): Promise<{ row: InvoiceRow; lines: CanonicalSubscriptionInvoiceLineRow[] }> {
    const numberSequence = await drawNumber(db, invoice.numberYear);
    const number = formatInvoiceNumber(invoice.numberPrefix, invoice.numberYear, numberSequence);
    const { payment, collectionDate, ...columns } = subscriptionInvoiceColumns(invoice, {
        ...placed,
        number,
        numberSequence,
    });
    const written = {
        ...columns,
        issueDate: utcMidnightOf(columns.issueDate),
        dueDate: utcMidnightOf(columns.dueDate),
        servicePeriodFrom: utcMidnightOf(columns.servicePeriodFrom),
        servicePeriodUntil: utcMidnightOf(columns.servicePeriodUntil),
        collectionDate: collectionDate === null ? null : utcMidnightOf(collectionDate),
    };
    // Prisma takes no plain null for a JSON column, this package has no
    // `DbNull` to give it instead, and a client with `strictUndefinedChecks`
    // refuses a field set to `undefined`. An invoice that is not collected
    // therefore carries no `payment` at all, and the column keeps its default,
    // NULL.
    const row = await db.subscriptionInvoice.create({
        data: payment === null ? written : { ...written, payment },
    });
    // `ON CONFLICT DO NOTHING` on the unique (`chargeId`, `chainStep`): a charge
    // another invoice took first is waited for and skipped, and the line that
    // did not come back names it.
    const lines = await db.subscriptionInvoiceLine.createManyAndReturn({
        data: invoice.lines.map((line) => {
            const lineColumns = subscriptionInvoiceLineColumns(line, placed.id, placed.chainStep);
            return {
                id: randomUUID(),
                ...lineColumns,
                periodFrom: utcMidnightOf(lineColumns.periodFrom),
                periodUntil: utcMidnightOf(lineColumns.periodUntil),
            };
        }),
        skipDuplicates: true,
    });
    if (lines.length < invoice.lines.length) {
        const kept = new Set(lines.map((line) => line.chargeId));
        const taken = invoice.lines.find((line) => !kept.has(line.chargeId));
        throw subscriptionInvoiceChargeInvoiced(taken?.chargeId ?? '');
    }
    return { row, lines };
}

/** Runs `fn` inside a savepoint of the transaction `db` is on, rolled back to it on any error. */
async function onSavepoint<T>(
    db: InvoicePrisma,
    fn: (db: InvoicePrisma) => Promise<T>,
): Promise<T> {
    await db.$executeRaw`SAVEPOINT "subscription_invoice_issue"`;
    let result: T;
    try {
        result = await fn(db);
    } catch (error) {
        await db.$executeRaw`ROLLBACK TO SAVEPOINT "subscription_invoice_issue"`;
        throw error;
    }
    await db.$executeRaw`RELEASE SAVEPOINT "subscription_invoice_issue"`;
    return result;
}

/**
 * The next number of `year`: the year's row is made where it is missing, then
 * raised, and the `UPDATE` keeps it locked until the transaction ends.
 */
async function drawNumber(db: InvoicePrisma, year: number): Promise<number> {
    await db.$executeRaw`
        INSERT INTO "subscription_invoice_numbers" ("year", "last") VALUES (${year}, 0)
        ON CONFLICT ("year") DO NOTHING`;
    const [drawn] = (await db.$queryRaw`
        UPDATE "subscription_invoice_numbers" SET "last" = "last" + 1
         WHERE "year" = ${year}
     RETURNING "last"`) as { last: number }[];
    if (!drawn) throw new Error(`subscription_invoice_numbers has no row for ${year}.`);
    return Number(drawn.last);
}
