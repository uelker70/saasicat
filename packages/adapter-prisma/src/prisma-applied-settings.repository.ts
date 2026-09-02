import { Inject, Injectable } from '@nestjs/common';
import type {
    AppliedSettingsPort,
    AppliedSettingsRecord,
    AppliedSettingsValues,
    NewSettingsChange,
    SettingsChangeFilter,
    SettingsChangeRecord,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/**
 * The one row `applied_settings` holds. It is the column default in the
 * canonical schema and the value the `CHECK` in `constraints.postgres.sql`
 * allows, so a second insert collides with the primary key and a caller that
 * supplies another id is refused by the database.
 */
const INSTALLATION_ROW_ID = 'installation';

interface AppliedSettingsDbRow {
    fingerprint: string;
    settings: unknown;
    source: string;
    appliedAt: Date;
}

interface SettingsChangeDbRow {
    id: string;
    noticedAt: Date;
    source: string;
    previous: unknown;
    current: unknown;
    acknowledgedAt: Date | null;
    acknowledgedBy: string | null;
}

/** Narrow view of the injected client used by this repository. */
interface AppliedSettingsPrisma {
    appliedSettings: PrismaModelDelegateLike<AppliedSettingsDbRow>;
    settingsChange: PrismaModelDelegateLike<SettingsChangeDbRow>;
}

interface AppliedSettingsRepositoryClient {
    appliedSettings: unknown;
    settingsChange: unknown;
}

/**
 * `AppliedSettingsPort` against the canonical `applied_settings` and
 * `settings_changes` tables.
 */
@Injectable()
export class PrismaAppliedSettingsRepository implements AppliedSettingsPort {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: AppliedSettingsRepositoryClient,
    ) {}

    private get db(): AppliedSettingsPrisma {
        return this.prisma as unknown as AppliedSettingsPrisma;
    }

    async readApplied(): Promise<AppliedSettingsRecord | null> {
        const row = await this.db.appliedSettings.findUnique({
            where: { id: INSTALLATION_ROW_ID },
        });
        return row ? toAppliedRecord(row) : null;
    }

    async writeApplied(record: AppliedSettingsRecord): Promise<void> {
        const values = {
            fingerprint: record.fingerprint,
            settings: record.settings,
            source: record.source,
            appliedAt: record.appliedAt,
        };
        await this.db.appliedSettings.upsert({
            where: { id: INSTALLATION_ROW_ID },
            create: { id: INSTALLATION_ROW_ID, ...values },
            update: values,
        });
    }

    async recordChange(change: NewSettingsChange): Promise<SettingsChangeRecord> {
        const row = await this.db.settingsChange.create({
            data: {
                noticedAt: change.noticedAt,
                source: change.source,
                previous: change.previous,
                current: change.current,
            },
        });
        return toChangeRecord(row);
    }

    async listChanges(filter: SettingsChangeFilter = {}): Promise<SettingsChangeRecord[]> {
        const rows = await this.db.settingsChange.findMany({
            where:
                filter.acknowledged === undefined
                    ? undefined
                    : { acknowledgedAt: filter.acknowledged ? { not: null } : null },
            // `id` breaks the tie: `noticedAt` is one `new Date()` per start, and
            // several replicas starting together after one edit share the
            // millisecond. Without it the two adapters — or one adapter twice —
            // may answer the same rows in two orders.
            orderBy: [{ noticedAt: 'desc' }, { id: 'desc' }],
            ...(filter.limit === undefined ? {} : { take: filter.limit }),
        });
        return rows.map(toChangeRecord);
    }

    async acknowledgeChange(
        id: string,
        acknowledgedBy: string,
        acknowledgedAt: Date,
    ): Promise<SettingsChangeRecord | null> {
        // One guarded UPDATE rather than read-then-write: the first
        // acknowledgement is the fact, and two operators clicking at once must
        // not both become it.
        await this.db.settingsChange.updateMany({
            where: { id, acknowledgedAt: null },
            data: { acknowledgedAt, acknowledgedBy },
        });
        const row = await this.db.settingsChange.findUnique({ where: { id } });
        return row ? toChangeRecord(row) : null;
    }
}

function toAppliedRecord(row: AppliedSettingsDbRow): AppliedSettingsRecord {
    return {
        fingerprint: row.fingerprint,
        settings: toValues(row.settings),
        source: row.source,
        appliedAt: row.appliedAt,
    };
}

function toChangeRecord(row: SettingsChangeDbRow): SettingsChangeRecord {
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
