// What a promotion's value may be, for the type it has.
//
// Only the bounds no price could make sense of are refused here: a percentage
// above 100 or at 0, a negative amount, a negative intro price, a part of a
// month. Whether an intro price or an amount fits a line depends on the price
// it meets, which differs per plan and rhythm and moves when a new version is
// published, so that bound is held where a promotion is resolved (`applyPromo`).

import { UnprocessableEntityException } from '@nestjs/common';
import { CATALOG_ERROR_CODES } from '@saasicat/core';
import type { PromotionType } from '@saasicat/core';

/** Throws unless `value` is one a promotion of `type` takes. */
export function assertPromotionValue(type: PromotionType, value: unknown): void {
    if (takesValue(type, value)) return;
    throw new UnprocessableEntityException({
        code: CATALOG_ERROR_CODES.PROMOTION_VALUE_INVALID,
        message:
            `The value of a '${type}' promotion is not one its type takes: a percentage above 0 ` +
            'and at most 100, an amount above 0, an intro price of at least 0 for a whole number ' +
            'of months, or a whole number of free months.',
        params: { type },
    });
}

function takesValue(type: PromotionType, value: unknown): boolean {
    switch (type) {
        case 'percent':
            return isAmount(value) && value > 0 && value <= 100;
        case 'amount':
            return isAmount(value) && value > 0;
        case 'intro':
            return (
                typeof value === 'object' &&
                value !== null &&
                isAmount((value as { price?: unknown }).price) &&
                (value as { price: number }).price >= 0 &&
                isMonths((value as { months?: unknown }).months)
            );
        case 'freeMonths':
            return isMonths(value);
        default:
            return false;
    }
}

function isAmount(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isMonths(value: unknown): boolean {
    return Number.isInteger(value) && (value as number) >= 1;
}
