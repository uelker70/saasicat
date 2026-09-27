import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import {
    type MaintenanceWindowChanges,
    type MaintenanceWindowPort,
    type MaintenanceWindowRecord,
    type MaintenanceWindowStage,
    type NewMaintenanceWindow,
    toMaintenanceWindowRecord,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { maintenanceWindows } from './schema.js';

/** `MaintenanceWindowPort` against the canonical `maintenance_windows` table. */
@Injectable()
export class DrizzleMaintenanceWindowRepository implements MaintenanceWindowPort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async findOpen(): Promise<MaintenanceWindowRecord | null> {
        const rows = await this.db
            .select()
            .from(maintenanceWindows)
            .where(isNull(maintenanceWindows.endedAt))
            .limit(1);
        return rows[0] ? toMaintenanceWindowRecord(rows[0]) : null;
    }

    async listRecent(limit: number): Promise<MaintenanceWindowRecord[]> {
        const rows = await this.db
            .select()
            .from(maintenanceWindows)
            .orderBy(desc(maintenanceWindows.createdAt), desc(maintenanceWindows.id))
            .limit(limit);
        return rows.map(toMaintenanceWindowRecord);
    }

    /**
     * `ON CONFLICT DO NOTHING` with no target, because the key it has to meet
     * is the partial unique index on open windows, which has no columns to
     * name. The id is a uuid made here, so the primary key cannot be the key it
     * met: no row back means a window is already open.
     */
    async open(window: NewMaintenanceWindow): Promise<MaintenanceWindowRecord | null> {
        const [row] = await this.db
            .insert(maintenanceWindows)
            .values({ id: randomUUID(), ...window, endedAt: null, endedBy: null })
            .onConflictDoNothing()
            .returning();
        return row ? toMaintenanceWindowRecord(row) : null;
    }

    /**
     * One guarded `UPDATE`: the stage the caller read is in the `WHERE`, so a
     * window another operator moved on a moment earlier returns no row instead
     * of being moved twice.
     */
    async update(
        id: string,
        stage: MaintenanceWindowStage,
        changes: MaintenanceWindowChanges,
    ): Promise<MaintenanceWindowRecord | null> {
        const [row] = await this.db
            .update(maintenanceWindows)
            .set(changes)
            .where(
                and(
                    eq(maintenanceWindows.id, id),
                    isNull(maintenanceWindows.endedAt),
                    stage === 'locked'
                        ? isNotNull(maintenanceWindows.lockedAt)
                        : isNull(maintenanceWindows.lockedAt),
                ),
            )
            .returning();
        return row ? toMaintenanceWindowRecord(row) : null;
    }
}
