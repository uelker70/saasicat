import type { EffectiveLimitsSnapshot } from './entitlement-snapshot.types.js';

export type ContractLineItemKind = 'plan' | 'bundle' | 'discount';
export type SubscriptionContractStatus = 'active' | 'scheduled' | 'terminated' | 'superseded';

/**
 * The statuses a contract is looked up under when asking "what is this tenant
 * on right now" — `scheduled` included, because a contract that starts today
 * and has not been switched to `active` yet is still the one in force at its
 * own `effectiveFrom`.
 *
 * One list rather than one per adapter: the two adapters have to answer
 * `findActiveByTenantId` the same way, and a status added here must not reach
 * only whichever of them somebody remembered.
 */
/**
 * How many bundle versions one price lookup may name.
 *
 * One number rather than two: the server validates against it and the client
 * batches to stay inside it, and a client that learned the cap by receiving a
 * 400 would fail silently — the lookup answers with an empty map, and every
 * card falls back to a catalogue price the tenant may not be charged.
 */
export const BUNDLE_PRICE_LOOKUP_LIMIT = 200;

export const ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES: readonly SubscriptionContractStatus[] = [
    'active',
    'scheduled',
];

export interface ContractLineItemRecord {
    id: string;
    contractId: string;
    kind: ContractLineItemKind;
    sourceKey: string;
    sourceVersionId: string | null;
    titleSnapshot: string;
    descriptionSnapshot: string | null;
    quantity: number;
    unit: string | null;
    priceNet: number;
    priceGross: number;
    billingCycle: 'monthly' | 'yearly';
    /**
     * ISO 4217, as the line was booked in.
     *
     * An installation sells in one currency at a time, so this is never a
     * choice the line makes — it is what keeps the line meaning what it meant
     * after the configured currency is migrated to another one.
     */
    currency: string;
    /**
     * The tax rate in percent that was applied, recorded rather than left in
     * the ratio between net and gross. That ratio is not the rate: it cannot be
     * reproduced for a rounded gross, cannot express an exempt or reverse-charge
     * line, and does not survive a rate change.
     */
    taxRate: number;
    /**
     * The tax contained in the line — exactly `priceGross - priceNet`, so the
     * line cannot disagree with itself. Rounded once, when the line is written.
     */
    taxAmount: number;
    minimumTermUntil: Date | null;
    featuresSnapshot: string[];
    quotaEffectsSnapshot: Record<string, number>;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
}

export interface SubscriptionContractPriceSnapshot {
    currency: string;
    billingCycle: 'monthly' | 'yearly';
    subtotalNet: number;
    discountNet: number;
    totalNet: number;
    /**
     * The rate this contract's total was computed at — in per cent where the
     * contract was frozen from the catalogue, and as the offer stated it where
     * it was concluded from one.
     *
     * A checkout offer prices its lines as `net * (1 + vatRate)`, so it states
     * a fraction, and the value is copied here as it stands. The field
     * therefore carries both units across a history and cannot be compared
     * across contracts. `ContractLineItemRecord.taxRate` is always per cent and
     * is the one to read; this is kept as written because it is the record of
     * what the contract was concluded with.
     */
    vatRate: number;
    totalGross: number;
}

export interface SubscriptionContractRecord {
    id: string;
    tenantId: string;
    status: SubscriptionContractStatus;
    effectiveFrom: Date;
    effectiveUntil: Date | null;
    originalOfferId: string | null;
    originalPlanVersionId: string | null;
    originalBundleVersionIds: string[];
    entitlementSnapshot: EffectiveLimitsSnapshot | null;
    priceSnapshot: SubscriptionContractPriceSnapshot;
    promotionSnapshots: unknown[];
    promoCodeSnapshots: unknown[];
    termsSnapshot: Record<string, unknown> | null;
    lineItems: ContractLineItemRecord[];
    createdAt: Date;
    updatedAt: Date;
}

export type NewContractLineItemData = Omit<
    ContractLineItemRecord,
    'id' | 'contractId' | 'createdAt'
>;

export interface CreateSubscriptionContractData {
    tenantId: string;
    status?: SubscriptionContractStatus;
    effectiveFrom: Date;
    effectiveUntil?: Date | null;
    originalOfferId?: string | null;
    originalPlanVersionId?: string | null;
    originalBundleVersionIds?: string[];
    entitlementSnapshot?: EffectiveLimitsSnapshot | null;
    priceSnapshot: SubscriptionContractPriceSnapshot;
    promotionSnapshots?: unknown[];
    promoCodeSnapshots?: unknown[];
    termsSnapshot?: Record<string, unknown> | null;
    lineItems: NewContractLineItemData[];
}

export interface TerminateSubscriptionContractData {
    effectiveUntil: Date;
    /**
     * The terminal status, or `null` to end the contract by date alone.
     *
     * `findActiveByTenantId` already asks its question as a window —
     * `effectiveFrom <= asOf` and `effectiveUntil` null or after it — so a
     * contract given an end in the FUTURE is found until that moment and not
     * afterwards, with no scheduled job to flip anything.
     *
     * Writing a terminal status instead makes the contract disappear from that
     * lookup at once, which for a cancellation declared months ahead removes an
     * agreement the customer is still under. Null is how a caller says "it ends
     * then", and a status is how it says "it is over now".
     */
    status: Extract<SubscriptionContractStatus, 'terminated' | 'superseded'> | null;
}

export interface SubscriptionContractFilter {
    tenantId?: string;
    status?: SubscriptionContractStatus;
    asOf?: Date;
}

export interface InvoiceLineItemSnapshot {
    sourceContractLineItemId: string;
    sourceKey: string;
    sourceVersionId: string | null;
    kind: ContractLineItemKind;
    title: string;
    description: string | null;
    quantity: number;
    unit: string | null;
    priceNet: number;
    priceGross: number;
    billingCycle: 'monthly' | 'yearly';
    currency: string;
    taxRate: number;
    taxAmount: number;
    minimumTermUntil: Date | null;
    metadata: Record<string, unknown> | null;
}

export interface SubscriptionContractInvoiceSnapshot {
    contractId: string;
    tenantId: string;
    originalOfferId: string | null;
    currency: string;
    billingCycle: 'monthly' | 'yearly';
    effectiveFrom: Date;
    effectiveUntil: Date | null;
    subtotalNet: number;
    discountNet: number;
    totalNet: number;
    vatRate: number;
    totalGross: number;
    lineItems: InvoiceLineItemSnapshot[];
}
