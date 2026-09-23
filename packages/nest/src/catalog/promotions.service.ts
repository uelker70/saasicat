// PromotionsService — CRUD for `promotions`.
//
// Like MarketingProjections but **without versioning** — promotions are changed
// directly because they only control the public catalog display.

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CATALOG_ERROR_CODES } from '@saasicat/core';
import type {
    CreatePromotionData,
    PromotionRepository,
    PromotionRow,
    UpdatePromotionData,
} from '@saasicat/core';

import { PROMOTION_REPOSITORY_TOKEN } from './catalog.tokens.js';
import { assertPromotionValue } from './promotion-value.js';

@Injectable()
export class PromotionsService {
    constructor(
        @Inject(PROMOTION_REPOSITORY_TOKEN)
        private readonly repo: PromotionRepository,
    ) {}

    list(): Promise<PromotionRow[]> {
        return this.repo.list();
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

    async create(data: CreatePromotionData): Promise<PromotionRow> {
        assertPromotionValue(data.type, data.value);
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
        // The pair as it will be stored: a change of type alone meets the value
        // already there, and a percentage of 150 is no more acceptable for having
        // been an amount a moment ago. Only a field left out keeps the stored one;
        // a `null` sent for it is what would be stored, so it is what is judged.
        assertPromotionValue(
            data.type === undefined ? existing.type : data.type,
            data.value === undefined ? existing.value : data.value,
        );
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
