// PromoCode — Wire-Format für die Promo-Code-Funktionalität.
// Schema-Quelle: @saasicat/spec/schemas/promo-code.schema.json
// Vorlage: autohauspro/backend/src/promo-codes/dto/create-promo-code.dto.ts

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
    /** A–Z, 0–9, '-' und '_'; 4–32 Zeichen; Case-insensitive in UPPER gespeichert. */
    code: string;
    valueType: PromoCodeValueType;
    /** Bei PERCENT: 0.01–100. Bei ABSOLUTE: > 0 in Catalog-Currency. */
    value: number;
    durationType: PromoCodeDurationType;
    /** Pflicht bei MONTHS / BILLING_CYCLES, null bei ONCE. */
    durationValue?: number | null;
    validFrom?: string | null;
    validUntil?: string | null;
    maxRedemptions?: number | null;
    /** Leer = alle Pläne. */
    appliesToPlans?: PlanId[];
    appliesToBilling?: BillingCycle | null;
    firstTimeCustomersOnly?: boolean;
    minimumPlanAmountGross?: number | null;
    /** Default false: Rabatt darf Rechnung nicht auf 0 senken. */
    allowZeroInvoice?: boolean;
    description?: string | null;
    campaignTag?: string | null;
    /** SKR-Konto für die Rechnungslegung; projekt-spezifisch. */
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
    /** null bei NOT_FOUND. */
    promoCodeId: string | null;
    codeAttempt: string;
    /** Hash, kein Klartext. */
    ipHash: string | null;
    sessionId: string | null;
    result: PromoCodeValidationResult;
    createdAt: string;
}
