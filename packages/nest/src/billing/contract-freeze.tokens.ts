// DI tokens + ports for the contract freeze (#18).
//
// On a package change the agreed service is frozen as a `SubscriptionContract`
// with `entitlementSnapshot` — the `EntitlementService` reads the active
// contract FIRST, so that later AdminUI catalog changes no longer touch the
// running plan. The freeze service (`SubscriptionContractFreezeService`)
// is generic; only the bundle/plan-version data access
// (`ContractFreezeSourcePort`) is consumer-specific.

import type { BillingCycle, PlanVersionRow } from '@saasicat/core';

import type { PricedContractLineItem } from '../subscription-contract/contract-line-item-money.js';

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

export interface ContractFreezePort {
    /**
     * Refuses, with `SUBSCRIBER_REQUIRED`, a tenant that has no subscriber.
     *
     * A frozen contract names the party it is concluded with, and a freeze
     * runs after the change that asks for it — a plan change already written,
     * an add-on already booked. Asked first, the change is refused while
     * nothing has moved; asked only by the freeze, the tenant would be on the
     * new plan with the old contract still in force.
     */
    assertPartyFor(tenantId: string): Promise<void>;

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
    /**
     * Priced in net, and nothing more — the platform records the gross, the
     * currency and the tax rate, so a source never restates a setting it does
     * not own, and every line of the contract carries its share of one tax
     * computation rather than a rounding of its own.
     */
    lineItems: PricedContractLineItem[];
    bundleVersionIds: string[];
}

/**
 * Consumer-specific data access for the freeze: the plan version the tenant's
 * subscription is bound to + booked bundles as contract line items. The generic
 * freeze logic (plan line item, snapshot, contract assembly) lives in the
 * platform `SubscriptionContractFreezeService`.
 */
export interface ContractFreezeSourcePort {
    /**
     * The plan version the tenant's subscription is bound to — the row its
     * `planVersionId` points at, whether or not a newer one is on sale — or
     * `null` when the tenant has no subscription.
     *
     * The contract records this version's price, features and quotas. Not the
     * version on sale now: a tenant who books an add-on after the operator
     * published a successor keeps the version they bought (`SC-SUB-012`), and
     * after a plan change the write has already bound the version it sold.
     */
    findBoundPlanVersion(tenantId: string): Promise<PlanVersionRow | null>;

    /**
     * The tenant's active (non-terminated) bundle bookings as line items,
     * priced in net. Apps without a bundle schema return empty lists.
     *
     * A booking whose cancellation is declared is still active until its
     * effective date, and it belongs here while it is billed. Its line does not
     * put it into the contract's entitlements: the freeze leaves it out of the
     * snapshot, and the booking grants its features and quotas until that date.
     *
     * `cycle` is the **plan's** rhythm, not the bookings'. A tenant on a yearly
     * plan may hold monthly add-ons, so a source prices each booking in the
     * rhythm that booking was made in and says which one that is on the line's
     * own `billingCycle`. Pricing every line in the plan's rhythm puts a figure
     * on the contract that nobody is charged, and the contract is the evidence
     * of what was agreed.
     *
     * Each line names its booking's bundle version as `sourceVersionId`. The
     * charge journal finds a booking's contract line by it, and a line without
     * it leaves the booking uncharged.
     */
    loadBookedBundles(
        tenantId: string,
        cycle: 'monthly' | 'yearly',
    ): Promise<ContractFreezeBundleSnapshot>;
}
