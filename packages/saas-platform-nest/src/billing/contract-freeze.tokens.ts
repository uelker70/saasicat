// DI tokens + ports for the contract freeze (#18).
//
// On a package change the agreed service is frozen as a `SubscriptionContract`
// with `entitlementSnapshot` — the `EntitlementService` reads the active
// contract FIRST, so that later AdminUI catalog changes no longer touch the
// running plan. The freeze service (`SubscriptionContractFreezeService`)
// is generic; only `projectKey` (config) and the bundle/plan-version data
// access (`ContractFreezeSourcePort`) are consumer-specific.

import type { BillingCycle, NewContractLineItemData } from '@saasicat/types';

/**
 * Optional hook token: the platform `changePlan` path + the
 * `PendingPlanMaterializationService` call the freeze after the plan mutation
 * (analogous to `TrialProjectionPort`). Without a port nothing is frozen — the
 * entitlements then stay catalog-/version-pinned as before.
 */
export const CONTRACT_FREEZE_PORT_TOKEN = Symbol.for('saas-platform/ContractFreezePort');

/** Adapter token: consumer-specific bundle/version data access. */
export const CONTRACT_FREEZE_SOURCE_PORT_TOKEN = Symbol.for(
    'saas-platform/ContractFreezeSourcePort',
);

/** Config token: the consumer's `projectKey` for the contract. */
export const CONTRACT_FREEZE_PROJECT_KEY_TOKEN = Symbol.for(
    'saas-platform/ContractFreezeProjectKey',
);

export interface ContractFreezePort {
    /**
     * Freezes the agreed service at `effectiveFrom` as the new active
     * `SubscriptionContract` (supersedes the previous one). Non-fatal for the
     * caller — the plan change is already persisted.
     */
    freezeOnPlanChange(
        tenantId: string,
        newPlan: string,
        billingCycle: BillingCycle,
        effectiveFrom: Date,
    ): Promise<void>;
}

/** Frozen bundle line items + their version ids (trace). */
export interface ContractFreezeBundleSnapshot {
    lineItems: NewContractLineItemData[];
    bundleVersionIds: string[];
}

/**
 * Consumer-specific data access for the freeze: live PlanVersion id
 * (trace) + booked bundles as contract line items. The generic freeze
 * logic (plan line item from the catalog, snapshot, contract assembly) lives in
 * the platform `SubscriptionContractFreezeService`.
 */
export interface ContractFreezeSourcePort {
    /** Live (published, non-superseded) PlanVersion id of the target plan, or null. */
    findLivePlanVersionId(planId: string): Promise<string | null>;

    /**
     * The tenant's active (non-terminated) bundle bookings as line items.
     * `vatRate` is passed through so the gross price is computed consistently
     * with the catalog VAT. Apps without a bundle schema return empty lists.
     */
    loadBookedBundles(
        tenantId: string,
        cycle: 'monthly' | 'yearly',
        vatRate: number,
    ): Promise<ContractFreezeBundleSnapshot>;
}
