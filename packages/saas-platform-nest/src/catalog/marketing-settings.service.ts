// MarketingSettingsService — projekt-weite Marketing-Konfig (SPEC_V2 §6.5).
// Aktuell: `activeLocales` — die im Marketing-Catalog aktivierte Teilmenge
// des `availableLocales`-Pools.
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §6.5

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

    /** Liefert die gespeicherte Konfig oder `null` (dann gilt der volle Pool). */
    get(projectKey: string): Promise<MarketingSettingsRow | null> {
        return this.repo.get(projectKey);
    }

    upsert(projectKey: string, data: UpdateMarketingSettingsData): Promise<MarketingSettingsRow> {
        return this.repo.upsert(projectKey, data);
    }
}
