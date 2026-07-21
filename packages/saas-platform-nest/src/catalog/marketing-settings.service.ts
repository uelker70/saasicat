// MarketingSettingsService — project-wide marketing config (SPEC_V2 §6.5).
// Currently: `activeLocales` — the subset of the `availableLocales` pool
// activated in the marketing catalog.

import { Inject, Injectable } from '@nestjs/common';
import type {
    MarketingSettingsRepository,
    MarketingSettingsRow,
    UpdateMarketingSettingsData,
} from '@saasicat/types';

import { MARKETING_SETTINGS_REPOSITORY_TOKEN } from './tokens.js';

@Injectable()
export class MarketingSettingsService {
    constructor(
        @Inject(MARKETING_SETTINGS_REPOSITORY_TOKEN)
        private readonly repo: MarketingSettingsRepository,
    ) {}

    /** Returns the stored config or `null` (in which case the full pool applies). */
    get(projectKey: string): Promise<MarketingSettingsRow | null> {
        return this.repo.get(projectKey);
    }

    upsert(projectKey: string, data: UpdateMarketingSettingsData): Promise<MarketingSettingsRow> {
        return this.repo.upsert(projectKey, data);
    }
}
