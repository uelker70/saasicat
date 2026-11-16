import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
    type CanonicalTenantDeletionRow,
    type CommercialRecordCounts,
    type NewTenantDeletionRecord,
    type OptionalCanonicalModel,
    type TenantCount,
    type TenantDeletionCountColumns,
    type TenantDeletionFailure,
    type TenantDeletionRecord,
    type TenantDeletionRecordHalt,
    type TenantDeletionRecordPort,
    type TransactionContext,
    erasedCountColumns,
    keptCountColumns,
    tenantDeletionFailureColumn,
    toTenantDeletionRecord,
} from '@saasicat/core';
import { resolveDb, type DrizzleClient } from './client.js';
import {
    subscriberCredits,
    subscriberLedgerEntries,
    subscriberPayments,
    subscriberTenantDeletionCounts,
    subscriberTenantDeletionStores,
    subscriberTenantDeletions,
    subscribers,
    subscriptionContracts,
    subscriptionInvoices,
} from './schema.js';

type DeletionRow = typeof subscriberTenantDeletions.$inferSelect;

/**
 * `TenantDeletionRecordPort` against the canonical
 * `subscriber_tenant_deletions`, `subscriber_tenant_deletion_stores` and
 * `subscriber_tenant_deletion_counts` tables. Built by `drizzlePersistence()`,
 * which hands it the models it was told the schema leaves out.
 *
 * Every write that may race another run is one conditional statement naming
 * the state it expects, so the database lets one through and the other's
 * condition no longer holds when it gets its turn. A write that spans rows of
 * more than one table runs in one transaction, within the caller's where one
 * is given.
 */
export class DrizzleTenantDeletionRepository implements TenantDeletionRecordPort {
    private readonly notAdopted: ReadonlySet<OptionalCanonicalModel>;

    constructor(
        private readonly db: DrizzleClient,
        notAdopted: readonly OptionalCanonicalModel[] = [],
    ) {
        this.notAdopted = new Set(notAdopted);
    }

    /**
     * The record first, `ON CONFLICT DO NOTHING` on the unique key on
     * `tenantId`: the second of two runs is refused by getting no row back
     * rather than by raising, so a caller's transaction stays usable. Its
     * stores and what the tenant keeps follow in the same transaction.
     */
    begin(
        record: NewTenantDeletionRecord,
        tx?: TransactionContext,
    ): Promise<TenantDeletionRecord | null> {
        return resolveDb(this.db, tx).transaction(async (db) => {
            const id = randomUUID();
            const [written] = await db
                .insert(subscriberTenantDeletions)
                .values({
                    id,
                    tenantId: record.tenantId,
                    subscriberId: record.subscriberId,
                    subscriptionId: record.subscriptionId,
                    subscriptionEndId: record.subscriptionEndId,
                    deletesOn: record.deletesOn,
                    exportOfferedFrom: record.exportOfferedFrom,
                    exportBlockedBySuspension: record.exportBlockedBySuspension,
                    startedAt: record.startedAt,
                })
                .onConflictDoNothing({ target: subscriberTenantDeletions.tenantId })
                .returning({ id: subscriberTenantDeletions.id });
            if (!written) return null;
            if (record.stores.length > 0) {
                await db.insert(subscriberTenantDeletionStores).values(
                    record.stores.map(({ store, position }) => ({
                        id: randomUUID(),
                        deletionId: id,
                        store,
                        position,
                    })),
                );
            }
            await this.writeCounts(db, id, keptCountColumns(record.keep));
            return this.read(db, id);
        });
    }

    async findForTenants(tenantIds: readonly string[]): Promise<TenantDeletionRecord[]> {
        if (tenantIds.length === 0) return [];
        const rows = await this.db
            .select()
            .from(subscriberTenantDeletions)
            .where(inArray(subscriberTenantDeletions.tenantId, [...tenantIds]))
            .orderBy(asc(subscriberTenantDeletions.tenantId));
        return this.withParts(this.db, rows);
    }

    async findForSubscriber(subscriberId: string): Promise<TenantDeletionRecord[]> {
        const rows = await this.db
            .select()
            .from(subscriberTenantDeletions)
            .where(eq(subscriberTenantDeletions.subscriberId, subscriberId))
            .orderBy(desc(subscriberTenantDeletions.startedAt), desc(subscriberTenantDeletions.id));
        return this.withParts(this.db, rows);
    }

    /** One guarded `UPDATE`: of two runs, the second finds the claim fresh and changes nothing. */
    async claim(id: string, now: Date, staleBefore: Date): Promise<TenantDeletionRecord | null> {
        const claimed = await this.db
            .update(subscriberTenantDeletions)
            .set({ claimedAt: now })
            .where(
                and(
                    eq(subscriberTenantDeletions.id, id),
                    isNull(subscriberTenantDeletions.closedAt),
                    or(
                        isNull(subscriberTenantDeletions.claimedAt),
                        lt(subscriberTenantDeletions.claimedAt, staleBefore),
                    ),
                ),
            )
            .returning({ id: subscriberTenantDeletions.id });
        return claimed.length === 1 ? this.read(this.db, id) : null;
    }

    async renew(id: string, claimedAt: Date, now: Date): Promise<boolean> {
        const renewed = await this.db
            .update(subscriberTenantDeletions)
            .set({ claimedAt: now })
            .where(this.heldBy(id, claimedAt))
            .returning({ id: subscriberTenantDeletions.id });
        return renewed.length === 1;
    }

    async release(id: string, claimedAt: Date): Promise<void> {
        await this.db
            .update(subscriberTenantDeletions)
            .set({ claimedAt: null })
            .where(this.heldBy(id, claimedAt));
    }

    /**
     * The store's `countedAt` is written only where it is still null, and its
     * counts only by the call that wrote it, in one transaction: a store
     * counted again keeps the first counts, and none is ever half recorded.
     */
    recordCounts(
        id: string,
        store: string,
        counts: readonly TenantCount[],
        at: Date,
    ): Promise<void> {
        return this.db.transaction(async (db) => {
            const counted = await db
                .update(subscriberTenantDeletionStores)
                .set({ countedAt: at })
                .where(
                    and(
                        eq(subscriberTenantDeletionStores.deletionId, id),
                        eq(subscriberTenantDeletionStores.store, store),
                        isNull(subscriberTenantDeletionStores.countedAt),
                    ),
                )
                .returning({ id: subscriberTenantDeletionStores.id });
            if (counted.length === 1) {
                await this.writeCounts(db, id, erasedCountColumns(store, counts));
            }
        });
    }

    async recordErased(id: string, store: string, at: Date): Promise<void> {
        await this.db
            .update(subscriberTenantDeletionStores)
            .set({ erasedAt: at })
            .where(
                and(
                    eq(subscriberTenantDeletionStores.deletionId, id),
                    eq(subscriberTenantDeletionStores.store, store),
                    isNull(subscriberTenantDeletionStores.erasedAt),
                ),
            );
    }

    async recordCommercial(
        id: string,
        which: 'before' | 'after',
        counts: CommercialRecordCounts,
    ): Promise<void> {
        await this.db
            .update(subscriberTenantDeletions)
            .set(
                which === 'before'
                    ? { commercialBefore: { ...counts } }
                    : { commercialAfter: { ...counts } },
            )
            .where(eq(subscriberTenantDeletions.id, id));
    }

    /** One statement, so of two failures recorded at once each counts its attempt. */
    async recordFailure(
        id: string,
        failure: TenantDeletionFailure,
        halt: TenantDeletionRecordHalt | null,
    ): Promise<void> {
        await this.db
            .update(subscriberTenantDeletions)
            .set({
                lastFailure: tenantDeletionFailureColumn(failure),
                attempts: sql`${subscriberTenantDeletions.attempts} + 1`,
                halt,
            })
            .where(eq(subscriberTenantDeletions.id, id));
    }

    async close(id: string, at: Date, tx?: TransactionContext): Promise<boolean> {
        const closed = await resolveDb(this.db, tx)
            .update(subscriberTenantDeletions)
            .set({ closedAt: at })
            .where(
                and(
                    eq(subscriberTenantDeletions.id, id),
                    isNull(subscriberTenantDeletions.closedAt),
                ),
            )
            .returning({ id: subscriberTenantDeletions.id });
        return closed.length === 1;
    }

    /**
     * One count per part. A model the schema does not adopt counts 0, before
     * as after: what is not kept cannot be lost.
     */
    async countCommercialRecord(subscriberId: string): Promise<CommercialRecordCounts> {
        const counted = async (table: PgTable, column: PgColumn): Promise<number> => {
            const [row] = await this.db
                .select({ n: count() })
                .from(table)
                .where(eq(column, subscriberId));
            return row?.n ?? 0;
        };
        const optional = (
            model: OptionalCanonicalModel,
            table: PgTable & { subscriberId: PgColumn },
        ): Promise<number> =>
            this.notAdopted.has(model) ? Promise.resolve(0) : counted(table, table.subscriberId);
        return {
            subscriber: await counted(subscribers, subscribers.id),
            contracts: await counted(subscriptionContracts, subscriptionContracts.subscriberId),
            charges: await optional('SubscriberLedgerEntry', subscriberLedgerEntries),
            invoices: await optional('SubscriptionInvoice', subscriptionInvoices),
            payments: await optional('SubscriberPayment', subscriberPayments),
            credits: await optional('SubscriberCredit', subscriberCredits),
        };
    }

    /** The record `id`, while the claim taken at `claimedAt` holds it and it is open. */
    private heldBy(id: string, claimedAt: Date) {
        return and(
            eq(subscriberTenantDeletions.id, id),
            isNull(subscriberTenantDeletions.closedAt),
            eq(subscriberTenantDeletions.claimedAt, claimedAt),
        );
    }

    private async writeCounts(
        db: DrizzleClient,
        deletionId: string,
        counts: readonly TenantDeletionCountColumns[],
    ): Promise<void> {
        if (counts.length === 0) return;
        await db
            .insert(subscriberTenantDeletionCounts)
            .values(counts.map((columns) => ({ id: randomUUID(), deletionId, ...columns })));
    }

    private async read(db: DrizzleClient, id: string): Promise<TenantDeletionRecord | null> {
        const rows = await db
            .select()
            .from(subscriberTenantDeletions)
            .where(eq(subscriberTenantDeletions.id, id));
        const [record] = await this.withParts(db, rows);
        return record ?? null;
    }

    /** `rows` with their stores and counts, read in one query each, in the order given. */
    private async withParts(
        db: DrizzleClient,
        rows: readonly DeletionRow[],
    ): Promise<TenantDeletionRecord[]> {
        if (rows.length === 0) return [];
        const ids = rows.map((row) => row.id);
        const stores = await db
            .select()
            .from(subscriberTenantDeletionStores)
            .where(inArray(subscriberTenantDeletionStores.deletionId, ids));
        const counts = await db
            .select()
            .from(subscriberTenantDeletionCounts)
            .where(inArray(subscriberTenantDeletionCounts.deletionId, ids));
        return rows.map((row) =>
            toTenantDeletionRecord(
                canonicalRow(
                    row,
                    stores.filter((store) => store.deletionId === row.id),
                    counts.filter((part) => part.deletionId === row.id),
                ),
            ),
        );
    }
}

/** A row with its parts as the shared reader takes it, each column named. */
function canonicalRow(
    row: DeletionRow,
    stores: readonly (typeof subscriberTenantDeletionStores.$inferSelect)[],
    counts: readonly (typeof subscriberTenantDeletionCounts.$inferSelect)[],
): CanonicalTenantDeletionRow {
    return {
        id: row.id,
        tenantId: row.tenantId,
        subscriberId: row.subscriberId,
        subscriptionId: row.subscriptionId,
        subscriptionEndId: row.subscriptionEndId,
        deletesOn: row.deletesOn,
        exportOfferedFrom: row.exportOfferedFrom,
        exportBlockedBySuspension: row.exportBlockedBySuspension,
        commercialBefore: row.commercialBefore,
        commercialAfter: row.commercialAfter,
        startedAt: row.startedAt,
        claimedAt: row.claimedAt,
        attempts: row.attempts,
        lastFailure: row.lastFailure,
        halt: row.halt,
        closedAt: row.closedAt,
        stores: stores.map(({ store, position, countedAt, erasedAt }) => ({
            store,
            position,
            countedAt,
            erasedAt,
        })),
        counts: counts.map(({ kind, store, category, count: number, labels }) => ({
            kind,
            store,
            category,
            count: number,
            labels,
        })),
    };
}
