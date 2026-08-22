// PromotionsService — CRUD for `promotions`.
//
// Like MarketingProjections but **without versioning** — promotions are changed
// directly because they only control the public catalog display.

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CATALOG_ERROR_CODES } from '@saasicat/types';
import type {
    CreatePromotionData,
    PromotionRepository,
    PromotionRow,
    UpdatePromotionData,
} from '@saasicat/types';

import { PROMOTION_REPOSITORY_TOKEN } from './catalog.tokens.js';

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
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.PROMOTION_NOT_FOUND,
                message: `Promotion '${id}' not found`,
                params: { promotionId: id },
            });
        }
        return row;
    }

    create(data: CreatePromotionData): Promise<PromotionRow> {
        return this.repo.create(data);
    }

    async update(id: string, data: UpdatePromotionData): Promise<PromotionRow> {
        const existing = await this.repo.findById(id);
        if (!existing) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.PROMOTION_NOT_FOUND,
                message: `Promotion '${id}' not found`,
                params: { promotionId: id },
            });
        }
        return this.repo.update(id, data);
    }

    async delete(id: string): Promise<void> {
        const existing = await this.repo.findById(id);
        if (!existing) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.PROMOTION_NOT_FOUND,
                message: `Promotion '${id}' not found`,
                params: { promotionId: id },
            });
        }
        await this.repo.delete(id);
    }
}
