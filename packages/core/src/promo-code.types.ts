// PromoCode — wire format for the promo code functionality.
// Schema source: @saasicat/spec/schemas/promo-code.schema.json

import type { PlanId } from './plan-catalog.types.js';

export type PromoCodeValueType = 'PERCENT' | 'ABSOLUTE';
export type PromoCodeDurationType = 'ONCE' | 'MONTHS' | 'BILLING_CYCLES';
export type PromoCodeStatus = 'ACTIVE' | 'PAUSED' | 'EXHAUSTED' | 'EXPIRED';
export type PromoCodeRedemptionStatus = 'ACTIVE' | 'REVERSED' | 'EXPIRED';
export type BillingCycle = 'MONTHLY' | 'YEARLY';

export type PromoCodeValidationResult =
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

export interface CreatePromoCodeRequest {
    /** A–Z, 0–9, '-' and '_'; 4–32 characters; case-insensitive, stored in UPPER. */
    code: string;
    valueType: PromoCodeValueType;
    /** For PERCENT: 0.01–100. For ABSOLUTE: > 0 in catalog currency. */
    value: number;
    durationType: PromoCodeDurationType;
    /** Required for MONTHS / BILLING_CYCLES, null for ONCE. */
    durationValue?: number | null;
    validFrom?: string | null;
    validUntil?: string | null;
    maxRedemptions?: number | null;
    /** Empty = all plans. */
    appliesToPlans?: PlanId[];
    appliesToBilling?: BillingCycle | null;
    firstTimeCustomersOnly?: boolean;
    minimumPlanAmountGross?: number | null;
    /** Default false: discount must not reduce the invoice to 0. */
    allowZeroInvoice?: boolean;
    description?: string | null;
    campaignTag?: string | null;
    /** SKR account for accounting; project-specific. */
    revenueDeductionAccount?: string | null;
}

export interface UpdatePromoCodeRequest {
    status?: 'ACTIVE' | 'PAUSED';
    description?: string | null;
    validUntil?: string | null;
    maxRedemptions?: number | null;
    campaignTag?: string | null;
}

export interface PromoCode {
    id: string;
    code: string;
    valueType: PromoCodeValueType;
    value: number;
    durationType: PromoCodeDurationType;
    durationValue: number | null;
    validFrom: string | null;
    validUntil: string | null;
    maxRedemptions: number | null;
    redemptionsCount: number;
    appliesToPlans: PlanId[];
    appliesToBilling: BillingCycle | null;
    firstTimeCustomersOnly: boolean;
    minimumPlanAmountGross: number | null;
    allowZeroInvoice: boolean;
    status: PromoCodeStatus;
    description: string | null;
    campaignTag: string | null;
    revenueDeductionAccount: string | null;
    createdAt: string;
    deletedAt: string | null;
}

export interface PromoCodeRedemption {
    id: string;
    promoCodeId: string;
    subscriptionId: string;
    tenantId: string;
    appliedValueType: PromoCodeValueType;
    appliedValue: number;
    appliedDurationType: PromoCodeDurationType;
    appliedDurationValue: number | null;
    startsAt: string;
    endsAt: string | null;
    status: PromoCodeRedemptionStatus;
    redeemedAt: string;
    reversedAt: string | null;
}

export interface PromoCodeValidationLog {
    id: string;
    /** null for NOT_FOUND. */
    promoCodeId: string | null;
    codeAttempt: string;
    /** Hash, not plaintext. */
    ipHash: string | null;
    sessionId: string | null;
    result: PromoCodeValidationResult;
    createdAt: string;
}
