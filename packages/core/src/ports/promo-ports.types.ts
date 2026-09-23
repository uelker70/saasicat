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
    /**
     * Slots held for checkouts that started and have not concluded
     * (`PromoCodeHoldRepository`). An adapter without holds reports 0.
     */
    heldCount: number;
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
    valueType?: PromoCodeValueType;
    value?: number;
    durationType?: PromoCodeDurationType;
    durationValue?: number | null;
    validFrom?: Date | null;
    description?: string | null;
    validUntil?: Date | null;
    maxRedemptions?: number | null;
    appliesToPlans?: string[];
    appliesToBilling?: BillingCycle | null;
    firstTimeCustomersOnly?: boolean;
    minimumPlanAmountGross?: number | null;
    allowZeroInvoice?: boolean;
    campaignTag?: string | null;
    revenueDeductionAccount?: string | null;
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
 * (maxRedemptions IS NULL OR redemptionsCount + heldCount < maxRedemptions)`).
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
     * `status === 'ACTIVE' && (maxRedemptions IS NULL || redemptionsCount + heldCount < maxRedemptions)`.
     * Returns true if the slot was reserved, false if EXHAUSTED
     * or the status is not ACTIVE. A slot held for a checkout is not free, so
     * an adapter that keeps holds counts `heldCount` here.
     */
    claimSlot(id: string, tx?: TransactionContext): Promise<boolean>;
    /**
     * Sets the status to `EXHAUSTED` when `redemptionsCount >= maxRedemptions`.
     * Holds do not count: a code full only because of held slots stays ACTIVE,
     * and gets its slots back when the holds end.
     */
    markExhaustedIfFull(id: string, tx?: TransactionContext): Promise<void>;
    /** Decrements `redemptionsCount` by 1 (min 0); EXHAUSTED → ACTIVE. */
    releaseSlot(id: string, tx?: TransactionContext): Promise<void>;
    /**
     * Bulk-expire cron: sets all codes with `validUntil < now` and status
     * ACTIVE/PAUSED to EXPIRED. Returns: number of updated rows.
     */
    expireDueCodes(now: Date): Promise<number>;
}

/**
 * A slot of a code kept for a checkout offer, from the start of its checkout
 * until the checkout concludes, the offer's code changes, or `expiresAt`
 * passes, whichever comes first. For a sign-up, `expiresAt` is the last moment
 * a confirmation of its payment form can arrive
 * (`PaymentMethodSetupSession.confirmableUntil`), not the checkout's lifetime.
 */
export interface PromoCodeHoldRecord {
    id: string;
    promoCodeId: string;
    checkoutOfferId: string;
    expiresAt: Date;
    createdAt: Date;
}

/** What `PromoCodeHoldRepository.take` did. */
export type PromoCodeHoldTaken =
    | { outcome: 'taken'; hold: PromoCodeHoldRecord }
    /** The code is not ACTIVE, is deleted, or has no free slot. */
    | { outcome: 'no-slot' }
    /** The offer holds a slot already, perhaps taken by a concurrent call. */
    | { outcome: 'offer-holds-one' };

/**
 * Adapter for the slots a code keeps for checkouts. Every method that ends a
 * hold deletes its row and gives its slot back in one statement, so a hold is
 * counted in `PromoCodeRecord.heldCount` exactly as long as its row exists.
 *
 * Optional in the promo module: an adapter that has no holds leaves
 * `heldCount` at 0, and taking a hold then refuses to start rather than
 * quietly holding nothing.
 */
export interface PromoCodeHoldRepository {
    /** The offer's hold, live or past its expiry and not yet given back. */
    findByCheckoutOffer(
        checkoutOfferId: string,
        tx?: TransactionContext,
    ): Promise<PromoCodeHoldRecord | null>;
    /**
     * Takes a slot of an ACTIVE, undeleted code for the offer, atomically with
     * `claimSlot`'s rule: `maxRedemptions IS NULL OR redemptionsCount +
     * heldCount < maxRedemptions`. An offer holds one slot at most. Runs on a
     * transaction of its own: a checkout starts outside any other, and the
     * slot is committed before the gateway's form opens.
     */
    take(hold: {
        promoCodeId: string;
        checkoutOfferId: string;
        expiresAt: Date;
    }): Promise<PromoCodeHoldTaken>;
    /**
     * Moves the expiry of the offer's hold on that code. False when the offer
     * holds no slot of it any more — it ended in the meantime.
     */
    extend(checkoutOfferId: string, promoCodeId: string, expiresAt: Date): Promise<boolean>;
    /** Ends the offer's hold and gives its slot back. False when it had none. */
    release(checkoutOfferId: string, tx?: TransactionContext): Promise<boolean>;
    /**
     * Marks the offer's hold, if it is live at `now`, as the slot of the
     * redemption that runs on `tx`. The mark never outlives the transaction: the
     * redemption turns the hold into its slot (`convertHandedOver`), or the
     * caller releases it before committing. False when the offer has no live
     * hold.
     */
    handOver(checkoutOfferId: string, now: Date, tx: TransactionContext): Promise<boolean>;
    /**
     * Turns the hold of that code handed over on `tx` into a redemption's slot:
     * the row goes, `heldCount` drops by one and `redemptionsCount` rises by one,
     * whatever the code's status. False when nothing was handed over on `tx`.
     */
    convertHandedOver(promoCodeId: string, tx: TransactionContext): Promise<boolean>;
    /**
     * Ends every hold past its expiry at `now` — of one code when `promoCodeId`
     * is given — and gives the slots back. A hold handed over on `tx` is left
     * to the conclusion running there; one handed over on another running
     * transaction is waited for, and is gone once that transaction ends.
     * Returns how many ended.
     */
    expireDue(now: Date, promoCodeId?: string, tx?: TransactionContext): Promise<number>;
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
