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
    /** Assigned by the database at the write; the order the list is read in. */
    seq: number;
    noticedAt: Date;
    source: string;
    previous: unknown;
    current: unknown;
    acknowledgedAt: Date | null;
    acknowledgedBy: string | null;
}

/**
 * Narrow view of the injected client used by this repository — and of the
 * transaction client, which carries the same delegates.
 */
interface AppliedSettingsPrisma {
    appliedSettings: PrismaModelDelegateLike<AppliedSettingsDbRow>;
    settingsChange: PrismaModelDelegateLike<SettingsChangeDbRow>;
}

/** Root-client fields used directly: the two delegates and the interactive transaction. */
interface AppliedSettingsRepositoryClient {
    appliedSettings: unknown;
    settingsChange: unknown;
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
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

    async writeApplied(
        record: AppliedSettingsRecord,
        expectedFingerprint: string | null,
    ): Promise<boolean> {
        return replaceRecord(this.db, record, expectedFingerprint);
    }

    async recordChange(
        change: NewSettingsChange,
        record: AppliedSettingsRecord,
        expectedFingerprint: string,
    ): Promise<SettingsChangeRecord | null> {
        // One transaction, because the change and the record it supersedes are
        // one fact. A change written and a record not replaced would make the
        // next start notice again and write a duplicate; a record replaced and
        // a change not written would make it say nothing, ever.
        return this.prisma.$transaction(async (tx) => {
            const db = tx as AppliedSettingsPrisma;
            if (!(await replaceRecord(db, record, expectedFingerprint))) return null;
            const row = await db.settingsChange.create({
                data: {
                    noticedAt: change.noticedAt,
                    source: change.source,
                    previous: change.previous,
                    current: change.current,
                },
            });
            return toChangeRecord(row);
        });
    }

    async listChanges(filter: SettingsChangeFilter = {}): Promise<SettingsChangeRecord[]> {
        const rows = await this.db.settingsChange.findMany({
            where:
                filter.acknowledged === undefined
                    ? undefined
                    : { acknowledgedAt: filter.acknowledged ? { not: null } : null },
            // By the number the database gave each change at its write, not by
            // `noticedAt`: a start's clock says when it noticed, the number says
            // in which order the record moved, and only the second is the
            // order the list promises.
            orderBy: [{ seq: 'desc' }],
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

/**
 * The guarded write behind both port methods. `null` expects no row and
 * inserts one only where the table is empty — `skipDuplicates` is
 * `ON CONFLICT DO NOTHING`; a fingerprint expects the row to still carry it.
 * The count says whether this caller was the one who moved the record: a
 * concurrent writer that got there first leaves the guard unmatched, rather
 * than a second row or a lost update.
 */
async function replaceRecord(
    db: AppliedSettingsPrisma,
    record: AppliedSettingsRecord,
    expectedFingerprint: string | null,
): Promise<boolean> {
    const values = {
        fingerprint: record.fingerprint,
        settings: record.settings,
        source: record.source,
        appliedAt: record.appliedAt,
    };
    const { count } =
        expectedFingerprint === null
            ? await db.appliedSettings.createMany({
                  data: [{ id: INSTALLATION_ROW_ID, ...values }],
                  skipDuplicates: true,
              })
            : await db.appliedSettings.updateMany({
                  where: { id: INSTALLATION_ROW_ID, fingerprint: expectedFingerprint },
                  data: values,
              });
    return count === 1;
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
