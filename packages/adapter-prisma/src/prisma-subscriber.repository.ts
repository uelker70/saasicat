import { Inject, Injectable } from '@nestjs/common';
import type {
    CanonicalSubscriberCorrectionRow,
    CanonicalSubscriberRow,
    CreateSubscriberData,
    SubscriberContactChange,
    SubscriberCorrectionData,
    SubscriberCorrectionRecord,
    SubscriberCorrectionResult,
    SubscriberRecord,
    SubscriberRepository,
    TransactionContext,
} from '@saasicat/core';
import {
    identityCorrectionDelta,
    toSubscriberCorrectionRecord,
    toSubscriberRecord,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** A subscriber row with its live tenant link, when it has one. */
type SubscriberDbRow = CanonicalSubscriberRow & { tenants?: Array<{ tenantId: string }> };

interface SubscriberTenantDbRow {
    id: string;
    subscriberId: string;
    tenantId: string;
}

/** Narrow view of the client and of a transaction client, which carry the same delegates. */
interface SubscriberPrisma {
    subscriber: PrismaModelDelegateLike<SubscriberDbRow>;
    subscriberTenant: PrismaModelDelegateLike<SubscriberTenantDbRow>;
    subscriberCorrection: PrismaModelDelegateLike<CanonicalSubscriberCorrectionRow>;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/** Root-client fields used directly: the delegates and the interactive transaction. */
interface SubscriberRepositoryClient {
    subscriber: unknown;
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

/** Reads a subscriber together with the tenant it is live for. */
const WITH_LIVE_TENANT = {
    tenants: { where: { unlinkedAt: null }, select: { tenantId: true }, take: 1 },
} as const;

/**
 * `SubscriberRepository` against the canonical `subscribers`,
 * `subscriber_tenants` and `subscriber_corrections` tables.
 *
 * The customer number is the column default: the database counts, from where
 * `constraints.postgres.sql` starts it, so two subscribers created at once
 * never share a number.
 */
@Injectable()
export class PrismaSubscriberRepository implements SubscriberRepository {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: SubscriberRepositoryClient,
    ) {}

    private db(tx?: TransactionContext): SubscriberPrisma {
        return (tx ?? this.prisma) as unknown as SubscriberPrisma;
    }

    /** On the caller's transaction when there is one, otherwise in one of its own. */
    private inTransaction<T>(
        tx: TransactionContext | undefined,
        fn: (db: SubscriberPrisma) => Promise<T>,
    ): Promise<T> {
        if (tx) return fn(this.db(tx));
        return this.prisma.$transaction((own) => fn(own as SubscriberPrisma));
    }

    async createForTenant(
        data: CreateSubscriberData,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord | null> {
        const { tenantId, ...details } = data;
        return this.inTransaction(tx, async (db) => {
            const created = await db.subscriber.create({ data: details });
            // A tenant's live link is unique in the database. `skipDuplicates`
            // turns a second one into no row rather than an error, so a
            // transaction the caller opened survives the refusal — an error
            // would have aborted it. The subscriber written above goes with it.
            const linked = await db.subscriberTenant.createMany({
                data: [{ subscriberId: created.id, tenantId }],
                skipDuplicates: true,
            });
            if (linked.count === 0) {
                await db.subscriber.delete({ where: { id: created.id } });
                return null;
            }
            return toSubscriberRecord(created, tenantId);
        });
    }

    async findById(
        subscriberId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord | null> {
        const row = await this.db(tx).subscriber.findUnique({
            where: { id: subscriberId },
            include: WITH_LIVE_TENANT,
        });
        return row ? toRecord(row) : null;
    }

    async findByTenantId(
        tenantId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord | null> {
        const row = await this.db(tx).subscriber.findFirst({
            where: { tenants: { some: { tenantId, unlinkedAt: null } } },
        });
        return row ? toSubscriberRecord(row, tenantId) : null;
    }

    async updateContact(
        subscriberId: string,
        change: SubscriberContactChange,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord | null> {
        const db = this.db(tx);
        const { count } = await db.subscriber.updateMany({
            where: { id: subscriberId },
            data: change,
        });
        if (count === 0) return null;
        return this.findById(subscriberId, tx);
    }

    async correctIdentity(
        subscriberId: string,
        data: SubscriberCorrectionData,
        tx?: TransactionContext,
    ): Promise<SubscriberCorrectionResult | null> {
        return this.inTransaction(tx, async (db) => {
            // Held until the transaction ends, so a correction arriving at the
            // same time reads the values this one wrote, and records those as
            // the ones it replaces.
            await db.$queryRaw`SELECT "id" FROM "subscribers" WHERE "id" = ${subscriberId} FOR UPDATE`;
            const current = await db.subscriber.findUnique({
                where: { id: subscriberId },
                include: WITH_LIVE_TENANT,
            });
            if (!current) return null;
            const delta = identityCorrectionDelta(current, data.corrected);
            if (Object.keys(delta.corrected).length === 0) {
                return { subscriber: toRecord(current), correction: null };
            }
            const updated = await db.subscriber.update({
                where: { id: subscriberId },
                data: delta.corrected,
                include: WITH_LIVE_TENANT,
            });
            const correction = await db.subscriberCorrection.create({
                data: {
                    subscriberId,
                    previous: delta.previous,
                    corrected: delta.corrected,
                    reason: data.reason,
                    correctedBy: data.correctedBy,
                    correctedAt: data.correctedAt,
                },
            });
            return {
                subscriber: toRecord(updated),
                correction: toSubscriberCorrectionRecord(correction),
            };
        });
    }

    async listCorrections(subscriberId: string): Promise<SubscriberCorrectionRecord[]> {
        const rows = await this.db().subscriberCorrection.findMany({
            where: { subscriberId },
            orderBy: [{ correctedAt: 'desc' }, { id: 'desc' }],
        });
        return rows.map(toSubscriberCorrectionRecord);
    }
}

function toRecord(row: SubscriberDbRow): SubscriberRecord {
    return toSubscriberRecord(row, row.tenants?.[0]?.tenantId ?? null);
}
