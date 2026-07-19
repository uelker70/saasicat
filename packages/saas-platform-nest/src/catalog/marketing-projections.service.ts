// MarketingProjectionsService — CRUD für `marketing_projections`.
//
// Anders als Bundle/BusinessType **ohne Versionierung**: Marketing-Edits
// gehen direkt live, weil sie nur die Public-Catalog-Anzeige steuern,
// keine Bestand-Subscriptions. Pro (targetType, targetVersionId, locale)
// gibt es genau eine aktive Row; das Tripel ist im DB-Schema unique.
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §11.1 M3 + §9

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
    CreateMarketingProjectionData,
    MarketingProjectionFilter,
    MarketingProjectionRepository,
    MarketingProjectionRow,
    UpdateMarketingProjectionData,
} from '@saasicat/types';

import { MARKETING_PROJECTION_REPOSITORY_TOKEN } from './tokens.js';

@Injectable()
export class MarketingProjectionsService {
    constructor(
        @Inject(MARKETING_PROJECTION_REPOSITORY_TOKEN)
        private readonly repo: MarketingProjectionRepository,
    ) {}

    list(filter: MarketingProjectionFilter): Promise<MarketingProjectionRow[]> {
        return this.repo.list(filter);
    }

    async getById(id: string): Promise<MarketingProjectionRow> {
        const row = await this.repo.findById(id);
        if (!row) {
            throw new NotFoundException(`MarketingProjection '${id}' nicht gefunden`);
        }
        return row;
    }

    async create(data: CreateMarketingProjectionData): Promise<MarketingProjectionRow> {
        const locale = data.locale ?? 'de';
        const existing = await this.repo.findByTarget(
            data.targetType,
            data.targetVersionId,
            locale,
        );
        if (existing) {
            throw new ConflictException(
                `MarketingProjection für ${data.targetType}/${data.targetVersionId}/${locale} existiert bereits — nutze PATCH zum Editieren`,
            );
        }
        return this.repo.create({ ...data, locale });
    }

    async update(id: string, data: UpdateMarketingProjectionData): Promise<MarketingProjectionRow> {
        const existing = await this.repo.findById(id);
        if (!existing) {
            throw new NotFoundException(`MarketingProjection '${id}' nicht gefunden`);
        }
        return this.repo.update(id, data);
    }

    async delete(id: string): Promise<void> {
        const existing = await this.repo.findById(id);
        if (!existing) {
            throw new NotFoundException(`MarketingProjection '${id}' nicht gefunden`);
        }
        await this.repo.delete(id);
    }
}
