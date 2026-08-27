// DI tokens + ports for the contract freeze (#18).
//
// On a package change the agreed service is frozen as a `SubscriptionContract`
// with `entitlementSnapshot` — the `EntitlementService` reads the active
// contract FIRST, so that later AdminUI catalog changes no longer touch the
// running plan. The freeze service (`SubscriptionContractFreezeService`)
// is generic; only `projectKey` (config) and the bundle/plan-version data
// access (`ContractFreezeSourcePort`) are consumer-specific.

import type { BillingCycle, NewContractLineItemData } from '@saasicat/core';

/**
 * Optional hook token: the platform `changePlan` path + the
 * `PendingPlanMaterializationService` call the freeze after the plan mutation
 * (analogous to `TrialProjectionPort`). Without a port nothing is frozen — the
 * entitlements then stay catalog-/version-pinned as before.
 */
export const CONTRACT_FREEZE_PORT_TOKEN = Symbol.for('saasicat/nest/ContractFreezePort');

/** Adapter token: consumer-specific bundle/version data access. */
export const CONTRACT_FREEZE_SOURCE_PORT_TOKEN = Symbol.for(
    'saasicat/nest/ContractFreezeSourcePort',
);

/** Config token: the consumer's `projectKey` for the contract. */
export const CONTRACT_FREEZE_PROJECT_KEY_TOKEN = Symbol.for(
    'saasicat/nest/ContractFreezeProjectKey',
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
        /**
         * When the subscription ends, or null while it runs on.
         *
         * A contract cannot outlive the subscription it froze, and a freeze
         * happens AFTER a cancellation as well: a plan change on a cancelled
         * subscription is allowed, and each one supersedes the capped contract
         * with a fresh one. Without this the replacement is uncapped and the
         * ending is lost — repaired once at the cancellation, undone by the
         * next change.
         */
        endsAt: Date | null,
    ): Promise<void>;

    /**
     * Ends the active contract at `effectiveAt`, with no successor.
     *
     * A frozen contract is the agreed service, and it cannot outlive the
     * subscription that agreed to it. Without this the tenant's entitlements
     * end on the date while the invoice side goes on reading an active
     * agreement — two answers to "is this customer under contract", and the
     * one that bills says yes.
     *
     * Same mechanic as the supersession above and deliberately not the same
     * call: there is nothing to succeed it with.
     */
    endOnCancellation(tenantId: string, effectiveAt: Date): Promise<void>;
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
     *
     * `cycle` is the **plan's** rhythm, not the bookings'. A tenant on a yearly
     * plan may hold monthly add-ons, so a source prices each booking in the
     * rhythm that booking was made in and says which one that is on the line's
     * own `billingCycle`. Pricing every line in the plan's rhythm puts a figure
     * on the contract that nobody is charged, and the contract is the evidence
     * of what was agreed.
     */
    loadBookedBundles(
        tenantId: string,
        cycle: 'monthly' | 'yearly',
        vatRate: number,
    ): Promise<ContractFreezeBundleSnapshot>;
}
