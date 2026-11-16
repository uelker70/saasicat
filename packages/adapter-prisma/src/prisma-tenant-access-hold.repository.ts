import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
    type CanonicalTenantAccessHoldRow,
    type NewTenantAccessHold,
    type TenantAccessHold,
    type TenantAccessHoldKind,
    type TenantAccessHoldPort,
    type TransactionContext,
    toTenantAccessHold,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';
import { idsOf } from './raw-ids.js';

/** Narrow view of the client and of a transaction client, which carry the same delegate. */
interface TenantAccessHoldPrisma {
    tenantAccessHold: PrismaModelDelegateLike<CanonicalTenantAccessHoldRow>;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * What the constructor takes: a client that has the delegate. A client
 * generated from a schema without fragment 28 fails to compile here rather
 * than at the first request.
 */
interface TenantAccessHoldRepositoryClient {
    tenantAccessHold: unknown;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/** The columns a read asks for, named, so a column a later release adds is not read. */
const COLUMNS = {
    id: true,
    tenantId: true,
    kind: true,
    reference: true,
    note: true,
    since: true,
    recordedBy: true,
    liftedAt: true,
    liftedBy: true,
} as const;

const OLDEST_FIRST = [{ since: 'asc' }, { id: 'asc' }] as const;

/** `TenantAccessHoldPort` against the canonical `tenant_access_holds` table. */
@Injectable()
export class PrismaTenantAccessHoldRepository implements TenantAccessHoldPort {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: TenantAccessHoldRepositoryClient,
    ) {}

    private get db(): TenantAccessHoldPrisma {
        return this.dbOf();
    }

    private dbOf(tx?: TransactionContext): TenantAccessHoldPrisma {
        // SAFETY: `tenantAccessHold` is the delegate of fragment 28's model,
        // whose rows are `CanonicalTenantAccessHoldRow`; the bundle hands this
        // repository the canonical client, and a transaction client carries
        // the same delegates and `$queryRaw`.
        return (tx ?? this.prisma) as TenantAccessHoldPrisma;
    }

    async listOpen(tenantId: string): Promise<TenantAccessHold[]> {
        const rows = await this.db.tenantAccessHold.findMany({
            where: { tenantId, liftedAt: null },
            select: COLUMNS,
            orderBy: OLDEST_FIRST,
        });
        return rows.map(toTenantAccessHold);
    }

    async listOpenFor(tenantIds: readonly string[]): Promise<TenantAccessHold[]> {
        if (tenantIds.length === 0) return [];
        const rows = await this.db.tenantAccessHold.findMany({
            where: { tenantId: { in: [...tenantIds] }, liftedAt: null },
            select: COLUMNS,
            orderBy: OLDEST_FIRST,
        });
        return rows.map(toTenantAccessHold);
    }

    async listTenantIdsHeldBy(kinds: readonly TenantAccessHoldKind[]): Promise<string[]> {
        if (kinds.length === 0) return [];
        const rows = await this.db.tenantAccessHold.findMany({
            where: { kind: { in: [...kinds] }, liftedAt: null },
            select: { tenantId: true },
            distinct: ['tenantId'],
        });
        return rows.map((row) => row.tenantId);
    }

    /**
     * One statement, `skipDuplicates` being `ON CONFLICT DO NOTHING`: the
     * partial unique index on the open reasons of a tenant, kind and reference
     * is what refuses the second, and it refuses by returning no row rather
     * than by raising. The id is a uuid made here, so the primary key cannot be
     * the key it met.
     */
    async record(
        hold: NewTenantAccessHold,
        tx?: TransactionContext,
    ): Promise<TenantAccessHold | null> {
        const [row] = await this.dbOf(tx).tenantAccessHold.createManyAndReturn({
            data: [{ id: randomUUID(), ...hold, liftedAt: null, liftedBy: null }],
            skipDuplicates: true,
        });
        return row ? toTenantAccessHold(row) : null;
    }

    /** One guarded `UPDATE`: a reason lifted a moment earlier leaves the count at zero. */
    async lift(
        id: string,
        liftedAt: Date,
        liftedBy: string,
        tx?: TransactionContext,
    ): Promise<TenantAccessHold | null> {
        const db = this.dbOf(tx);
        const { count } = await db.tenantAccessHold.updateMany({
            where: { id, liftedAt: null },
            data: { liftedAt, liftedBy },
        });
        if (count !== 1) return null;
        const row = await db.tenantAccessHold.findUnique({
            where: { id },
            select: COLUMNS,
        });
        return row ? toTenantAccessHold(row) : null;
    }

    async listAllOf(tenantId: string): Promise<TenantAccessHold[]> {
        const rows = await this.db.tenantAccessHold.findMany({
            where: { tenantId },
            select: COLUMNS,
            orderBy: OLDEST_FIRST,
        });
        return rows.map(toTenantAccessHold);
    }

    /**
     * Locks the row by its id, whatever it holds, and reads it afterwards:
     * a transaction that waited for a lift reads the reason as the lift left
     * it, and finds it no longer open.
     */
    async lockOpen(id: string, tx: TransactionContext): Promise<TenantAccessHold | null> {
        const db = this.dbOf(tx);
        const locked = idsOf(
            await db.$queryRaw`
                SELECT "id" FROM "tenant_access_holds" WHERE "id" = ${id} FOR UPDATE`,
        );
        if (locked.length === 0) return null;
        const row = await db.tenantAccessHold.findUnique({ where: { id }, select: COLUMNS });
        return row && row.liftedAt === null ? toTenantAccessHold(row) : null;
    }

    /**
     * Locks the tenant's rows, whatever they hold, and reads them afterwards:
     * a transaction that waited for a lift reads the reason as the lift left
     * it.
     */
    async lockAllOf(tenantId: string, tx: TransactionContext): Promise<TenantAccessHold[]> {
        const db = this.dbOf(tx);
        await db.$queryRaw`
            SELECT "id" FROM "tenant_access_holds" WHERE "tenantId" = ${tenantId} FOR UPDATE`;
        const rows = await db.tenantAccessHold.findMany({
            where: { tenantId },
            select: COLUMNS,
            orderBy: OLDEST_FIRST,
        });
        return rows.map(toTenantAccessHold);
    }

    async replaceActors(
        replacements: readonly {
            readonly id: string;
            readonly recordedBy: string;
            readonly liftedBy: string | null;
        }[],
        tx?: TransactionContext,
    ): Promise<void> {
        const db = this.dbOf(tx);
        for (const { id, recordedBy, liftedBy } of replacements) {
            await db.tenantAccessHold.updateMany({ where: { id }, data: { recordedBy, liftedBy } });
        }
    }

    async forgetNotes(tenantId: string, tx?: TransactionContext): Promise<void> {
        await this.dbOf(tx).tenantAccessHold.updateMany({
            where: { tenantId, note: { not: null } },
            data: { note: null },
        });
    }
}
