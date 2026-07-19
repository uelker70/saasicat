// AUTO-GENERATED — nicht manuell editieren.
//
// Quelle: @saasicat/spec/schemas/promo-code.schema.json
// Regenerieren: `pnpm --filter @saasicat/types gen:types`
// Drift-Gate: tests/codegen-drift.test.js bricht den PR, wenn Schema und
// generierter Output auseinanderlaufen.

/**
 * Sprach-neutrale Definition von Promo-Codes für die SaaS-Plattform inkl. Redemption-Lifecycle.
 */
export interface PromoCode {}

/**
 * PERCENT: value ist Prozentsatz (1–100). ABSOLUTE: value ist Netto-Betrag in der Catalog-Currency.
 */
export type ValueType = 'PERCENT' | 'ABSOLUTE';

/**
 * ONCE: einmaliger Rabatt. MONTHS: durationValue Monate ab Redemption. BILLING_CYCLES: durationValue Abrechnungszyklen.
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
 * PERCENT: value ist Prozentsatz (1–100). ABSOLUTE: value ist Netto-Betrag in der Catalog-Currency.
 */
/**
 * ONCE: einmaliger Rabatt. MONTHS: durationValue Monate ab Redemption. BILLING_CYCLES: durationValue Abrechnungszyklen.
 */

export interface CreatePromoCodeRequest {
    /**
     * Großbuchstaben, Ziffern, '-' und '_'. Case-insensitive geprüft, in UPPER gespeichert.
     */
    code: string;
    valueType: ValueType;
    /**
     * Bei PERCENT: 0.01–100. Bei ABSOLUTE: > 0 in Catalog-Currency.
     */
    value: number;
    durationType: DurationType;
    /**
     * Pflicht bei MONTHS / BILLING_CYCLES, null bei ONCE.
     */
    durationValue?: number | null;
    validFrom?: string | null;
    validUntil?: string | null;
    maxRedemptions?: number | null;
    /**
     * Leer = alle Pläne.
     */
    appliesToPlans?: string[];
    appliesToBilling?: BillingCycle | null;
    firstTimeCustomersOnly?: boolean;
    minimumPlanAmountGross?: number | null;
    /**
     * Default: Rabatt darf Rechnung nicht auf 0 senken.
     */
    allowZeroInvoice?: boolean;
    description?: string | null;
    campaignTag?: string | null;
    /**
     * SKR-Konto für die Rechnungslegung; projekt-spezifisch.
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
 * PERCENT: value ist Prozentsatz (1–100). ABSOLUTE: value ist Netto-Betrag in der Catalog-Currency.
 */
/**
 * ONCE: einmaliger Rabatt. MONTHS: durationValue Monate ab Redemption. BILLING_CYCLES: durationValue Abrechnungszyklen.
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
     * null bei NOT_FOUND
     */
    promoCodeId?: string | null;
    codeAttempt: string;
    /**
     * kein Klartext-IP
     */
    ipHash?: string | null;
    sessionId?: string | null;
    result: ValidationResult;
    createdAt: string;
}
