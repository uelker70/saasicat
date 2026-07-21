import { Injectable } from '@nestjs/common';
import type { PromoRevenueDeductionAggregator } from '@saasicat/types';

/**
 * Default `PromoRevenueDeductionAggregator` for apps without an
 * `InvoiceDiscount` table: always reports `'0.00'` (the documented port
 * fallback). Apps with invoice discounts replace it with their own adapter.
 */
@Injectable()
export class ZeroPromoRevenueDeductionAggregator implements PromoRevenueDeductionAggregator {
    async sumGrossForPromoCode(_promoCodeId: string): Promise<string> {
        return '0.00';
    }
}
