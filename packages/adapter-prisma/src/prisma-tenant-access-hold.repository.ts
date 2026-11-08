import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
    type CanonicalTenantAccessHoldRow,
    type NewTenantAccessHold,
    type TenantAccessHold,
    type TenantAccessHoldPort,
    toTenantAccessHold,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the injected client used by this repository. */
interface TenantAccessHoldPrisma {
    tenantAccessHold: PrismaModelDelegateLike<CanonicalTenantAccessHoldRow>;
}

/**
 * What the constructor takes: a client that has the delegate. A client
 * generated from a schema without fragment 28 fails to compile here rather
 * than at the first request.
 */
interface TenantAccessHoldRepositoryClient {
    tenantAccessHold: unknown;
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
        // SAFETY: `tenantAccessHold` is the delegate of fragment 28's model,
        // whose rows are `CanonicalTenantAccessHoldRow`; the bundle hands this
        // repository the canonical client.
        return this.prisma as TenantAccessHoldPrisma;
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

    /**
     * One statement, `skipDuplicates` being `ON CONFLICT DO NOTHING`: the
     * partial unique index on the open reasons of a tenant, kind and reference
     * is what refuses the second, and it refuses by returning no row rather
     * than by raising. The id is a uuid made here, so the primary key cannot be
     * the key it met.
     */
    async record(hold: NewTenantAccessHold): Promise<TenantAccessHold | null> {
        const [row] = await this.db.tenantAccessHold.createManyAndReturn({
            data: [{ id: randomUUID(), ...hold, liftedAt: null, liftedBy: null }],
            skipDuplicates: true,
        });
        return row ? toTenantAccessHold(row) : null;
    }

    /** One guarded `UPDATE`: a reason lifted a moment earlier leaves the count at zero. */
    async lift(id: string, liftedAt: Date, liftedBy: string): Promise<TenantAccessHold | null> {
        const { count } = await this.db.tenantAccessHold.updateMany({
            where: { id, liftedAt: null },
            data: { liftedAt, liftedBy },
        });
        if (count !== 1) return null;
        const row = await this.db.tenantAccessHold.findUnique({
            where: { id },
            select: COLUMNS,
        });
        return row ? toTenantAccessHold(row) : null;
    }
}
