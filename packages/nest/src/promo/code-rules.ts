// What a promo code may promise, and what it takes off a plan price — pure
// functions, shared by creating a code, changing it, holding it for a checkout
// and redeeming it, so that none of them holds a rule the others skip.

import { BadRequestException } from '@nestjs/common';
import type { PromoCodeRecord, UpdatePromoCodeData } from '@saasicat/core';
import { PROMO_ERROR_CODES } from '@saasicat/core';

import { computeDiscountGross, computeDiscountedGross } from './calculator.js';

const PERCENT_MIN_EXCLUSIVE = 0;
const PERCENT_MAX = 100;
const DURATION_MIN = 1;
const DURATION_MAX = 24;

/** The terms of a code as they stand after a create or a change. */
export interface CodeTerms {
    valueType: PromoCodeRecord['valueType'];
    value: number;
    durationType: PromoCodeRecord['durationType'];
    durationValue: number | null;
    validFrom: Date | null;
    validUntil: Date | null;
    appliesToPlans: readonly string[];
    minimumPlanAmountGross: number | null;
    allowZeroInvoice: boolean;
}

/** A field of the terms a create sets or a change names. */
export type CodeTermField = keyof UpdatePromoCodeData;

/** Every rule, for a new code. */
export const ALL_TERMS: ReadonlySet<CodeTermField> = new Set<CodeTermField>([
    'valueType',
    'value',
    'durationType',
    'durationValue',
    'validFrom',
    'validUntil',
    'appliesToPlans',
    'minimumPlanAmountGross',
    'allowZeroInvoice',
]);

/** What the rules need to know beyond the code itself. */
export interface CodeRuleContext {
    nonRedeemablePlans: readonly string[];
    /** The lowest price the code can apply to — read only when the zero-invoice rule is asked. */
    lowestApplicablePlanGross(plans: readonly string[]): Promise<number | null>;
}

/**
 * Throws the refusal for the first rule the terms break, asking only the rules
 * a field in `changed` bears on. A change that only pauses a code is not held
 * to a rule about its value: pausing is how an operator stops a code, and it
 * has to work on any code, including one that no longer fits the rules.
 */
export async function assertCodeTerms(
    terms: CodeTerms,
    changed: ReadonlySet<CodeTermField>,
    context: CodeRuleContext,
): Promise<void> {
    const touches = (...fields: CodeTermField[]) => fields.some((field) => changed.has(field));
    if (touches('valueType', 'value')) assertValue(terms);
    if (touches('durationType', 'durationValue')) assertDuration(terms);
    if (touches('validFrom', 'validUntil')) assertValidityWindow(terms);
    if (touches('appliesToPlans')) assertPlansDiscountable(terms, context.nonRedeemablePlans);
    if (touches('minimumPlanAmountGross')) assertMinimumAmount(terms);
    if (touches('valueType', 'value', 'allowZeroInvoice', 'appliesToPlans')) {
        await assertNoZeroInvoice(terms, context);
    }
}

/**
 * What a code takes off a plan's gross price, never more than the price, and
 * whether that leaves an invoice of zero the code does not allow.
 */
export function discountOnPlan(
    code: Pick<PromoCodeRecord, 'valueType' | 'value' | 'allowZeroInvoice'>,
    planGross: number,
): { discountGross: number; discountedGross: number; zeroInvoice: boolean } {
    const discountGross = Math.min(computeDiscountGross({ gross: planGross }, code), planGross);
    const discountedGross = computeDiscountedGross(planGross, discountGross);
    return {
        discountGross,
        discountedGross,
        zeroInvoice: !code.allowZeroInvoice && discountedGross <= 0,
    };
}

/**
 * The value a redemption records: the code's own, unless it would take off more
 * than the price it is redeemed against — a percentage above 100 or an amount
 * above the price, which a code changed before its rules were held could carry.
 * Whoever applies the redemption per period then never computes a negative
 * price from it.
 */
export function appliedValue(
    code: Pick<PromoCodeRecord, 'valueType' | 'value'>,
    planGross: number,
): string {
    const cap = code.valueType === 'PERCENT' ? PERCENT_MAX : planGross;
    return Number(code.value) > cap ? cap.toFixed(2) : code.value;
}

function assertValue(terms: CodeTerms): void {
    if (terms.valueType === 'PERCENT') {
        if (!(terms.value > PERCENT_MIN_EXCLUSIVE && terms.value <= PERCENT_MAX)) {
            throw new BadRequestException({
                code: PROMO_ERROR_CODES.PROMO_PERCENT_OUT_OF_RANGE,
                message: 'The percentage must be between 0 and 100.',
                params: { value: terms.value, min: PERCENT_MIN_EXCLUSIVE, max: PERCENT_MAX },
            });
        }
    } else if (!(terms.value > 0)) {
        throw new BadRequestException({
            code: PROMO_ERROR_CODES.PROMO_AMOUNT_NOT_POSITIVE,
            message: 'The amount must be positive.',
            params: { value: terms.value, min: 0 },
        });
    }
}

function assertDuration(terms: CodeTerms): void {
    if (terms.durationType === 'ONCE') {
        if (terms.durationValue != null) {
            throw new BadRequestException({
                code: PROMO_ERROR_CODES.PROMO_ONE_OFF_WITH_DURATION,
                message: 'A one-off discount must not set a duration.',
                params: { durationValue: terms.durationValue },
            });
        }
        return;
    }
    const v = terms.durationValue;
    if (v == null || v < DURATION_MIN || v > DURATION_MAX) {
        throw new BadRequestException({
            code: PROMO_ERROR_CODES.PROMO_DURATION_INVALID,
            message: 'Invalid duration (at most 24 months or billing periods).',
            params: { durationValue: v ?? null, min: DURATION_MIN, max: DURATION_MAX },
        });
    }
}

function assertValidityWindow(terms: CodeTerms): void {
    if (terms.validFrom && terms.validUntil && terms.validFrom >= terms.validUntil) {
        throw new BadRequestException({
            code: PROMO_ERROR_CODES.PROMO_VALIDITY_WINDOW_INVALID,
            message: 'Invalid validity window.',
            params: {
                validFrom: terms.validFrom.toISOString(),
                validUntil: terms.validUntil.toISOString(),
            },
        });
    }
}

function assertPlansDiscountable(terms: CodeTerms, blocked: readonly string[]): void {
    for (const plan of terms.appliesToPlans) {
        if (blocked.includes(plan)) {
            throw new BadRequestException({
                code: PROMO_ERROR_CODES.PROMO_PLAN_NOT_DISCOUNTABLE,
                message: `${plan}-Plan cannot be discounted.`,
                params: { plan },
            });
        }
    }
}

function assertMinimumAmount(terms: CodeTerms): void {
    if (terms.minimumPlanAmountGross != null && terms.minimumPlanAmountGross <= 0) {
        throw new BadRequestException({
            code: PROMO_ERROR_CODES.PROMO_MIN_AMOUNT_NOT_POSITIVE,
            message: 'The minimum plan gross amount must be positive.',
            params: { value: terms.minimumPlanAmountGross, min: 0 },
        });
    }
}

async function assertNoZeroInvoice(terms: CodeTerms, context: CodeRuleContext): Promise<void> {
    if (terms.valueType !== 'ABSOLUTE' || terms.allowZeroInvoice) return;
    const lowest = await context.lowestApplicablePlanGross(terms.appliesToPlans);
    if (lowest != null && terms.value >= lowest) {
        throw new BadRequestException({
            code: PROMO_ERROR_CODES.PROMO_WOULD_PRODUCE_ZERO_INVOICE,
            message:
                'For absolute amounts the discount must stay below the lowest applicable plan price, or allowZeroInvoice must be enabled.',
            params: { value: terms.value, lowestApplicablePlanGross: lowest },
        });
    }
}
