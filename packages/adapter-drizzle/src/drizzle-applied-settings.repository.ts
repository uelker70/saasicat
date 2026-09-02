import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type {
    AppliedSettingsPort,
    AppliedSettingsRecord,
    AppliedSettingsValues,
    NewSettingsChange,
    SettingsChangeFilter,
    SettingsChangeRecord,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { appliedSettings, settingsChanges } from './schema.js';

/**
 * The one row `applied_settings` holds — the column default in the canonical
 * schema and the only id the `CHECK` in `constraints.postgres.sql` allows.
 */
const INSTALLATION_ROW_ID = 'installation';

/**
 * `AppliedSettingsPort` against the canonical `applied_settings` and
 * `settings_changes` tables.
 */
@Injectable()
export class DrizzleAppliedSettingsRepository implements AppliedSettingsPort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async readApplied(): Promise<AppliedSettingsRecord | null> {
        const rows = await this.db
            .select()
            .from(appliedSettings)
            .where(eq(appliedSettings.id, INSTALLATION_ROW_ID))
            .limit(1);
        const row = rows[0];
        if (!row) return null;
        return {
            fingerprint: row.fingerprint,
            settings: toValues(row.settings),
            source: row.source,
            appliedAt: row.appliedAt,
        };
    }

    async writeApplied(record: AppliedSettingsRecord): Promise<void> {
        const values = {
            fingerprint: record.fingerprint,
            settings: record.settings,
            source: record.source,
            appliedAt: record.appliedAt,
        };
        await this.db
            .insert(appliedSettings)
            .values({ id: INSTALLATION_ROW_ID, ...values })
            .onConflictDoUpdate({ target: appliedSettings.id, set: values });
    }

    async recordChange(change: NewSettingsChange): Promise<SettingsChangeRecord> {
        const row = {
            id: randomUUID(),
            noticedAt: change.noticedAt,
            source: change.source,
            previous: change.previous,
            current: change.current,
            acknowledgedAt: null,
            acknowledgedBy: null,
        };
        await this.db.insert(settingsChanges).values(row);
        return toChangeRecord(row);
    }

    async listChanges(filter: SettingsChangeFilter = {}): Promise<SettingsChangeRecord[]> {
        const acknowledgement =
            filter.acknowledged === undefined
                ? undefined
                : filter.acknowledged
                  ? isNotNull(settingsChanges.acknowledgedAt)
                  : isNull(settingsChanges.acknowledgedAt);
        const query = this.db
            .select()
            .from(settingsChanges)
            .where(acknowledgement)
            // `id` breaks the tie between rows noticed in the same millisecond —
            // several replicas starting together after one edit.
            .orderBy(desc(settingsChanges.noticedAt), desc(settingsChanges.id));
        const rows = filter.limit === undefined ? await query : await query.limit(filter.limit);
        return rows.map(toChangeRecord);
    }

    async acknowledgeChange(
        id: string,
        acknowledgedBy: string,
        acknowledgedAt: Date,
    ): Promise<SettingsChangeRecord | null> {
        // One guarded UPDATE: the first acknowledgement is the fact, and two
        // operators clicking at once must not both become it.
        await this.db
            .update(settingsChanges)
            .set({ acknowledgedAt, acknowledgedBy })
            .where(and(eq(settingsChanges.id, id), isNull(settingsChanges.acknowledgedAt)));
        const rows = await this.db
            .select()
            .from(settingsChanges)
            .where(eq(settingsChanges.id, id))
            .limit(1);
        return rows[0] ? toChangeRecord(rows[0]) : null;
    }
}

interface SettingsChangeRow {
    id: string;
    noticedAt: Date;
    source: string;
    previous: unknown;
    current: unknown;
    acknowledgedAt: Date | null;
    acknowledgedBy: string | null;
}

function toChangeRecord(row: SettingsChangeRow): SettingsChangeRecord {
    return {
        id: row.id,
        noticedAt: row.noticedAt,
        source: row.source,
        previous: toValues(row.previous),
        current: toValues(row.current),
        acknowledgedAt: row.acknowledgedAt,
        acknowledgedBy: row.acknowledgedBy,
    };
}

/** A JSON column holding the settings subtree; anything else reads as empty. */
function toValues(value: unknown): AppliedSettingsValues {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as AppliedSettingsValues)
        : {};
}
