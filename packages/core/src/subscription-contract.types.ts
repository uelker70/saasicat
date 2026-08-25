import type { EffectiveLimitsSnapshot } from './entitlement-snapshot.types.js';

export type ContractLineItemKind = 'plan' | 'bundle' | 'discount';
export type SubscriptionContractStatus = 'active' | 'scheduled' | 'terminated' | 'superseded';

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
    vatRate: number;
    totalGross: number;
}

export interface SubscriptionContractRecord {
    id: string;
    projectKey: string;
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
    projectKey: string;
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
    projectKey?: string;
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
    minimumTermUntil: Date | null;
    metadata: Record<string, unknown> | null;
}

export interface SubscriptionContractInvoiceSnapshot {
    contractId: string;
    projectKey: string;
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
