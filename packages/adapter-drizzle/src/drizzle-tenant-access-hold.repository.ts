import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
    type NewTenantAccessHold,
    type TenantAccessHold,
    type TenantAccessHoldKind,
    type TenantAccessHoldPort,
    type TransactionContext,
    toTenantAccessHold,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient, resolveDb } from './client.js';
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

    async listTenantIdsHeldBy(kinds: readonly TenantAccessHoldKind[]): Promise<string[]> {
        if (kinds.length === 0) return [];
        const rows = await this.db
            .selectDistinct({ tenantId: tenantAccessHolds.tenantId })
            .from(tenantAccessHolds)
            .where(
                and(
                    inArray(tenantAccessHolds.kind, [...kinds]),
                    isNull(tenantAccessHolds.liftedAt),
                ),
            );
        return rows.map((row) => row.tenantId);
    }

    /**
     * `ON CONFLICT DO NOTHING` with no target, because the key it has to meet
     * is the partial unique index on a tenant's open reasons, which is over an
     * expression and has no columns to name. The id is a uuid made here, so the
     * primary key cannot be the key it met: no row back means the same reason
     * is already open.
     */
    async record(
        hold: NewTenantAccessHold,
        tx?: TransactionContext,
    ): Promise<TenantAccessHold | null> {
        const [row] = await resolveDb(this.db, tx)
            .insert(tenantAccessHolds)
            .values({ id: randomUUID(), ...hold, liftedAt: null, liftedBy: null })
            .onConflictDoNothing()
            .returning();
        return row ? toTenantAccessHold(row) : null;
    }

    /** One guarded `UPDATE`: a reason lifted a moment earlier returns no row. */
    async lift(
        id: string,
        liftedAt: Date,
        liftedBy: string,
        tx?: TransactionContext,
    ): Promise<TenantAccessHold | null> {
        const [row] = await resolveDb(this.db, tx)
            .update(tenantAccessHolds)
            .set({ liftedAt, liftedBy })
            .where(and(eq(tenantAccessHolds.id, id), isNull(tenantAccessHolds.liftedAt)))
            .returning();
        return row ? toTenantAccessHold(row) : null;
    }

    async listAllOf(tenantId: string): Promise<TenantAccessHold[]> {
        const rows = await this.db
            .select()
            .from(tenantAccessHolds)
            .where(eq(tenantAccessHolds.tenantId, tenantId))
            .orderBy(asc(tenantAccessHolds.since), asc(tenantAccessHolds.id));
        return rows.map(toTenantAccessHold);
    }

    /**
     * Locks the row by its id, whatever it holds. A transaction that waited
     * for a lift is handed the row as the lift left it, since PostgreSQL
     * returns the version it locked, and finds the reason no longer open.
     */
    async lockOpen(id: string, tx: TransactionContext): Promise<TenantAccessHold | null> {
        const [row] = await resolveDb(this.db, tx)
            .select()
            .from(tenantAccessHolds)
            .where(eq(tenantAccessHolds.id, id))
            .for('update');
        return row && row.liftedAt === null ? toTenantAccessHold(row) : null;
    }

    /**
     * Locks the tenant's rows, whatever they hold. A transaction that waited
     * for a lift is handed each row as the lift left it, since PostgreSQL
     * returns the version it locked.
     */
    async lockAllOf(tenantId: string, tx: TransactionContext): Promise<TenantAccessHold[]> {
        const rows = await resolveDb(this.db, tx)
            .select()
            .from(tenantAccessHolds)
            .where(eq(tenantAccessHolds.tenantId, tenantId))
            .orderBy(asc(tenantAccessHolds.since), asc(tenantAccessHolds.id))
            .for('update');
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
        const db = resolveDb(this.db, tx);
        for (const { id, recordedBy, liftedBy } of replacements) {
            await db
                .update(tenantAccessHolds)
                .set({ recordedBy, liftedBy })
                .where(eq(tenantAccessHolds.id, id));
        }
    }

    async forgetNotes(tenantId: string, tx?: TransactionContext): Promise<void> {
        await resolveDb(this.db, tx)
            .update(tenantAccessHolds)
            .set({ note: null })
            .where(
                and(eq(tenantAccessHolds.tenantId, tenantId), isNotNull(tenantAccessHolds.note)),
            );
    }
}
