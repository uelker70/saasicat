import { Injectable } from '@nestjs/common';
import type { PromoRevenueDeductionAggregator } from '@saasicat/types';

/**
 * Default `PromoRevenueDeductionAggregator` for apps without an
 * `InvoiceDiscount` table: always reports `'0.00'` (the documented port
 * fallback). Mirrors the adapter-prisma default — kept per-adapter instead
 * of a shared package because 10 stable lines do not justify a dependency.
 */
@Injectable()
export class ZeroPromoRevenueDeductionAggregator implements PromoRevenueDeductionAggregator {
    async sumGrossForPromoCode(_promoCodeId: string): Promise<string> {
        return '0.00';
    }
}
