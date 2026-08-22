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
    status: Extract<SubscriptionContractStatus, 'terminated' | 'superseded'>;
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
