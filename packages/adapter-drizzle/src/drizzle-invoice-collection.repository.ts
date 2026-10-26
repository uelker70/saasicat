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
    max,
    ne,
    notExists,
    or,
    sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
    AbandonPaidOutcome,
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
    COLLECTION_NOT_SENT_PAID,
    FOLLOWED_UP_COLLECTION_STATUSES,
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
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { lockChainOf } from './drizzle-invoice-chain.js';
import { owedOnInvoice, stillOwes } from './drizzle-open-sums.js';
import {
    subscriberPaymentMethods,
    subscriptionInvoiceCancellations,
    subscriptionInvoiceCollections,
    subscriptionInvoiceDocuments,
    subscriptionInvoices,
} from './schema.js';

/** The invoice's attempts again, beside the one a query lists. */
const others = alias(subscriptionInvoiceCollections, 'others');

/** The reversed attempts of the invoice's chain, beside the one a query lists. */
const reversed = alias(subscriptionInvoiceCollections, 'reversed');

/** The attempts of the invoice's chain, beside the invoice a query lists. */
const chainAttempts = alias(subscriptionInvoiceCollections, 'chain_attempts');

/** The invoices of the chain of the invoice a query lists. */
const chainInvoices = alias(subscriptionInvoices, 'chain_invoices');

/** The attempts what follows is decided for, as a parameter of the queries below. */
const FOLLOWED_UP_STATUSES = [...FOLLOWED_UP_COLLECTION_STATUSES];

/**
 * The attempts of a chain that hold every other invoice of it back: sent, and
 * not settled (`SC-PRIC-036`).
 */
const OPEN_IN_CHAIN = [...UNSETTLED_COLLECTION_STATUSES];

/** Whether invoice `invoiceId` still owes something, read on `db`. */
async function owes(db: ReturnType<typeof resolveDb>, invoiceId: string): Promise<boolean> {
    return (await owedIn(db, invoiceId)) > 0;
}

/**
 * What invoice `invoiceId` still owes, read on `db`: its total less what is
 * settled against it, in the database's numeric arithmetic; nothing where it
 * owes nothing by `stillOwes`.
 */
async function owedIn(db: ReturnType<typeof resolveDb>, invoiceId: string): Promise<number> {
    const [row] = await db
        .select({ owed: sql<string>`${owedOnInvoice}::text` })
        .from(subscriptionInvoices)
        .where(and(eq(subscriptionInvoices.id, invoiceId), stillOwes));
    return row
        ? columnAmountOf(row.owed, {
              table: 'subscription_invoices',
              column: 'totalGross',
              id: invoiceId,
          })
        : 0;
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
    db: ReturnType<typeof resolveDb>,
    chainId: string,
    invoiceId: string,
    paymentMethodId: string,
): Promise<boolean> {
    const rows = await db
        .select({ id: chainAttempts.id })
        .from(chainAttempts)
        .innerJoin(chainInvoices, eq(chainInvoices.id, chainAttempts.invoiceId))
        .where(
            and(
                eq(chainInvoices.chainId, chainId),
                ne(chainAttempts.invoiceId, invoiceId),
                or(
                    inArray(chainAttempts.status, OPEN_IN_CHAIN),
                    and(
                        eq(chainAttempts.status, 'REVERSED'),
                        eq(chainAttempts.paymentMethodId, paymentMethodId),
                    ),
                ),
            ),
        )
        .limit(1);
    return rows.length > 0;
}

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
                    notExists(
                        db
                            .select({ one: sql`1` })
                            .from(subscriptionInvoiceCancellations)
                            .where(
                                eq(
                                    subscriptionInvoiceCancellations.cancelledInvoiceId,
                                    subscriptionInvoices.id,
                                ),
                            ),
                    ),
                    notExists(
                        db
                            .select({ one: sql`1` })
                            .from(chainAttempts)
                            .innerJoin(chainInvoices, eq(chainInvoices.id, chainAttempts.invoiceId))
                            .where(
                                and(
                                    eq(chainInvoices.chainId, subscriptionInvoices.chainId),
                                    inArray(chainAttempts.status, OPEN_IN_CHAIN),
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
    private async writeNext(
        invoiceId: string,
        refuses: (earlier: readonly EarlierCollection[]) => boolean,
        columns: (number: number, amount: number) => InvoiceCollectionColumns,
        tx?: TransactionContext,
    ): Promise<InvoiceCollectionRecord | null> {
        // On the caller's transaction this is a savepoint.
        return resolveDb(this.db, tx).transaction(async (transaction) => {
            const db = resolveDb(this.db, transaction);
            // The turn of the invoice's chain: a second run writing an attempt
            // for it waits here, and then reads the attempt the first one wrote.
            const chainId = await lockChainOf(db, invoiceId);
            if (chainId === null) throw new Error(`Invoice ${invoiceId} does not exist.`);
            // An invoice that owes nothing — a payment came for it, or it was
            // cancelled — is collected no further; one that owes is collected
            // for what it owes now, in the turn no payment or reversal moves it in.
            const owed = await owedIn(db, invoiceId);
            if (owed <= 0) return null;
            const earlier = await db
                .select({
                    attempt: subscriptionInvoiceCollections.attempt,
                    status: subscriptionInvoiceCollections.status,
                })
                .from(subscriptionInvoiceCollections)
                .where(eq(subscriptionInvoiceCollections.invoiceId, invoiceId));
            if (refuses(earlier)) return null;
            const written = columns(lastCollectionOf(earlier) + 1, owed);
            if (await heldBackByItsChain(db, chainId, invoiceId, written.paymentMethodId)) {
                return null;
            }
            // Untargeted, so any of the unique indexes turns a second attempt
            // into no row rather than an error that would end the transaction.
            const [row] = await db
                .insert(subscriptionInvoiceCollections)
                .values({ id: randomUUID(), ...written })
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

    submitPlanned(
        id: string,
        at: Date,
        tx?: TransactionContext,
    ): Promise<SubmittedInvoiceCollection | null> {
        return this.inTurnOf(id, tx, async (db) => {
            const [planned] = await db
                .select({ invoiceId: subscriptionInvoiceCollections.invoiceId })
                .from(subscriptionInvoiceCollections)
                .where(eq(subscriptionInvoiceCollections.id, id));
            if (!planned || !(await owes(db, planned.invoiceId))) return null;
            const [row] = await db
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
        });
    }

    withdraw(id: string, at: Date, tx?: TransactionContext): Promise<boolean> {
        return this.inTurnOf(id, tx, async (db) => {
            const rows = await db
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
        });
    }

    /**
     * Runs `work` in the turn of the chain of the invoice attempt `id` belongs
     * to, as `writeNext` takes it.
     */
    private inTurnOf<T>(
        id: string,
        tx: TransactionContext,
        work: (db: ReturnType<typeof resolveDb>) => Promise<T>,
    ): Promise<T> {
        // On the caller's transaction this is a savepoint.
        return resolveDb(this.db, tx).transaction(async (transaction) => {
            const db = resolveDb(this.db, transaction);
            const [attempt] = await db
                .select({ invoiceId: subscriptionInvoiceCollections.invoiceId })
                .from(subscriptionInvoiceCollections)
                .where(eq(subscriptionInvoiceCollections.id, id));
            if (attempt) await lockChainOf(db, attempt.invoiceId);
            return work(db);
        });
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

    async listToFollowUp(
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
                    inArray(subscriptionInvoiceCollections.status, FOLLOWED_UP_STATUSES),
                    isNull(subscriptionInvoiceCollections.followedUpAt),
                ),
            )
            .orderBy(asc(subscriptionInvoiceCollections.id))
            .limit(page.limit);
        return rows.map((row) => row.id);
    }

    async listCollectableAgain(
        page: { limit: number; after?: string },
        tx?: TransactionContext,
    ): Promise<string[]> {
        const db = resolveDb(this.db, tx);
        // The last attempt: a later one exists only where none before it was
        // open or succeeded, so a last one that failed or was withdrawn means
        // none of the invoice's is.
        const last = db
            .select({ last: max(others.attempt) })
            .from(others)
            .where(eq(others.invoiceId, subscriptionInvoices.id));
        const rows = await db
            .select({ id: subscriptionInvoices.id })
            .from(subscriptionInvoices)
            .innerJoin(
                subscriptionInvoiceCollections,
                eq(subscriptionInvoiceCollections.invoiceId, subscriptionInvoices.id),
            )
            .innerJoin(
                subscriberPaymentMethods,
                and(
                    eq(subscriberPaymentMethods.subscriberId, subscriptionInvoices.subscriberId),
                    eq(subscriberPaymentMethods.status, 'ACTIVE'),
                ),
            )
            .where(
                and(
                    page.after === undefined ? undefined : gt(subscriptionInvoices.id, page.after),
                    eq(subscriptionInvoiceCollections.attempt, sql`(${last})`),
                    or(
                        eq(subscriptionInvoiceCollections.status, 'WITHDRAWN'),
                        and(
                            inArray(subscriptionInvoiceCollections.status, FOLLOWED_UP_STATUSES),
                            isNotNull(subscriptionInvoiceCollections.followedUpAt),
                        ),
                    ),
                    ne(subscriberPaymentMethods.id, subscriptionInvoiceCollections.paymentMethodId),
                    notExists(
                        db
                            .select({ id: reversed.id })
                            .from(reversed)
                            .where(
                                and(
                                    inArray(
                                        reversed.invoiceId,
                                        db
                                            .select({ id: chainInvoices.id })
                                            .from(chainInvoices)
                                            .where(
                                                eq(
                                                    chainInvoices.chainId,
                                                    subscriptionInvoices.chainId,
                                                ),
                                            ),
                                    ),
                                    eq(reversed.status, 'REVERSED'),
                                    or(
                                        isNull(reversed.followedUpAt),
                                        eq(reversed.paymentMethodId, subscriberPaymentMethods.id),
                                    ),
                                ),
                            ),
                    ),
                    stillOwes,
                ),
            )
            .orderBy(asc(subscriptionInvoices.id))
            .limit(page.limit);
        return rows.map((row) => row.id);
    }

    async markFollowedUp(id: string, at: Date, tx?: TransactionContext): Promise<boolean> {
        const rows = await resolveDb(this.db, tx)
            .update(subscriptionInvoiceCollections)
            .set({ followedUpAt: at })
            .where(
                and(
                    eq(subscriptionInvoiceCollections.id, id),
                    inArray(subscriptionInvoiceCollections.status, FOLLOWED_UP_STATUSES),
                    isNull(subscriptionInvoiceCollections.followedUpAt),
                ),
            )
            .returning({ id: subscriptionInvoiceCollections.id });
        return rows.length === 1;
    }

    async markReversed(id: string, at: Date, tx?: TransactionContext): Promise<boolean> {
        const rows = await resolveDb(this.db, tx)
            .update(subscriptionInvoiceCollections)
            .set({ status: 'REVERSED', resolvedAt: at, followedUpAt: null })
            .where(
                and(
                    eq(subscriptionInvoiceCollections.id, id),
                    inArray(subscriptionInvoiceCollections.status, [
                        ...REVERSIBLE_COLLECTION_STATUSES,
                    ]),
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
        const settle = async (db: ReturnType<typeof resolveDb>, from: readonly string[]) => {
            const rows = await db
                .update(subscriptionInvoiceCollections)
                .set(collectionOutcomeColumns(outcome, at))
                .where(
                    and(
                        eq(subscriptionInvoiceCollections.id, id),
                        inArray(subscriptionInvoiceCollections.status, [...from]),
                    ),
                )
                .returning({ id: subscriptionInvoiceCollections.id });
            return rows.length === 1;
        };
        if (outcome.status !== 'succeeded') {
            return settle(resolveDb(this.db, tx), UNSETTLED_COLLECTION_STATUSES);
        }
        return this.inTurnOf(id, tx, async (db) => {
            if (await settle(db, UNSETTLED_COLLECTION_STATUSES)) return true;
            const [row] = await db
                .select({
                    invoiceId: subscriptionInvoiceCollections.invoiceId,
                    status: subscriptionInvoiceCollections.status,
                })
                .from(subscriptionInvoiceCollections)
                .where(eq(subscriptionInvoiceCollections.id, id));
            if (!row || row.status !== 'FAILED') return false;
            // The money arrived after all: what was planned after the failure
            // is not made, and the attempt succeeded — where no other attempt
            // of its invoice is on its way or succeeded.
            await db
                .update(subscriptionInvoiceCollections)
                .set({ status: 'WITHDRAWN', resolvedAt: at })
                .where(
                    and(
                        eq(subscriptionInvoiceCollections.invoiceId, row.invoiceId),
                        eq(subscriptionInvoiceCollections.status, 'SCHEDULED'),
                    ),
                );
            const others = await db
                .select({ id: subscriptionInvoiceCollections.id })
                .from(subscriptionInvoiceCollections)
                .where(
                    and(
                        eq(subscriptionInvoiceCollections.invoiceId, row.invoiceId),
                        ne(subscriptionInvoiceCollections.id, id),
                        inArray(subscriptionInvoiceCollections.status, [
                            ...UNSETTLED_COLLECTION_STATUSES,
                            'SUCCEEDED',
                        ]),
                    ),
                );
            if (others.length > 0) return false;
            return settle(db, ['FAILED']);
        });
    }

    abandonPaid(id: string, at: Date, tx?: TransactionContext): Promise<AbandonPaidOutcome> {
        return this.inTurnOf(id, tx, async (db) => {
            const [row] = await db
                .select({
                    invoiceId: subscriptionInvoiceCollections.invoiceId,
                    status: subscriptionInvoiceCollections.status,
                })
                .from(subscriptionInvoiceCollections)
                .where(eq(subscriptionInvoiceCollections.id, id));
            if (row?.status !== 'SUBMITTED') return 'settled';
            const resend = await owes(db, row.invoiceId);
            // A failure or a pending answer is recorded outside the invoice's
            // turn, so the status read above may be stale: the answer rests on
            // a write conditioned on it, which waits for such a report still
            // being recorded and then finds the attempt settled.
            const claimed = await db
                .update(subscriptionInvoiceCollections)
                .set(
                    resend
                        ? { heldAt: at }
                        : collectionOutcomeColumns(COLLECTION_NOT_SENT_PAID, at),
                )
                .where(
                    and(
                        eq(subscriptionInvoiceCollections.id, id),
                        eq(subscriptionInvoiceCollections.status, 'SUBMITTED'),
                    ),
                )
                .returning({ id: subscriptionInvoiceCollections.id });
            if (claimed.length !== 1) return 'settled';
            return resend ? 'resend' : 'abandoned';
        });
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

    async findByKey(
        attemptKey: string,
        tx?: TransactionContext,
    ): Promise<InvoiceCollectionRecord | null> {
        const [row] = await resolveDb(this.db, tx)
            .select()
            .from(subscriptionInvoiceCollections)
            .where(eq(subscriptionInvoiceCollections.attemptKey, attemptKey));
        return row ? toInvoiceCollectionRecord(row) : null;
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

    async listByInvoices(invoiceIds: readonly string[]): Promise<InvoiceCollectionRecord[]> {
        if (invoiceIds.length === 0) return [];
        const rows = await resolveDb(this.db)
            .select()
            .from(subscriptionInvoiceCollections)
            .where(inArray(subscriptionInvoiceCollections.invoiceId, [...invoiceIds]));
        return rows.map(toInvoiceCollectionRecord);
    }
}
