import { Inject, Injectable } from '@nestjs/common';
import type {
    MarketingSettingsRepository,
    MarketingSettingsRow,
    UpdateMarketingSettingsData,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';
import { toStringArray } from './tx.js';

/**
 * The one row the table holds. It is the column default in the canonical
 * schema, so `create` leaving `id` out lands on the same row every time and a
 * second insert collides with the primary key.
 */
const SETTINGS_ROW_ID = 'marketing-settings';

/** DB columns this repository reads from `marketing_settings`. */
interface MarketingSettingsDbRow {
    activeLocales: unknown;
    updatedAt: Date;
}

/** Narrow view of the injected client used by this repository. */
interface MarketingSettingsPrisma {
    marketingSettings: PrismaModelDelegateLike<MarketingSettingsDbRow>;
}

interface MarketingSettingsRepositoryClient {
    marketingSettings: unknown;
}

/**
 * `MarketingSettingsRepository` against the canonical `marketing_settings`
 * table, which holds at most one row. A missing row means "full locale pool
 * active", so `get` returns null and the platform falls back to the pool.
 */
@Injectable()
export class PrismaMarketingSettingsRepository implements MarketingSettingsRepository {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: MarketingSettingsRepositoryClient,
    ) {}

    private get db(): MarketingSettingsPrisma {
        return this.prisma as unknown as MarketingSettingsPrisma;
    }

    async get(): Promise<MarketingSettingsRow | null> {
        const row = await this.db.marketingSettings.findUnique({
            where: { id: SETTINGS_ROW_ID },
        });
        return row ? toRow(row) : null;
    }

    async upsert(data: UpdateMarketingSettingsData): Promise<MarketingSettingsRow> {
        const row = await this.db.marketingSettings.upsert({
            where: { id: SETTINGS_ROW_ID },
            create: { id: SETTINGS_ROW_ID, activeLocales: data.activeLocales },
            update: { activeLocales: data.activeLocales },
        });
        return toRow(row);
    }
}

function toRow(row: MarketingSettingsDbRow): MarketingSettingsRow {
    return {
        activeLocales: toStringArray(row.activeLocales),
        updatedAt: row.updatedAt.toISOString(),
    };
}
