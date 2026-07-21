// Promo code calculator — pure functions. No DB, no side effects.
//
// Instead of Prisma types, the calculator uses the generic wire-format
// types from @saasicat/types. This makes it equally usable for all
// consuming apps (including those working purely via the wire format).

import type {
    BillingCycle,
    PromoCodeDurationType,
    PromoCodeValueType,
} from '@saasicat/types';
import { round2 } from './math.js';

/** Structural view of a PromoCode for the calculator functions.
 *
 * `value` deliberately accepts `number | string | { toString(): string }`, so
 * that a Prisma `Decimal` (its own class with `toString()`) can be passed
 * without a cast. Internally `Number(...)` is called.
 */
export interface PromoCodeForCalc {
    valueType: PromoCodeValueType | string;
    value: number | string | { toString(): string };
    durationType?: PromoCodeDurationType | string;
    durationValue?: number | null;
}

export function computeDiscountGross(
    plan: { gross: number },
    code: Pick<PromoCodeForCalc, 'valueType' | 'value'>,
): number {
    const v = Number(code.value);
    if (code.valueType === 'PERCENT') {
        return round2((plan.gross * v) / 100);
    }
    return round2(v);
}

export function computeDiscountedGross(planGross: number, discountGross: number): number {
    return round2(planGross - discountGross);
}

/**
 * Next date on which the list price applies again (= end of the discount
 * period). For ONCE: the first invoice is discounted, all others are
 * regular — so directly the second period.
 */
export function computeRegularStartsAt(
    startsAt: Date,
    cycle: BillingCycle,
    durationType: PromoCodeDurationType,
    durationValue: number | null,
): Date {
    const result = new Date(startsAt);
    if (durationType === 'ONCE') {
        return addCycles(result, cycle, 1);
    }
    if (durationType === 'MONTHS') {
        result.setMonth(result.getMonth() + (durationValue ?? 0));
        return result;
    }
    return addCycles(result, cycle, durationValue ?? 0);
}

export function addCycles(date: Date, cycle: BillingCycle, n: number): Date {
    const r = new Date(date);
    if (cycle === 'YEARLY') {
        r.setFullYear(r.getFullYear() + n);
    } else {
        r.setMonth(r.getMonth() + n);
    }
    return r;
}

export function buildLabel(
    code: Pick<PromoCodeForCalc, 'valueType' | 'value' | 'durationType' | 'durationValue'>,
    cycle: BillingCycle,
): string {
    const value = Number(code.value);
    const valueStr =
        code.valueType === 'PERCENT'
            ? `${value.toLocaleString('de-DE')} %`
            : `${value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

    if (code.durationType === 'ONCE') {
        return `${valueStr} einmalig`;
    }
    if (code.durationType === 'MONTHS') {
        const m = code.durationValue ?? 0;
        return m === 1 ? `${valueStr} im ersten Monat` : `${valueStr} für ${m} Monate`;
    }
    // BILLING_CYCLES (or undefined)
    const n = code.durationValue ?? 0;
    if (n === 1)
        return cycle === 'YEARLY' ? `${valueStr} im ersten Jahr` : `${valueStr} im ersten Monat`;
    return cycle === 'YEARLY'
        ? `${valueStr} in den ersten ${n} Jahren`
        : `${valueStr} in den ersten ${n} Monaten`;
}
