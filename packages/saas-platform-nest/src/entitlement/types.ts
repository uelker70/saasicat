// Entitlement types — snapshot form for pure-function aggregation.
//
// Consumers map their Prisma models onto these snapshots; the platform
// aggregation works exclusively on this form (no Prisma imports).

import type { FeatureKey, PlanId, QuotaKey } from '@saasicat/types';

/**
 * Snapshot of the binding `PlanVersion` of a subscription. Quotas are
 * delivered as a record of `quotaKey → number`; concrete keys are declared
 * by the code via `@DefinesQuota`.
 *
 * `-1` is the catalog convention for "unlimited" — consumers must map that
 * to `Number.POSITIVE_INFINITY` themselves if they want to compute with it.
 */
export interface PlanVersionSnapshot {
    planId: PlanId;
    quotas: Record<QuotaKey, number>;
    features: FeatureKey[];
}

/**
 * Snapshot of an active SubscriptionBundle booking (P11.7.3 +
 * SPEC_V2 §11.1 M6 Pack 2e). Resolved by the EntitlementService from the
 * `subscription_bundles` junction + BundleRepository.findVersionById and
 * passed to `aggregateLimits`.
 *
 * Aggregation: quotas additive with -1 dominance, features ⋃ set union.
 * The filter (`canceledEffectiveAt > now`) lives in the aggregator
 * (`filterActiveSubscriptionBundles`), so the caller can simply pass in all
 * bookings.
 */
export interface SubscriptionBundleSnapshot {
    bundleKey: string;
    features: FeatureKey[];
    quotas: Record<QuotaKey, number>;
    /**
     * Date up to which the booking is effectively active (= NULL for
     * non-canceled bookings). The aggregator filters
     * `canceledEffectiveAt > now` as active.
     */
    canceledEffectiveAt: Date | null;
}

/**
 * Consumer override from `Subscription.customLimits` (e.g. an ENTERPRISE
 * special contract or pilot). Field-wise — unset quotas/features fall back
 * to the plan default.
 */
export interface CustomLimitsShape {
    quotas?: Record<QuotaKey, number>;
    features?: FeatureKey[];
}

/**
 * Input for `aggregateLimits` — the platform expects the consumer to have
 * already performed the plan resolution (trial/pilot/pending). `plan` and
 * `planVersion` are the result of that resolution; see
 * `resolveEntitlementPlan` for a configurable default strategy.
 *
 */
export interface SubscriptionLimitsInput {
    plan: PlanId;
    planVersion: PlanVersionSnapshot;
    /**
     * Active bundle bookings (P11.7.3). The aggregator filters by
     * `canceledEffectiveAt > now` and sums quotas + collects features into
     * the effective limits.
     */
    subscriptionBundles?: SubscriptionBundleSnapshot[];
    customLimits?: CustomLimitsShape | null;
}

/**
 * Effective limits of a tenant: plan ID + aggregated quotas + features.
 */
export interface EffectiveLimits {
    plan: PlanId;
    quotas: Record<QuotaKey, number>;
    features: Set<FeatureKey>;
}

/**
 * Serializable form for snapshot fields (e.g. `Invoice.entitlementSnapshot`).
 * `features` is a sorted array instead of a Set for stable JSON serialization.
 */
export interface EffectiveLimitsSnapshot {
    plan: PlanId;
    quotas: Record<QuotaKey, number>;
    features: FeatureKey[];
}
