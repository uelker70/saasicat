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
 * Snapshot einer `PromoCode`-Row für Service-Layer-Aufrufe. Decimals als
 * String (`value`, `minimumPlanAmountGross`) — der Service parst sie zu
 * `number` für Berechnungen, der Konsumenten-Adapter mappt aus seinem
 * `Prisma.Decimal` (toString()).
 */
export interface PromoCodeRecord {
    id: string;
    code: string;
    valueType: PromoCodeValueType;
    /** Decimal-as-string (z. B. "25.00"). */
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
    /** Decimal-as-string oder null. */
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

/** Snapshot einer `PromoCodeRedemption`-Row. */
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

/** Eingabe für `PromoCodesService.create()`. */
export interface CreatePromoCodeData {
    code: string;
    valueType: PromoCodeValueType;
    /** Numeric — Service serialisiert zu Decimal-String. */
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

/** Eingabe für `PromoCodesService.update()`. */
export interface UpdatePromoCodeData {
    status?: PromoCodeStatus;
    description?: string | null;
    validUntil?: Date | null;
    maxRedemptions?: number | null;
}

/** Filter für `PromoCodesService.findAll()`. */
export interface PromoCodeFilter {
    status?: PromoCodeStatus;
    campaignTag?: string;
    /** Substring-Suche im Code (case-insensitive auf UPPERCASE). */
    search?: string;
}

/** Eintrag für `PromoCodeRedemptionRepository.listByPromoCode()`. */
export interface PromoCodeRedemptionListItem extends PromoCodeRedemptionRecord {
    tenant?: { id: string; name: string; slug: string } | null;
}

/**
 * Adapter für PromoCode-Persistenz. Atomares Slot-Reservieren ist im Adapter,
 * weil das DB-spezifisch ist (Postgres `UPDATE ... WHERE ... AND
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
     * Atomares Slot-Reservieren: inkrementiert `redemptionsCount` und prüft
     * `status === 'ACTIVE' && (maxRedemptions IS NULL || redemptionsCount < maxRedemptions)`.
     * Gibt true zurück, wenn der Slot reserviert wurde, false wenn EXHAUSTED
     * oder Status nicht ACTIVE.
     */
    claimSlot(id: string, tx?: TransactionContext): Promise<boolean>;
    /** Setzt Status auf `EXHAUSTED`, wenn `redemptionsCount >= maxRedemptions`. */
    markExhaustedIfFull(id: string, tx?: TransactionContext): Promise<void>;
    /** Vermindert `redemptionsCount` um 1 (min 0); EXHAUSTED → ACTIVE. */
    releaseSlot(id: string, tx?: TransactionContext): Promise<void>;
    /**
     * Bulk-Expire-Cron: setzt alle Codes mit `validUntil < now` und Status
     * ACTIVE/PAUSED auf EXPIRED. Rückgabe: Anzahl aktualisierter Zeilen.
     */
    expireDueCodes(now: Date): Promise<number>;
}

/** Adapter für PromoCodeRedemption-Persistenz. */
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

/** Adapter für `PromoCodeValidationLog`-Schreibzugriffe. */
export interface PromoCodeValidationLogRepository {
    log(args: {
        promoCodeId: string | null;
        codeAttempt: string;
        result: string;
        ipHash?: string;
        sessionId?: string;
    }): Promise<void>;
    /** Anzahl `result = 'VALID'`-Logs für einen Promo-Code. */
    countValid(promoCodeId: string): Promise<number>;
}

/**
 * First-Time-Customer-Check für die `firstTimeCustomersOnly`-Eligibility.
 * Konsument-Implementation entscheidet, was "first time" bedeutet. Wichtig:
 * unfertige Onboarding-Drafts dürfen nicht als bestehender Kunde zählen.
 */
export interface FirstTimeCustomerCheck {
    /** Gibt true zurück, wenn zur Email bereits ein abgeschlossener/historischer Kunde existiert. */
    hasExistingCustomerForEmail(email: string): Promise<boolean>;
}

/** Subscription-Lookup für `redeem()`. Reicht aus für Promo-Berechnungen. */
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
 * Aggregations-Adapter für die Stats-Endpoint (`PromoCodesService.stats`).
 * Konsumenten ohne `InvoiceDiscount`-Tabelle (vereinsfux) liefern '0.00'.
 */
export interface PromoRevenueDeductionAggregator {
    /** Summe der amountGross-Werte für alle Redemptions eines Promo-Codes (Decimal-as-string). */
    sumGrossForPromoCode(promoCodeId: string): Promise<string>;
}
