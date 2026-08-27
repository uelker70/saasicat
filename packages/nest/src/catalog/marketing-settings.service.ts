// MarketingSettingsService — project-wide marketing config.
// Currently: `activeLocales` — the subset of the `availableLocales` pool
// activated in the marketing catalog.

import { Inject, Injectable } from '@nestjs/common';
import type {
    MarketingSettingsRepository,
    MarketingSettingsRow,
    UpdateMarketingSettingsData,
} from '@saasicat/core';

import { MARKETING_SETTINGS_REPOSITORY_TOKEN } from './catalog.tokens.js';

@Injectable()
export class MarketingSettingsService {
    constructor(
        @Inject(MARKETING_SETTINGS_REPOSITORY_TOKEN)
        private readonly repo: MarketingSettingsRepository,
    ) {}

    /** Returns the stored config or `null` (in which case the full pool applies). */
    get(): Promise<MarketingSettingsRow | null> {
        return this.repo.get();
    }

    upsert(data: UpdateMarketingSettingsData): Promise<MarketingSettingsRow> {
        return this.repo.upsert(data);
    }
}
