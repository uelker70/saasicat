import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
    CanonicalSubscriberChargeRow,
    CanonicalSubscriptionInvoiceLineRow,
    CanonicalSubscriptionInvoiceRow,
    NewSubscriptionInvoice,
    SubscriberChargeRecord,
    SubscriptionInvoiceRecord,
    SubscriptionInvoiceRepository,
    TransactionContext,
} from '@saasicat/core';
import {
    formatInvoiceNumber,
    subscriptionInvoiceChargeInvoiced,
    subscriptionInvoiceColumns,
    subscriptionInvoiceLineColumns,
    toSubscriberChargeRecord,
    toSubscriptionInvoiceRecord,
    utcMidnightOf,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

type InvoiceRow = CanonicalSubscriptionInvoiceRow & {
    lines?: CanonicalSubscriptionInvoiceLineRow[];
};

/** Narrow view of the client and of a transaction client, which carry the same delegates. */
interface InvoicePrisma {
    subscriptionInvoice: PrismaModelDelegateLike<InvoiceRow>;
    subscriptionInvoiceLine: PrismaModelDelegateLike<CanonicalSubscriptionInvoiceLineRow>;
    subscriberLedgerEntry: PrismaModelDelegateLike<CanonicalSubscriberChargeRow>;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/** Root-client fields used directly: a delegate and the interactive transaction. */
interface InvoiceRepositoryClient {
    subscriptionInvoice: unknown;
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

const WITH_LINES = { lines: { orderBy: { position: 'asc' } } } as const;

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

    /** On the caller's transaction when there is one, otherwise in one of its own. */
    private inTransaction<T>(
        tx: TransactionContext | undefined,
        fn: (db: InvoicePrisma) => Promise<T>,
    ): Promise<T> {
        if (tx) return fn(this.db(tx));
        return this.prisma.$transaction((own) => fn(own as InvoicePrisma));
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
        const rows = (await this.db(tx).$queryRaw`
            SELECT DISTINCT e."subscriptionId"
              FROM "subscriber_ledger_entries" e
             WHERE e."subscriptionId" > ${after}
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
            where: { subscriptionId, invoiceLine: { is: null } },
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
            const numberSequence = await drawNumber(db, invoice.numberYear);
            const number = formatInvoiceNumber(
                invoice.numberPrefix,
                invoice.numberYear,
                numberSequence,
            );
            const columns = subscriptionInvoiceColumns(invoice, { number, numberSequence });
            const id = randomUUID();
            const row = await db.subscriptionInvoice.create({
                data: {
                    id,
                    ...columns,
                    issueDate: utcMidnightOf(columns.issueDate),
                    dueDate: utcMidnightOf(columns.dueDate),
                    servicePeriodFrom: utcMidnightOf(columns.servicePeriodFrom),
                    servicePeriodUntil: utcMidnightOf(columns.servicePeriodUntil),
                },
            });
            // `ON CONFLICT DO NOTHING` on the unique `chargeId`: a charge another
            // invoice took first is waited for and skipped, and the line that
            // did not come back names it.
            const lines = await db.subscriptionInvoiceLine.createManyAndReturn({
                data: invoice.lines.map((line) => {
                    const lineColumns = subscriptionInvoiceLineColumns(line, id);
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
                const written = new Set(lines.map((line) => line.chargeId));
                const taken = invoice.lines.find((line) => !written.has(line.chargeId));
                throw subscriptionInvoiceChargeInvoiced(taken?.chargeId ?? '');
            }
            return toSubscriptionInvoiceRecord(row, lines);
        });
    }

    async findById(id: string, tx?: TransactionContext): Promise<SubscriptionInvoiceRecord | null> {
        const row = await this.db(tx).subscriptionInvoice.findUnique({
            where: { id },
            include: WITH_LINES,
        });
        return row ? toSubscriptionInvoiceRecord(row, row.lines ?? []) : null;
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
        return rows.map((row) => toSubscriptionInvoiceRecord(row, row.lines ?? []));
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
