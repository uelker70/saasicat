import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
    and,
    asc,
    eq,
    gt,
    inArray,
    isNotNull,
    isNull,
    lt,
    lte,
    notExists,
    or,
    sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
    CalendarDay,
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
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import {
    subscriptionInvoiceCollections,
    subscriptionInvoiceDocuments,
    subscriptionInvoices,
} from './schema.js';

/** Another invoice's attempts, beside the ones a query lists. */
const others = alias(subscriptionInvoiceCollections, 'others');

/**
 * `InvoiceCollectionRepository` against `subscription_invoice_collections`.
 *
 * An attempt is started in the invoice's turn — its row in
 * `subscription_invoices`, locked for the transaction — and every write that
 * settles or takes on an attempt is one conditional `UPDATE` naming the state
 * it expects, so of two runs one wins and the other is told.
 */
@Injectable()
export class DrizzleInvoiceCollectionRepository implements InvoiceCollectionRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async listDue(
        today: CalendarDay,
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .select({ id: subscriptionInvoices.id })
            .from(subscriptionInvoices)
            .innerJoin(
                subscriptionInvoiceDocuments,
                eq(subscriptionInvoiceDocuments.invoiceId, subscriptionInvoices.id),
            )
            .where(
                and(
                    page.after === undefined ? undefined : gt(subscriptionInvoices.id, page.after),
                    isNotNull(subscriptionInvoices.payment),
                    isNotNull(subscriptionInvoiceDocuments.deliveredAt),
                    or(
                        isNull(subscriptionInvoices.collectionDate),
                        lte(subscriptionInvoices.collectionDate, today),
                    ),
                    notExists(
                        db
                            .select({ one: sql`1` })
                            .from(subscriptionInvoiceCollections)
                            .where(
                                eq(
                                    subscriptionInvoiceCollections.invoiceId,
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
    private async writeNext(
        invoiceId: string,
        refuses: (earlier: readonly EarlierCollection[]) => boolean,
        columns: (number: number) => InvoiceCollectionColumns,
        tx?: TransactionContext,
    ): Promise<InvoiceCollectionRecord | null> {
        // On the caller's transaction this is a savepoint.
        return resolveDb(this.db, tx).transaction(async (transaction) => {
            const db = resolveDb(this.db, transaction);
            // The invoice's turn: a second run writing an attempt for it
            // waits here, and then reads the attempt the first one wrote.
            const [invoice] = await db
                .select({ id: subscriptionInvoices.id })
                .from(subscriptionInvoices)
                .where(eq(subscriptionInvoices.id, invoiceId))
                .for('update');
            if (!invoice) throw new Error(`Invoice ${invoiceId} does not exist.`);
            const earlier = await db
                .select({
                    attempt: subscriptionInvoiceCollections.attempt,
                    status: subscriptionInvoiceCollections.status,
                })
                .from(subscriptionInvoiceCollections)
                .where(eq(subscriptionInvoiceCollections.invoiceId, invoiceId));
            if (refuses(earlier)) return null;
            const number = lastCollectionOf(earlier) + 1;
            // Untargeted, so any of the unique indexes turns a second attempt
            // into no row rather than an error that would end the transaction.
            const [row] = await db
                .insert(subscriptionInvoiceCollections)
                .values({ id: randomUUID(), ...columns(number) })
                .onConflictDoNothing()
                .returning();
            return row ? toInvoiceCollectionRecord(row) : null;
        });
    }

    async announce(
        id: string,
        collectOn: CalendarDay,
        at: Date,
        tx?: TransactionContext,
    ): Promise<boolean> {
        const rows = await resolveDb(this.db, tx)
            .update(subscriptionInvoiceCollections)
            .set({ collectOn, announcedAt: at })
            .where(
                and(
                    eq(subscriptionInvoiceCollections.id, id),
                    eq(subscriptionInvoiceCollections.status, 'SCHEDULED'),
                    isNull(subscriptionInvoiceCollections.announcedAt),
                ),
            )
            .returning({ id: subscriptionInvoiceCollections.id });
        return rows.length === 1;
    }

    async submitPlanned(
        id: string,
        at: Date,
        tx?: TransactionContext,
    ): Promise<SubmittedInvoiceCollection | null> {
        const [row] = await resolveDb(this.db, tx)
            .update(subscriptionInvoiceCollections)
            .set({ status: 'SUBMITTED', submittedAt: at, heldAt: at })
            .where(
                and(
                    eq(subscriptionInvoiceCollections.id, id),
                    eq(subscriptionInvoiceCollections.status, 'SCHEDULED'),
                ),
            )
            .returning();
        return row ? sentCollectionOf(toInvoiceCollectionRecord(row)) : null;
    }

    async withdraw(id: string, at: Date, tx?: TransactionContext): Promise<boolean> {
        const rows = await resolveDb(this.db, tx)
            .update(subscriptionInvoiceCollections)
            .set({ status: 'WITHDRAWN', resolvedAt: at })
            .where(
                and(
                    eq(subscriptionInvoiceCollections.id, id),
                    eq(subscriptionInvoiceCollections.status, 'SCHEDULED'),
                ),
            )
            .returning({ id: subscriptionInvoiceCollections.id });
        return rows.length === 1;
    }

    async listPlanned(
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        const rows = await resolveDb(this.db, tx)
            .select({ id: subscriptionInvoiceCollections.id })
            .from(subscriptionInvoiceCollections)
            .where(
                and(
                    page.after === undefined
                        ? undefined
                        : gt(subscriptionInvoiceCollections.id, page.after),
                    eq(subscriptionInvoiceCollections.status, 'SCHEDULED'),
                ),
            )
            .orderBy(asc(subscriptionInvoiceCollections.id))
            .limit(page.limit);
        return rows.map((row) => row.id);
    }

    async listUncollected(
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .selectDistinct({ invoiceId: subscriptionInvoiceCollections.invoiceId })
            .from(subscriptionInvoiceCollections)
            .where(
                and(
                    page.after === undefined
                        ? undefined
                        : gt(subscriptionInvoiceCollections.invoiceId, page.after),
                    notExists(
                        db
                            .select({ one: sql`1` })
                            .from(others)
                            .where(
                                and(
                                    eq(others.invoiceId, subscriptionInvoiceCollections.invoiceId),
                                    inArray(others.status, [...BLOCKING_COLLECTION_STATUSES]),
                                ),
                            ),
                    ),
                ),
            )
            .orderBy(asc(subscriptionInvoiceCollections.invoiceId))
            .limit(page.limit);
        return rows.map((row) => row.invoiceId);
    }

    async markFollowedUp(id: string, at: Date, tx?: TransactionContext): Promise<boolean> {
        const rows = await resolveDb(this.db, tx)
            .update(subscriptionInvoiceCollections)
            .set({ followedUpAt: at })
            .where(
                and(
                    eq(subscriptionInvoiceCollections.id, id),
                    eq(subscriptionInvoiceCollections.status, 'FAILED'),
                    isNull(subscriptionInvoiceCollections.followedUpAt),
                ),
            )
            .returning({ id: subscriptionInvoiceCollections.id });
        return rows.length === 1;
    }

    async recordOutcome(
        id: string,
        outcome: CollectionOutcome,
        at: Date,
        tx?: TransactionContext,
    ): Promise<boolean> {
        const rows = await resolveDb(this.db, tx)
            .update(subscriptionInvoiceCollections)
            .set(collectionOutcomeColumns(outcome, at))
            .where(
                and(
                    eq(subscriptionInvoiceCollections.id, id),
                    inArray(subscriptionInvoiceCollections.status, [
                        ...UNSETTLED_COLLECTION_STATUSES,
                    ]),
                ),
            )
            .returning({ id: subscriptionInvoiceCollections.id });
        return rows.length === 1;
    }

    async hold(id: string, heldBefore: Date, at: Date, tx?: TransactionContext): Promise<boolean> {
        const rows = await resolveDb(this.db, tx)
            .update(subscriptionInvoiceCollections)
            .set({ heldAt: at })
            .where(
                and(
                    eq(subscriptionInvoiceCollections.id, id),
                    inArray(subscriptionInvoiceCollections.status, [
                        ...UNSETTLED_COLLECTION_STATUSES,
                    ]),
                    lt(subscriptionInvoiceCollections.heldAt, heldBefore),
                ),
            )
            .returning({ id: subscriptionInvoiceCollections.id });
        return rows.length === 1;
    }

    async listUnsettled(
        before: { submittedBefore: Date; pendingBefore: Date },
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        const rows = await resolveDb(this.db, tx)
            .select({ id: subscriptionInvoiceCollections.id })
            .from(subscriptionInvoiceCollections)
            .where(
                and(
                    page.after === undefined
                        ? undefined
                        : gt(subscriptionInvoiceCollections.id, page.after),
                    or(
                        and(
                            eq(subscriptionInvoiceCollections.status, 'SUBMITTED'),
                            lt(subscriptionInvoiceCollections.heldAt, before.submittedBefore),
                        ),
                        and(
                            eq(subscriptionInvoiceCollections.status, 'PENDING'),
                            lt(subscriptionInvoiceCollections.heldAt, before.pendingBefore),
                        ),
                    ),
                ),
            )
            .orderBy(asc(subscriptionInvoiceCollections.id))
            .limit(page.limit);
        return rows.map((row) => row.id);
    }

    async findById(id: string, tx?: TransactionContext): Promise<InvoiceCollectionRecord | null> {
        const [row] = await resolveDb(this.db, tx)
            .select()
            .from(subscriptionInvoiceCollections)
            .where(eq(subscriptionInvoiceCollections.id, id))
            .limit(1);
        return row ? toInvoiceCollectionRecord(row) : null;
    }

    async accountsInUse(tx?: TransactionContext): Promise<string[]> {
        const rows = await resolveDb(this.db, tx)
            .selectDistinct({ gatewayAccount: subscriptionInvoiceCollections.gatewayAccount })
            .from(subscriptionInvoiceCollections)
            .where(
                inArray(subscriptionInvoiceCollections.status, [...UNSETTLED_COLLECTION_STATUSES]),
            )
            .orderBy(asc(subscriptionInvoiceCollections.gatewayAccount));
        return rows.map((row) => row.gatewayAccount);
    }

    async listByInvoice(
        invoiceId: string,
        tx?: TransactionContext,
    ): Promise<InvoiceCollectionRecord[]> {
        const rows = await resolveDb(this.db, tx)
            .select()
            .from(subscriptionInvoiceCollections)
            .where(eq(subscriptionInvoiceCollections.invoiceId, invoiceId))
            .orderBy(asc(subscriptionInvoiceCollections.attempt));
        return rows.map(toInvoiceCollectionRecord);
    }
}
