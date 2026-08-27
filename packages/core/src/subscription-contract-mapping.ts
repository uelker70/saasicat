// Canonical row -> record mapping for subscription contracts. Pure, and shared
// by every adapter.
//
// Both adapters read the same canonical tables, so "which column becomes which
// field, and what an absent one means" is one decision. It stood written twice
// until 2026-08-27 — once per adapter, agreeing by coincidence — and the two
// copies are exactly the kind that drift silently: a nullable JSON column read
// as `{}` on one side and `null` on the other is invisible until somebody
// compares two adapters in production.
//
// The inputs are structural on purpose. A Prisma row carries `Decimal` where a
// Drizzle row carries a numeric string, and both are `unknown` here — the
// numbers go through `Number()`, which is what each adapter did separately.

import type {
    ContractLineItemKind,
    ContractLineItemRecord,
    SubscriptionContractPriceSnapshot,
    SubscriptionContractRecord,
    SubscriptionContractStatus,
} from './subscription-contract.types.js';
import type { EffectiveLimitsSnapshot } from './entitlement-snapshot.types.js';

/** A `subscription_contracts` row as either adapter reads it back. */
export interface CanonicalContractRow {
    id: string;
    projectKey: string;
    tenantId: string;
    status: string;
    effectiveFrom: Date;
    effectiveUntil: Date | null;
    originalOfferId: string | null;
    originalPlanVersionId: string | null;
    originalBundleVersionIds: unknown;
    entitlementSnapshot: unknown;
    priceSnapshot: unknown;
    promotionSnapshots: unknown;
    promoCodeSnapshots: unknown;
    termsSnapshot: unknown;
    createdAt: Date;
    updatedAt: Date;
}

/** A `contract_line_items` row as either adapter reads it back. */
export interface CanonicalContractLineItemRow {
    id: string;
    contractId: string;
    kind: string;
    sourceKey: string;
    sourceVersionId: string | null;
    titleSnapshot: string;
    descriptionSnapshot: string | null;
    quantity: number;
    unit: string | null;
    priceNet: unknown;
    priceGross: unknown;
    billingCycle: string;
    minimumTermUntil: Date | null;
    featuresSnapshot: unknown;
    quotaEffectsSnapshot: unknown;
    metadata: unknown;
    createdAt: Date;
}

export function toSubscriptionContractRecord(
    row: CanonicalContractRow,
    lineItems: CanonicalContractLineItemRow[],
): SubscriptionContractRecord {
    return {
        id: row.id,
        projectKey: row.projectKey,
        tenantId: row.tenantId,
        status: row.status as SubscriptionContractStatus,
        effectiveFrom: row.effectiveFrom,
        effectiveUntil: row.effectiveUntil,
        originalOfferId: row.originalOfferId,
        originalPlanVersionId: row.originalPlanVersionId,
        originalBundleVersionIds: toStringArray(row.originalBundleVersionIds),
        entitlementSnapshot: isPlainObject(row.entitlementSnapshot)
            ? (row.entitlementSnapshot as EffectiveLimitsSnapshot)
            : null,
        priceSnapshot: row.priceSnapshot as SubscriptionContractPriceSnapshot,
        promotionSnapshots: toUnknownArray(row.promotionSnapshots),
        promoCodeSnapshots: toUnknownArray(row.promoCodeSnapshots),
        termsSnapshot: toRecordOrNull(row.termsSnapshot),
        lineItems: lineItems.map(toContractLineItemRecord),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export function toContractLineItemRecord(
    row: CanonicalContractLineItemRow,
): ContractLineItemRecord {
    return {
        id: row.id,
        contractId: row.contractId,
        kind: row.kind as ContractLineItemKind,
        sourceKey: row.sourceKey,
        sourceVersionId: row.sourceVersionId,
        titleSnapshot: row.titleSnapshot,
        descriptionSnapshot: row.descriptionSnapshot,
        quantity: row.quantity,
        unit: row.unit,
        priceNet: Number(row.priceNet),
        priceGross: Number(row.priceGross),
        billingCycle: row.billingCycle as 'monthly' | 'yearly',
        minimumTermUntil: row.minimumTermUntil,
        featuresSnapshot: toStringArray(row.featuresSnapshot),
        quotaEffectsSnapshot: toQuotaEffects(row.quotaEffectsSnapshot),
        metadata: toRecordOrNull(row.metadata),
        createdAt: row.createdAt,
    };
}

function isPlainObject(value: unknown): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toUnknownArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
    return isPlainObject(value) ? (value as Record<string, unknown>) : null;
}

function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
}

function toQuotaEffects(value: unknown): Record<string, number> {
    if (!isPlainObject(value)) return {};
    const effects: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (typeof entry === 'number') effects[key] = entry;
    }
    return effects;
}
