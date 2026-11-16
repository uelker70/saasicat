import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
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
    utcMidnightOf,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** A delegate whose rows this repository only counts. */
type CountingDelegate = Pick<PrismaModelDelegateLike<unknown>, 'count'>;

/**
 * Narrow view of the client and of a transaction client, which carry the same
 * delegates: fragment 33's, and those of the subscriber's commercial record —
 * of an optional model only where the schema adopts it.
 */
interface TenantDeletionPrisma {
    subscriberTenantDeletion: PrismaModelDelegateLike<CanonicalTenantDeletionRow>;
    subscriberTenantDeletionStore: PrismaModelDelegateLike<unknown>;
    subscriberTenantDeletionCount: PrismaModelDelegateLike<unknown>;
    subscriber: CountingDelegate;
    subscriptionContract: CountingDelegate;
    subscriberLedgerEntry?: CountingDelegate;
    subscriptionInvoice?: CountingDelegate;
    subscriberPayment?: CountingDelegate;
    subscriberCredit?: CountingDelegate;
}

/**
 * What the constructor takes: a client that has the three delegates of
 * fragment 33 and an interactive transaction. A client generated from a schema
 * without fragment 33 fails to compile here rather than at the first run.
 */
interface TenantDeletionRepositoryClient {
    subscriberTenantDeletion: unknown;
    subscriberTenantDeletionStore: unknown;
    subscriberTenantDeletionCount: unknown;
    subscriber: unknown;
    subscriptionContract: unknown;
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

/** The columns a read asks for, named, so a column a later release adds is not read. */
const COLUMNS = {
    id: true,
    tenantId: true,
    subscriberId: true,
    subscriptionId: true,
    subscriptionEndId: true,
    deletesOn: true,
    exportOfferedFrom: true,
    exportBlockedBySuspension: true,
    commercialBefore: true,
    commercialAfter: true,
    startedAt: true,
    claimedAt: true,
    attempts: true,
    lastFailure: true,
    halt: true,
    closedAt: true,
    stores: { select: { store: true, position: true, countedAt: true, erasedAt: true } },
    counts: { select: { kind: true, store: true, category: true, count: true, labels: true } },
} as const;

/**
 * `TenantDeletionRecordPort` against the canonical
 * `subscriber_tenant_deletions`, `subscriber_tenant_deletion_stores` and
 * `subscriber_tenant_deletion_counts` tables.
 *
 * Every write that may race another run is one conditional statement naming
 * the state it expects, so the database lets one through and the other's
 * condition no longer holds when it gets its turn. A write that spans rows of
 * more than one table runs in one transaction, the caller's where one is given.
 */
@Injectable()
export class PrismaTenantDeletionRepository implements TenantDeletionRecordPort {
    private readonly notAdopted: ReadonlySet<OptionalCanonicalModel>;

    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: TenantDeletionRepositoryClient,
        notAdopted: readonly OptionalCanonicalModel[] = [],
    ) {
        this.notAdopted = new Set(notAdopted);
    }

    private db(tx?: TransactionContext): TenantDeletionPrisma {
        // SAFETY: the root client and every transaction client it hands out
        // carry the delegates of fragment 33's models, whose rows read back
        // with `COLUMNS` are `CanonicalTenantDeletionRow`, and those of the
        // commercial record's models the schema adopts; the generated-client
        // test compiles this adapter against a client generated from the
        // fragments.
        return (tx ?? this.prisma) as TenantDeletionPrisma;
    }

    /** Runs `write` in the caller's transaction, or in one of its own. */
    private inTransaction<T>(
        write: (db: TenantDeletionPrisma) => Promise<T>,
        tx?: TransactionContext,
    ): Promise<T> {
        if (tx) return write(this.db(tx));
        return this.prisma.$transaction((own) => write(this.db(own)));
    }

    /**
     * The record first, `skipDuplicates` being `ON CONFLICT DO NOTHING`: the
     * unique key on `tenantId` refuses the second of two runs by returning no
     * row rather than by raising, so a caller's transaction stays usable. Its
     * stores and what the tenant keeps follow in the same transaction.
     */
    begin(
        record: NewTenantDeletionRecord,
        tx?: TransactionContext,
    ): Promise<TenantDeletionRecord | null> {
        return this.inTransaction(async (db) => {
            const id = randomUUID();
            const [written] = await db.subscriberTenantDeletion.createManyAndReturn({
                data: [
                    {
                        id,
                        tenantId: record.tenantId,
                        subscriberId: record.subscriberId,
                        subscriptionId: record.subscriptionId,
                        subscriptionEndId: record.subscriptionEndId,
                        deletesOn: utcMidnightOf(record.deletesOn),
                        exportOfferedFrom: record.exportOfferedFrom,
                        exportBlockedBySuspension: record.exportBlockedBySuspension,
                        startedAt: record.startedAt,
                    },
                ],
                skipDuplicates: true,
            });
            if (!written) return null;
            await db.subscriberTenantDeletionStore.createMany({
                data: record.stores.map(({ store, position }) => ({
                    id: randomUUID(),
                    deletionId: id,
                    store,
                    position,
                })),
            });
            await this.writeCounts(db, id, keptCountColumns(record.keep));
            return this.read(db, id);
        }, tx);
    }

    async findForTenants(tenantIds: readonly string[]): Promise<TenantDeletionRecord[]> {
        if (tenantIds.length === 0) return [];
        const rows = await this.db().subscriberTenantDeletion.findMany({
            where: { tenantId: { in: [...tenantIds] } },
            select: COLUMNS,
            orderBy: { tenantId: 'asc' },
        });
        return rows.map(toTenantDeletionRecord);
    }

    async findForSubscriber(subscriberId: string): Promise<TenantDeletionRecord[]> {
        const rows = await this.db().subscriberTenantDeletion.findMany({
            where: { subscriberId },
            select: COLUMNS,
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        });
        return rows.map(toTenantDeletionRecord);
    }

    /** One guarded `UPDATE`: of two runs, the second finds the claim fresh and changes nothing. */
    async claim(id: string, now: Date, staleBefore: Date): Promise<TenantDeletionRecord | null> {
        const { count } = await this.db().subscriberTenantDeletion.updateMany({
            where: {
                id,
                closedAt: null,
                OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }],
            },
            data: { claimedAt: now },
        });
        return count === 1 ? this.read(this.db(), id) : null;
    }

    async renew(id: string, claimedAt: Date, now: Date): Promise<boolean> {
        const { count } = await this.db().subscriberTenantDeletion.updateMany({
            where: { id, closedAt: null, claimedAt },
            data: { claimedAt: now },
        });
        return count === 1;
    }

    async release(id: string, claimedAt: Date): Promise<void> {
        await this.db().subscriberTenantDeletion.updateMany({
            where: { id, closedAt: null, claimedAt },
            data: { claimedAt: null },
        });
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
        return this.inTransaction(async (db) => {
            const { count } = await db.subscriberTenantDeletionStore.updateMany({
                where: { deletionId: id, store, countedAt: null },
                data: { countedAt: at },
            });
            if (count === 1) await this.writeCounts(db, id, erasedCountColumns(store, counts));
        });
    }

    async recordErased(id: string, store: string, at: Date): Promise<void> {
        await this.db().subscriberTenantDeletionStore.updateMany({
            where: { deletionId: id, store, erasedAt: null },
            data: { erasedAt: at },
        });
    }

    async recordCommercial(
        id: string,
        which: 'before' | 'after',
        counts: CommercialRecordCounts,
    ): Promise<void> {
        await this.db().subscriberTenantDeletion.updateMany({
            where: { id },
            data: { [which === 'before' ? 'commercialBefore' : 'commercialAfter']: { ...counts } },
        });
    }

    /** One statement, so of two failures recorded at once each counts its attempt. */
    async recordFailure(
        id: string,
        failure: TenantDeletionFailure,
        halt: TenantDeletionRecordHalt | null,
    ): Promise<void> {
        await this.db().subscriberTenantDeletion.updateMany({
            where: { id },
            data: {
                lastFailure: tenantDeletionFailureColumn(failure),
                attempts: { increment: 1 },
                halt,
            },
        });
    }

    async close(id: string, at: Date, tx?: TransactionContext): Promise<boolean> {
        const { count } = await this.db(tx).subscriberTenantDeletion.updateMany({
            where: { id, closedAt: null },
            data: { closedAt: at },
        });
        return count === 1;
    }

    /**
     * One count per part. A model the schema does not adopt counts 0, before
     * as after: what is not kept cannot be lost.
     */
    async countCommercialRecord(subscriberId: string): Promise<CommercialRecordCounts> {
        const db = this.db();
        const optional = async (
            model: OptionalCanonicalModel,
            delegate: CountingDelegate | undefined,
        ): Promise<number> => {
            if (this.notAdopted.has(model)) return 0;
            if (!delegate) {
                throw new Error(
                    `The Prisma client has no delegate for ${model}, which counts in a ` +
                        "subscriber's commercial record. Name it in `notAdopted` where the " +
                        'schema leaves it out.',
                );
            }
            return delegate.count({ where: { subscriberId } });
        };
        return {
            subscriber: await db.subscriber.count({ where: { id: subscriberId } }),
            contracts: await db.subscriptionContract.count({ where: { subscriberId } }),
            charges: await optional('SubscriberLedgerEntry', db.subscriberLedgerEntry),
            invoices: await optional('SubscriptionInvoice', db.subscriptionInvoice),
            payments: await optional('SubscriberPayment', db.subscriberPayment),
            credits: await optional('SubscriberCredit', db.subscriberCredit),
        };
    }

    private async writeCounts(
        db: TenantDeletionPrisma,
        deletionId: string,
        counts: readonly TenantDeletionCountColumns[],
    ): Promise<void> {
        if (counts.length === 0) return;
        await db.subscriberTenantDeletionCount.createMany({
            // A `null` in a `Json` column Prisma writes as JSON `null`; the
            // labels of an erased count are left out, so the column is NULL.
            data: counts.map(({ labels, ...count }) => ({
                id: randomUUID(),
                deletionId,
                ...count,
                labels: labels ?? undefined,
            })),
        });
    }

    private async read(db: TenantDeletionPrisma, id: string): Promise<TenantDeletionRecord | null> {
        const row = await db.subscriberTenantDeletion.findUnique({
            where: { id },
            select: COLUMNS,
        });
        return row ? toTenantDeletionRecord(row) : null;
    }
}
