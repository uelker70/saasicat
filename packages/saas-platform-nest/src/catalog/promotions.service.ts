// PromotionsService — CRUD for `promotions` (SPEC_V2 §9a).
//
// Like MarketingProjections but **without versioning** — promotions are changed
// directly because they only control the public catalog display.

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
    CreatePromotionData,
    PromotionRepository,
    PromotionRow,
    UpdatePromotionData,
} from '@saasicat/types';

import { PROMOTION_REPOSITORY_TOKEN } from './tokens.js';

@Injectable()
export class PromotionsService {
    constructor(
        @Inject(PROMOTION_REPOSITORY_TOKEN)
        private readonly repo: PromotionRepository,
    ) {}

    list(projectKey: string): Promise<PromotionRow[]> {
        return this.repo.list({ projectKey });
    }

    async getById(id: string): Promise<PromotionRow> {
        const row = await this.repo.findById(id);
        if (!row) {
            throw new NotFoundException(`Promotion '${id}' nicht gefunden`);
        }
        return row;
    }

    create(data: CreatePromotionData): Promise<PromotionRow> {
        return this.repo.create(data);
    }

    async update(id: string, data: UpdatePromotionData): Promise<PromotionRow> {
        const existing = await this.repo.findById(id);
        if (!existing) {
            throw new NotFoundException(`Promotion '${id}' nicht gefunden`);
        }
        return this.repo.update(id, data);
    }

    async delete(id: string): Promise<void> {
        const existing = await this.repo.findById(id);
        if (!existing) {
            throw new NotFoundException(`Promotion '${id}' nicht gefunden`);
        }
        await this.repo.delete(id);
    }
}
