import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type {
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
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import {
    subscriberLedgerEntries,
    subscriptionInvoiceLines,
    subscriptionInvoiceNumbers,
    subscriptionInvoices,
} from './schema.js';

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
export class DrizzleSubscriptionInvoiceRepository implements SubscriptionInvoiceRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

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
        const rows = await resolveDb(this.db, tx)
            .selectDistinct({ subscriptionId: subscriberLedgerEntries.subscriptionId })
            .from(subscriberLedgerEntries)
            .leftJoin(
                subscriptionInvoiceLines,
                eq(subscriptionInvoiceLines.chargeId, subscriberLedgerEntries.id),
            )
            .where(
                and(
                    isNull(subscriptionInvoiceLines.id),
                    page.after === undefined
                        ? undefined
                        : gt(subscriberLedgerEntries.subscriptionId, page.after),
                ),
            )
            .groupBy(
                subscriberLedgerEntries.subscriptionId,
                subscriberLedgerEntries.contractId,
                subscriberLedgerEntries.bookedAt,
            )
            .having(sql`bool_or(${subscriberLedgerEntries.amountNet} <> 0)`)
            .orderBy(asc(subscriberLedgerEntries.subscriptionId))
            .limit(page.limit);
        return rows.map((row) => row.subscriptionId);
    }

    async listUninvoicedCharges(
        subscriptionId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberChargeRecord[]> {
        const rows = await resolveDb(this.db, tx)
            .select({ charge: subscriberLedgerEntries })
            .from(subscriberLedgerEntries)
            .leftJoin(
                subscriptionInvoiceLines,
                eq(subscriptionInvoiceLines.chargeId, subscriberLedgerEntries.id),
            )
            .where(
                and(
                    eq(subscriberLedgerEntries.subscriptionId, subscriptionId),
                    isNull(subscriptionInvoiceLines.id),
                ),
            )
            .orderBy(
                asc(subscriberLedgerEntries.periodStart),
                asc(subscriberLedgerEntries.source),
                asc(subscriberLedgerEntries.sourceRef),
                asc(subscriberLedgerEntries.origin),
            );
        return rows.map((row) => toSubscriberChargeRecord(row.charge));
    }

    async issue(
        invoice: NewSubscriptionInvoice,
        tx?: TransactionContext,
    ): Promise<SubscriptionInvoiceRecord> {
        // On the caller's transaction this is a savepoint, so a refusal rolls
        // back the number it drew and keeps whatever the caller wrote before.
        return resolveDb(this.db, tx).transaction(async (transaction) => {
            const db = transaction as unknown as DrizzleClient;
            const numberSequence = await drawNumber(db, invoice.numberYear);
            const number = formatInvoiceNumber(
                invoice.numberPrefix,
                invoice.numberYear,
                numberSequence,
            );
            const id = randomUUID();
            const [row] = await db
                .insert(subscriptionInvoices)
                .values({ id, ...subscriptionInvoiceColumns(invoice, { number, numberSequence }) })
                .returning();
            // `ON CONFLICT DO NOTHING` on the unique `chargeId`: a charge another
            // invoice took first is waited for and skipped, and the line that
            // did not come back names it.
            const lines = await db
                .insert(subscriptionInvoiceLines)
                .values(
                    invoice.lines.map((line) => ({
                        id: randomUUID(),
                        ...subscriptionInvoiceLineColumns(line, id),
                    })),
                )
                .onConflictDoNothing({ target: subscriptionInvoiceLines.chargeId })
                .returning();
            if (lines.length < invoice.lines.length) {
                const written = new Set(lines.map((line) => line.chargeId));
                const taken = invoice.lines.find((line) => !written.has(line.chargeId));
                throw subscriptionInvoiceChargeInvoiced(taken?.chargeId ?? '');
            }
            return toSubscriptionInvoiceRecord(row!, lines);
        });
    }

    async findById(id: string, tx?: TransactionContext): Promise<SubscriptionInvoiceRecord | null> {
        const db = resolveDb(this.db, tx);
        const [row] = await db
            .select()
            .from(subscriptionInvoices)
            .where(eq(subscriptionInvoices.id, id))
            .limit(1);
        if (!row) return null;
        const lines = await db
            .select()
            .from(subscriptionInvoiceLines)
            .where(eq(subscriptionInvoiceLines.invoiceId, id))
            .orderBy(asc(subscriptionInvoiceLines.position));
        return toSubscriptionInvoiceRecord(row, lines);
    }

    async listBySubscriber(
        subscriberId: string,
        tx?: TransactionContext,
    ): Promise<SubscriptionInvoiceRecord[]> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .select()
            .from(subscriptionInvoices)
            .where(eq(subscriptionInvoices.subscriberId, subscriberId))
            .orderBy(
                desc(subscriptionInvoices.numberYear),
                desc(subscriptionInvoices.numberSequence),
            );
        if (rows.length === 0) return [];
        const lines = await db
            .select()
            .from(subscriptionInvoiceLines)
            .where(
                inArray(
                    subscriptionInvoiceLines.invoiceId,
                    rows.map((row) => row.id),
                ),
            )
            .orderBy(asc(subscriptionInvoiceLines.position));
        return rows.map((row) =>
            toSubscriptionInvoiceRecord(
                row,
                lines.filter((line) => line.invoiceId === row.id),
            ),
        );
    }

    async listIssuedNumberPrefixes(tx?: TransactionContext): Promise<string[]> {
        const rows = await resolveDb(this.db, tx)
            .selectDistinct({ numberPrefix: subscriptionInvoices.numberPrefix })
            .from(subscriptionInvoices)
            .orderBy(asc(subscriptionInvoices.numberPrefix))
            .limit(2);
        return rows.map((row) => row.numberPrefix);
    }
}

/**
 * The next number of `year`: the year's row is made where it is missing, then
 * raised, and the `UPDATE` keeps it locked until the transaction ends.
 */
async function drawNumber(db: DrizzleClient, year: number): Promise<number> {
    await db
        .insert(subscriptionInvoiceNumbers)
        .values({ year, last: 0 })
        .onConflictDoNothing({ target: subscriptionInvoiceNumbers.year });
    const [drawn] = await db
        .update(subscriptionInvoiceNumbers)
        .set({ last: sql`${subscriptionInvoiceNumbers.last} + 1` })
        .where(eq(subscriptionInvoiceNumbers.year, year))
        .returning({ last: subscriptionInvoiceNumbers.last });
    if (!drawn) throw new Error(`subscription_invoice_numbers has no row for ${year}.`);
    return drawn.last;
}
