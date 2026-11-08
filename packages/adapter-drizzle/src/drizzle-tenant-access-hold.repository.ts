import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
    type NewTenantAccessHold,
    type TenantAccessHold,
    type TenantAccessHoldPort,
    toTenantAccessHold,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { tenantAccessHolds } from './schema.js';

/** `TenantAccessHoldPort` against the canonical `tenant_access_holds` table. */
@Injectable()
export class DrizzleTenantAccessHoldRepository implements TenantAccessHoldPort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async listOpen(tenantId: string): Promise<TenantAccessHold[]> {
        const rows = await this.db
            .select()
            .from(tenantAccessHolds)
            .where(
                and(eq(tenantAccessHolds.tenantId, tenantId), isNull(tenantAccessHolds.liftedAt)),
            )
            .orderBy(asc(tenantAccessHolds.since), asc(tenantAccessHolds.id));
        return rows.map(toTenantAccessHold);
    }

    async listOpenFor(tenantIds: readonly string[]): Promise<TenantAccessHold[]> {
        if (tenantIds.length === 0) return [];
        const rows = await this.db
            .select()
            .from(tenantAccessHolds)
            .where(
                and(
                    inArray(tenantAccessHolds.tenantId, [...tenantIds]),
                    isNull(tenantAccessHolds.liftedAt),
                ),
            )
            .orderBy(asc(tenantAccessHolds.since), asc(tenantAccessHolds.id));
        return rows.map(toTenantAccessHold);
    }

    /**
     * `ON CONFLICT DO NOTHING` with no target, because the key it has to meet
     * is the partial unique index on a tenant's open reasons, which is over an
     * expression and has no columns to name. The id is a uuid made here, so the
     * primary key cannot be the key it met: no row back means the same reason
     * is already open.
     */
    async record(hold: NewTenantAccessHold): Promise<TenantAccessHold | null> {
        const [row] = await this.db
            .insert(tenantAccessHolds)
            .values({ id: randomUUID(), ...hold, liftedAt: null, liftedBy: null })
            .onConflictDoNothing()
            .returning();
        return row ? toTenantAccessHold(row) : null;
    }

    /** One guarded `UPDATE`: a reason lifted a moment earlier returns no row. */
    async lift(id: string, liftedAt: Date, liftedBy: string): Promise<TenantAccessHold | null> {
        const [row] = await this.db
            .update(tenantAccessHolds)
            .set({ liftedAt, liftedBy })
            .where(and(eq(tenantAccessHolds.id, id), isNull(tenantAccessHolds.liftedAt)))
            .returning();
        return row ? toTenantAccessHold(row) : null;
    }
}
