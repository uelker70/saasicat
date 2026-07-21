import type { TransactionContext } from './core-ports.types.js';
import type {
    BillingCycle,
    PromoCodeDurationType,
    PromoCodeRedemptionStatus,
    PromoCodeStatus,
    PromoCodeValueType,
} from '../promo-code.types.js';

// -----------------------------------------------------------------------------
// Promo-code ports
// -----------------------------------------------------------------------------

/**
 * Snapshot of a `PromoCode` row for service-layer calls. Decimals as
 * strings (`value`, `minimumPlanAmountGross`) — the service parses them to
 * `number` for calculations, the consumer adapter maps from its
 * `Prisma.Decimal` (toString()).
 */
export interface PromoCodeRecord {
    id: string;
    code: string;
    valueType: PromoCodeValueType;
    /** Decimal-as-string (e.g. "25.00"). */
    value: string;
    durationType: PromoCodeDurationType;
    durationValue: number | null;
    validFrom: Date | null;
    validUntil: Date | null;
    maxRedemptions: number | null;
    redemptionsCount: number;
    appliesToPlans: string[];
    appliesToBilling: BillingCycle | null;
    firstTimeCustomersOnly: boolean;
    /** Decimal-as-string or null. */
    minimumPlanAmountGross: string | null;
    allowZeroInvoice: boolean;
    status: PromoCodeStatus;
    description: string | null;
    campaignTag: string | null;
    revenueDeductionAccount: string | null;
    createdById: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

/** Snapshot of a `PromoCodeRedemption` row. */
export interface PromoCodeRedemptionRecord {
    id: string;
    promoCodeId: string;
    subscriptionId: string;
    tenantId: string;
    appliedValueType: PromoCodeValueType;
    appliedValue: string;
    appliedDurationType: PromoCodeDurationType;
    appliedDurationValue: number | null;
    startsAt: Date;
    endsAt: Date | null;
    status: PromoCodeRedemptionStatus;
    redeemedAt: Date;
    reversedAt: Date | null;
}

/** Input for `PromoCodesService.create()`. */
export interface CreatePromoCodeData {
    code: string;
    valueType: PromoCodeValueType;
    /** Numeric — the service serializes to a decimal string. */
    value: number;
    durationType: PromoCodeDurationType;
    durationValue?: number | null;
    validFrom?: Date | null;
    validUntil?: Date | null;
    maxRedemptions?: number | null;
    appliesToPlans?: string[];
    appliesToBilling?: BillingCycle | null;
    firstTimeCustomersOnly?: boolean;
    minimumPlanAmountGross?: number | null;
    allowZeroInvoice?: boolean;
    description?: string | null;
    campaignTag?: string | null;
    revenueDeductionAccount?: string | null;
    createdById: string;
}

/** Input for `PromoCodesService.update()`. */
export interface UpdatePromoCodeData {
    status?: PromoCodeStatus;
    description?: string | null;
    validUntil?: Date | null;
    maxRedemptions?: number | null;
}

/** Filter for `PromoCodesService.findAll()`. */
export interface PromoCodeFilter {
    status?: PromoCodeStatus;
    campaignTag?: string;
    /** Substring search in the code (case-insensitive on UPPERCASE). */
    search?: string;
}

/** Entry for `PromoCodeRedemptionRepository.listByPromoCode()`. */
export interface PromoCodeRedemptionListItem extends PromoCodeRedemptionRecord {
    tenant?: { id: string; name: string; slug: string } | null;
}

/**
 * Adapter for PromoCode persistence. Atomic slot reservation lives in the
 * adapter because it is DB-specific (Postgres `UPDATE ... WHERE ... AND
 * (maxRedemptions IS NULL OR redemptionsCount < maxRedemptions)`).
 */
export interface PromoCodeRepository {
    findById(id: string): Promise<PromoCodeRecord | null>;
    findByCode(code: string, tx?: TransactionContext): Promise<PromoCodeRecord | null>;
    findMany(filter: PromoCodeFilter): Promise<PromoCodeRecord[]>;
    create(data: CreatePromoCodeData): Promise<PromoCodeRecord>;
    update(id: string, data: UpdatePromoCodeData): Promise<PromoCodeRecord>;
    softDelete(id: string): Promise<void>;
    /**
     * Atomic slot reservation: increments `redemptionsCount` and checks
     * `status === 'ACTIVE' && (maxRedemptions IS NULL || redemptionsCount < maxRedemptions)`.
     * Returns true if the slot was reserved, false if EXHAUSTED
     * or the status is not ACTIVE.
     */
    claimSlot(id: string, tx?: TransactionContext): Promise<boolean>;
    /** Sets the status to `EXHAUSTED` when `redemptionsCount >= maxRedemptions`. */
    markExhaustedIfFull(id: string, tx?: TransactionContext): Promise<void>;
    /** Decrements `redemptionsCount` by 1 (min 0); EXHAUSTED → ACTIVE. */
    releaseSlot(id: string, tx?: TransactionContext): Promise<void>;
    /**
     * Bulk-expire cron: sets all codes with `validUntil < now` and status
     * ACTIVE/PAUSED to EXPIRED. Returns: number of updated rows.
     */
    expireDueCodes(now: Date): Promise<number>;
}

/** Adapter for PromoCodeRedemption persistence. */
export interface PromoCodeRedemptionRepository {
    findBySubscription(
        subscriptionId: string,
        tx?: TransactionContext,
    ): Promise<PromoCodeRedemptionRecord | null>;
    create(
        data: Omit<PromoCodeRedemptionRecord, 'id' | 'redeemedAt' | 'status' | 'reversedAt'>,
        tx?: TransactionContext,
    ): Promise<PromoCodeRedemptionRecord>;
    setReversed(id: string, tx?: TransactionContext): Promise<PromoCodeRedemptionRecord>;
    countByPromoCode(promoCodeId: string, status?: PromoCodeRedemptionStatus): Promise<number>;
    listByPromoCode(promoCodeId: string): Promise<PromoCodeRedemptionListItem[]>;
    expireDueRedemptions(now: Date): Promise<number>;
}

/** Adapter for `PromoCodeValidationLog` writes. */
export interface PromoCodeValidationLogRepository {
    log(args: {
        promoCodeId: string | null;
        codeAttempt: string;
        result: string;
        ipHash?: string;
        sessionId?: string;
    }): Promise<void>;
    /** Number of `result = 'VALID'` logs for a promo code. */
    countValid(promoCodeId: string): Promise<number>;
}

/**
 * First-time-customer check for the `firstTimeCustomersOnly` eligibility.
 * The consumer implementation decides what "first time" means. Important:
 * unfinished onboarding drafts must not count as an existing customer.
 */
export interface FirstTimeCustomerCheck {
    /** Returns true if a completed/historical customer already exists for the email. */
    hasExistingCustomerForEmail(email: string): Promise<boolean>;
}

/** Subscription lookup for `redeem()`. Sufficient for promo calculations. */
export interface PromoSubscriptionLookup {
    findById(
        subscriptionId: string,
        tx?: TransactionContext,
    ): Promise<{
        id: string;
        tenantId: string;
        plan: string;
        billingCycle: BillingCycle;
        startedAt: Date | null;
    } | null>;
}

/**
 * Aggregation adapter for the stats endpoint (`PromoCodesService.stats`).
 * Consumers without an `InvoiceDiscount` table return '0.00'.
 */
export interface PromoRevenueDeductionAggregator {
    /** Sum of the amountGross values for all redemptions of a promo code (Decimal-as-string). */
    sumGrossForPromoCode(promoCodeId: string): Promise<string>;
}
