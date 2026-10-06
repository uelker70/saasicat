import { Inject, Injectable } from '@nestjs/common';
import type {
    CanonicalSubscriberCorrectionRow,
    CanonicalSubscriberRow,
    CanonicalSubscriberTaxOriginChangeRow,
    CanonicalSubscriberVatIdCheckRow,
    CreateSubscriberData,
    RecordedVatIdCheck,
    SubscriberBusinessStatusData,
    SubscriberBusinessStatusResult,
    SubscriberContactChange,
    SubscriberCorrectionData,
    SubscriberCorrectionRecord,
    SubscriberCorrectionResult,
    SubscriberRecord,
    SubscriberRepository,
    SubscriberTaxOriginChangeRecord,
    SubscriberVatIdCheckRecord,
    SubscriberWithCurrentCheck,
    TaxOriginWrite,
    TransactionContext,
    VatIdCheck,
} from '@saasicat/core';
import {
    identityCorrectionDelta,
    keepsVatIdCheck,
    taxOriginWrite,
    toSubscriberCorrectionRecord,
    toSubscriberRecord,
    toSubscriberTaxOriginChangeRecord,
    toSubscriberVatIdCheckRecord,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** A subscriber row with its live tenant link, when it has one. */
type SubscriberDbRow = CanonicalSubscriberRow & {
    currentVatIdCheckId: string | null;
    vatIdSince: Date | null;
    tenants?: Array<{ tenantId: string }>;
};

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
    subscriberTaxOriginChange: PrismaModelDelegateLike<CanonicalSubscriberTaxOriginChangeRow>;
    subscriberVatIdCheck: PrismaModelDelegateLike<CanonicalSubscriberVatIdCheckRow>;
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
 * `subscriber_tenants`, `subscriber_corrections`,
 * `subscriber_tax_origin_changes` and `subscriber_vat_id_checks` tables.
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
        changedBy: string,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord | null> {
        return this.inTransaction(tx, async (db) => {
            // Locked as a correction is, so the country recorded as replaced is
            // the one this write replaced.
            const current = await lockedSubscriber(db, subscriberId);
            if (!current) return null;
            const changedAt = new Date();
            const origin = taxOriginWrite(current, { country: change.country });
            const updated = await db.subscriber.update({
                where: { id: subscriberId },
                data: change,
                include: WITH_LIVE_TENANT,
            });
            await recordTaxOriginChange(db, subscriberId, origin, changedBy, changedAt, null);
            return toRecord(updated);
        });
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
            const current = await lockedSubscriber(db, subscriberId);
            if (!current) return null;
            const delta = identityCorrectionDelta(current, data.corrected);
            if (Object.keys(delta.corrected).length === 0) {
                return { subscriber: toRecord(current), correction: null };
            }
            const changedAt = new Date();
            const origin = taxOriginWrite(current, { vatId: delta.corrected.vatId });
            const updated = await db.subscriber.update({
                where: { id: subscriberId },
                data: {
                    ...delta.corrected,
                    ...(origin.endsCountingVatIdCheck
                        ? { currentVatIdCheckId: null, vatIdSince: changedAt }
                        : {}),
                },
                include: WITH_LIVE_TENANT,
            });
            const correction = await db.subscriberCorrection.create({
                data: {
                    subscriberId,
                    previous: delta.previous,
                    corrected: delta.corrected,
                    reason: data.reason,
                    correctedBy: data.correctedBy,
                    correctedAt: changedAt,
                },
            });
            await recordTaxOriginChange(
                db,
                subscriberId,
                origin,
                data.correctedBy,
                changedAt,
                data.reason,
            );
            return {
                subscriber: toRecord(updated),
                correction: toSubscriberCorrectionRecord(correction),
            };
        });
    }

    async listCorrections(subscriberId: string): Promise<SubscriberCorrectionRecord[]> {
        const rows = await this.db().subscriberCorrection.findMany({
            where: { subscriberId },
            orderBy: [{ seq: 'desc' }],
        });
        return rows.map(toSubscriberCorrectionRecord);
    }

    async changeBusinessStatus(
        subscriberId: string,
        data: SubscriberBusinessStatusData,
        tx?: TransactionContext,
    ): Promise<SubscriberBusinessStatusResult | null> {
        return this.inTransaction(tx, async (db) => {
            const current = await lockedSubscriber(db, subscriberId);
            if (!current) return null;
            const origin = taxOriginWrite(current, { business: data.business });
            if (!origin.moved) return { subscriber: toRecord(current), change: null };
            const changedAt = new Date();
            const updated = await db.subscriber.update({
                where: { id: subscriberId },
                data: { business: data.business },
                include: WITH_LIVE_TENANT,
            });
            const change = await recordTaxOriginChange(
                db,
                subscriberId,
                origin,
                data.changedBy,
                changedAt,
                data.reason,
            );
            return { subscriber: toRecord(updated), change };
        });
    }

    async recordVatIdCheck(
        subscriberId: string,
        check: VatIdCheck,
        tx?: TransactionContext,
    ): Promise<RecordedVatIdCheck | null> {
        return this.inTransaction(tx, async (db) => {
            const current = await lockedSubscriber(db, subscriberId);
            if (!current) return null;
            const recorded = toSubscriberVatIdCheckRecord(
                await db.subscriberVatIdCheck.create({
                    data: {
                        subscriberId,
                        vatId: check.vatId,
                        checkedAt: check.checkedAt,
                        valid: check.valid,
                        service: check.service,
                        confirmation: { ...check.confirmation },
                    },
                }),
            );
            const counting = await vatIdCheckById(db, current.currentVatIdCheckId);
            if (!keepsVatIdCheck(current, counting, recorded)) {
                return { recorded, current: counting };
            }
            await db.subscriber.update({
                where: { id: subscriberId },
                data: { currentVatIdCheckId: recorded.id },
            });
            return { recorded, current: recorded };
        });
    }

    async findCurrentVatIdCheck(
        subscriberId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberVatIdCheckRecord | null> {
        const db = this.db(tx);
        const row = await db.subscriber.findUnique({ where: { id: subscriberId } });
        return vatIdCheckById(db, row?.currentVatIdCheckId ?? null);
    }

    async listVatIdChecks(subscriberId: string): Promise<SubscriberVatIdCheckRecord[]> {
        const rows = await this.db().subscriberVatIdCheck.findMany({
            where: { subscriberId },
            orderBy: [{ checkedAt: 'desc' }, { recordedAt: 'desc' }, { id: 'desc' }],
        });
        return rows.map(toSubscriberVatIdCheckRecord);
    }

    async listForTenants(
        tenantIds: readonly string[],
        tx?: TransactionContext,
    ): Promise<SubscriberWithCurrentCheck[]> {
        if (tenantIds.length === 0) return [];
        const db = this.db(tx);
        const links = await db.subscriberTenant.findMany({
            where: { tenantId: { in: [...tenantIds] }, unlinkedAt: null },
            select: { tenantId: true, subscriberId: true },
        });
        if (links.length === 0) return [];
        const rows = await db.subscriber.findMany({
            where: { id: { in: [...new Set(links.map((link) => link.subscriberId))] } },
        });
        const checkIds = rows.flatMap((row) =>
            row.currentVatIdCheckId === null ? [] : [row.currentVatIdCheckId],
        );
        const checks =
            checkIds.length === 0
                ? []
                : await db.subscriberVatIdCheck.findMany({ where: { id: { in: checkIds } } });
        const rowsById = new Map(rows.map((row) => [row.id, row]));
        const checksById = new Map(checks.map((check) => [check.id, check]));
        return links.flatMap((link) => {
            const row = rowsById.get(link.subscriberId);
            if (!row) return [];
            const check =
                row.currentVatIdCheckId === null
                    ? undefined
                    : checksById.get(row.currentVatIdCheckId);
            return [
                {
                    subscriber: toSubscriberRecord(row, link.tenantId),
                    currentVatIdCheck: check ? toSubscriberVatIdCheckRecord(check) : null,
                },
            ];
        });
    }

    async listTaxOriginChanges(subscriberId: string): Promise<SubscriberTaxOriginChangeRecord[]> {
        const rows = await this.db().subscriberTaxOriginChange.findMany({
            where: { subscriberId },
            orderBy: [{ seq: 'desc' }],
        });
        return rows.map(toSubscriberTaxOriginChangeRecord);
    }
}

/**
 * The subscriber with its live tenant, its row locked until the transaction
 * ends: a correction, a contact change and a change of the business status
 * arriving at once each read the values the other wrote.
 */
async function lockedSubscriber(
    db: SubscriberPrisma,
    subscriberId: string,
): Promise<SubscriberDbRow | null> {
    await db.$queryRaw`SELECT "id" FROM "subscribers" WHERE "id" = ${subscriberId} FOR UPDATE`;
    return db.subscriber.findUnique({ where: { id: subscriberId }, include: WITH_LIVE_TENANT });
}

/** A recorded check by its id; `null` for no id, or one that names no row. */
async function vatIdCheckById(
    db: SubscriberPrisma,
    checkId: string | null,
): Promise<SubscriberVatIdCheckRecord | null> {
    if (checkId === null) return null;
    const row = await db.subscriberVatIdCheck.findUnique({ where: { id: checkId } });
    return row ? toSubscriberVatIdCheckRecord(row) : null;
}

/**
 * Records what a write moved of the tax origin, with why where the write
 * states it; nothing when it moved nothing.
 */
async function recordTaxOriginChange(
    db: SubscriberPrisma,
    subscriberId: string,
    origin: TaxOriginWrite,
    changedBy: string,
    changedAt: Date,
    reason: string | null,
): Promise<SubscriberTaxOriginChangeRecord | null> {
    if (!origin.moved) return null;
    const row = await db.subscriberTaxOriginChange.create({
        data: {
            subscriberId,
            previous: origin.previous,
            changed: origin.changed,
            changedBy,
            changedAt,
            reason,
        },
    });
    return toSubscriberTaxOriginChangeRecord(row);
}

function toRecord(row: SubscriberDbRow): SubscriberRecord {
    return toSubscriberRecord(row, row.tenants?.[0]?.tenantId ?? null);
}
