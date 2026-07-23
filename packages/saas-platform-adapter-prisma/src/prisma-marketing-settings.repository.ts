import { Inject, Injectable } from '@nestjs/common';
import type {
    MarketingSettingsRepository,
    MarketingSettingsRow,
    UpdateMarketingSettingsData,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type PrismaLike,
    type PrismaModelDelegateLike,
} from './prisma-client-token.js';
import { toStringArray } from './tx.js';

/** DB columns this repository reads from `marketing_settings`. */
interface MarketingSettingsDbRow {
    projectKey: string;
    activeLocales: unknown;
    updatedAt: Date;
}

/** Narrow view of the injected client used by this repository. */
interface MarketingSettingsPrisma {
    marketingSettings: PrismaModelDelegateLike<MarketingSettingsDbRow>;
}

/**
 * `MarketingSettingsRepository` against the canonical `marketing_settings`
 * table (one row per project). A missing row means "full locale pool active",
 * so `get` returns null and the platform falls back to the pool.
 */
@Injectable()
export class PrismaMarketingSettingsRepository implements MarketingSettingsRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    private get db(): MarketingSettingsPrisma {
        return this.prisma as unknown as MarketingSettingsPrisma;
    }

    async get(projectKey: string): Promise<MarketingSettingsRow | null> {
        const row = await this.db.marketingSettings.findUnique({ where: { projectKey } });
        return row ? toRow(row) : null;
    }

    async upsert(
        projectKey: string,
        data: UpdateMarketingSettingsData,
    ): Promise<MarketingSettingsRow> {
        const row = await this.db.marketingSettings.upsert({
            where: { projectKey },
            create: { projectKey, activeLocales: data.activeLocales },
            update: { activeLocales: data.activeLocales },
        });
        return toRow(row);
    }
}

function toRow(row: MarketingSettingsDbRow): MarketingSettingsRow {
    return {
        projectKey: row.projectKey,
        activeLocales: toStringArray(row.activeLocales),
        updatedAt: row.updatedAt.toISOString(),
    };
}
