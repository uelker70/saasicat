// AUTO-GENERATED — do not edit manually.
//
// Source: @saasicat/spec/schemas/promo-code.schema.json
// Regenerate: `pnpm --filter @saasicat/types gen:types`
// Drift gate: tests/codegen-drift.test.js fails the PR when the schema and
// the generated output diverge.

/**
 * Language-neutral definition of promo codes for the SaaS platform, including redemption lifecycle.
 */
export interface PromoCode {}

/**
 * PERCENT: value is a percentage (1–100). ABSOLUTE: value is a net amount in the catalog currency.
 */
export type ValueType = 'PERCENT' | 'ABSOLUTE';

/**
 * ONCE: one-time discount. MONTHS: durationValue months from redemption. BILLING_CYCLES: durationValue billing cycles.
 */
export type DurationType = 'ONCE' | 'MONTHS' | 'BILLING_CYCLES';

export type Status = 'ACTIVE' | 'PAUSED' | 'EXHAUSTED' | 'EXPIRED';

export type BillingCycle = 'MONTHLY' | 'YEARLY';

export type RedemptionStatus = 'ACTIVE' | 'REVERSED' | 'EXPIRED';

export type ValidationResult =
    | 'VALID'
    | 'EXPIRED'
    | 'EXHAUSTED'
    | 'NOT_FOUND'
    | 'PAUSED'
    | 'NOT_APPLICABLE'
    | 'FIRST_TIME_ONLY'
    | 'ZERO_INVOICE_BLOCKED'
    | 'MIN_AMOUNT_NOT_REACHED'
    | 'RATE_LIMITED';

/**
 * PERCENT: value is a percentage (1–100). ABSOLUTE: value is a net amount in the catalog currency.
 */
/**
 * ONCE: one-time discount. MONTHS: durationValue months from redemption. BILLING_CYCLES: durationValue billing cycles.
 */

export interface CreatePromoCodeRequest {
    /**
     * Uppercase letters, digits, '-' and '_'. Checked case-insensitively, stored in UPPER.
     */
    code: string;
    valueType: ValueType;
    /**
     * For PERCENT: 0.01–100. For ABSOLUTE: > 0 in catalog currency.
     */
    value: number;
    durationType: DurationType;
    /**
     * Required for MONTHS / BILLING_CYCLES, null for ONCE.
     */
    durationValue?: number | null;
    validFrom?: string | null;
    validUntil?: string | null;
    maxRedemptions?: number | null;
    /**
     * Empty = all plans.
     */
    appliesToPlans?: string[];
    appliesToBilling?: BillingCycle | null;
    firstTimeCustomersOnly?: boolean;
    minimumPlanAmountGross?: number | null;
    /**
     * Default: discount must not reduce the invoice to 0.
     */
    allowZeroInvoice?: boolean;
    description?: string | null;
    campaignTag?: string | null;
    /**
     * SKR account for accounting; project-specific.
     */
    revenueDeductionAccount?: string | null;
}

export interface UpdatePromoCodeRequest {
    status?: 'ACTIVE' | 'PAUSED';
    description?: string | null;
    validUntil?: string | null;
    maxRedemptions?: number | null;
    campaignTag?: string | null;
}

/**
 * PERCENT: value is a percentage (1–100). ABSOLUTE: value is a net amount in the catalog currency.
 */
/**
 * ONCE: one-time discount. MONTHS: durationValue months from redemption. BILLING_CYCLES: durationValue billing cycles.
 */

export interface PromoCodeRedemption {
    id: string;
    promoCodeId: string;
    subscriptionId: string;
    tenantId: string;
    appliedValueType: ValueType;
    appliedValue: number;
    appliedDurationType?: DurationType;
    appliedDurationValue?: number | null;
    startsAt?: string;
    endsAt?: string | null;
    status: RedemptionStatus;
    redeemedAt: string;
    reversedAt?: string | null;
}

export interface PromoCodeValidationLog {
    id: string;
    /**
     * null for NOT_FOUND
     */
    promoCodeId?: string | null;
    codeAttempt: string;
    /**
     * no plaintext IP
     */
    ipHash?: string | null;
    sessionId?: string | null;
    result: ValidationResult;
    createdAt: string;
}
