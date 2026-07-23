// Entitlement aggregation — pure functions over PlanVersion + Bundles + Catalog.
//
// Consumers pull their subscription/PlanVersion/Bundle data from the DB,
// map it to the snapshot shape (see `types.ts`) and call
// `aggregateLimits()` for the effective limits.

import type { ContractLineItemRecord, FeatureKey, PlanCatalog, QuotaKey } from '@saasicat/types';
import { isFeaturePlannedOnly } from '../billing/plan-helpers.js';
import type {
    BusinessTypeVersionSnapshot,
    CustomLimitsShape,
    EffectiveLimits,
    EffectiveLimitsSnapshot,
    SubscriptionBundleSnapshot,
    SubscriptionLimitsInput,
} from './types.js';

/**
 * Aggregates the quotas of a BusinessTypeVersion: Σ(bundle quotas) per
 * QuotaKey, then override via `quotaOverrides[k]` if set.
 *
 * `-1` (unlimited) is handled as follows:
 * - In Σ summation: -1 dominates (if a bundle has -1 for a key,
 *   the Σ is likewise -1 for that key — regardless of the other values).
 * - In overrides: if the override is -1, it replaces the sum entirely.
 *
 * Spec: GESCHAEFTSTYP_SPEC §6.2.
 */
export function aggregateBusinessTypeQuotas(
    snapshot: BusinessTypeVersionSnapshot,
): Record<QuotaKey, number> {
    const sums: Record<QuotaKey, number> = {};
    for (const bundle of snapshot.bundles) {
        for (const [key, value] of Object.entries(bundle.quotas)) {
            if (sums[key] === -1 || value === -1) {
                sums[key] = -1;
            } else {
                sums[key] = (sums[key] ?? 0) + value;
            }
        }
    }
    // Apply overrides — key set = replaces Σ.
    for (const [key, value] of Object.entries(snapshot.quotaOverrides)) {
        if (value !== undefined) {
            sums[key] = value;
        }
    }
    return sums;
}

/**
 * Filters SubscriptionBundle bookings down to those active at the given
 * point in time. Active = `canceledEffectiveAt === null` or
 * `canceledEffectiveAt > now`.
 *
 * Spec: SPEC_V2 §11.1 M6 Pack 2e + P11.7.3.
 */
export function filterActiveSubscriptionBundles(
    bundles: readonly SubscriptionBundleSnapshot[],
    now: Date,
): SubscriptionBundleSnapshot[] {
    return bundles.filter((b) => b.canceledEffectiveAt === null || b.canceledEffectiveAt > now);
}

/**
 * Aggregates the quotas of all active SubscriptionBundle bookings:
 * Σ per QuotaKey, `-1` (unlimited) dominates. Bundle features +
 * bundle quotas are **additive** to the PlanVersion (not replacing).
 */
export function aggregateSubscriptionBundleQuotas(
    bundles: readonly SubscriptionBundleSnapshot[],
): Record<QuotaKey, number> {
    const sums: Record<QuotaKey, number> = {};
    for (const bundle of bundles) {
        for (const [key, value] of Object.entries(bundle.quotas)) {
            if (sums[key] === -1 || value === -1) {
                sums[key] = -1;
            } else {
                sums[key] = (sums[key] ?? 0) + value;
            }
        }
    }
    return sums;
}

/**
 * Collects all feature keys from active SubscriptionBundle bookings
 * (set union; duplicate features are included once).
 */
export function collectSubscriptionBundleFeatures(
    bundles: readonly SubscriptionBundleSnapshot[],
): FeatureKey[] {
    const set = new Set<FeatureKey>();
    for (const bundle of bundles) {
        for (const f of bundle.features) set.add(f);
    }
    return Array.from(set);
}

/**
 * V3 aggregation directly from frozen ContractLineItems. This function
 * uses no catalog lookups: `featuresSnapshot` and
 * `quotaEffectsSnapshot` are the contractual truth.
 */
export function aggregateContractLineItemEntitlements(
    lineItems: readonly Pick<
        ContractLineItemRecord,
        'kind' | 'sourceKey' | 'featuresSnapshot' | 'quotaEffectsSnapshot'
    >[],
    fallbackPlan = 'UNKNOWN',
): EffectiveLimits {
    const planItem = lineItems.find((item) => item.kind === 'plan');
    const plan = planItem?.sourceKey ?? fallbackPlan;
    const quotas: Record<QuotaKey, number> = {};
    const features = new Set<FeatureKey>();

    for (const item of lineItems) {
        for (const feature of item.featuresSnapshot) {
            features.add(feature);
        }
        for (const [key, value] of Object.entries(item.quotaEffectsSnapshot)) {
            if (quotas[key] === -1 || value === -1) {
                quotas[key] = -1;
            } else {
                quotas[key] = (quotas[key] ?? 0) + value;
            }
        }
    }

    return { plan, quotas, features };
}

/**
 * Collects all feature keys from all bundles of a BusinessTypeVersion
 * (set union; duplicate features are included once).
 *
 * Spec: GESCHAEFTSTYP_SPEC §6.3.
 */
export function collectBusinessTypeFeatures(snapshot: BusinessTypeVersionSnapshot): FeatureKey[] {
    const set = new Set<FeatureKey>();
    for (const bundle of snapshot.bundles) {
        for (const f of bundle.features) {
            set.add(f);
        }
    }
    return Array.from(set);
}

/**
 * Consistently filters out `plannedOnly` features — regardless of whether they
 * come from the plan, a bundle or customLimits. `plannedOnly` means: the feature
 * is declared in the catalog, but not yet rolled out to production.
 */
export function filterPlannedOnlyFeatures(
    features: ReadonlySet<FeatureKey>,
    catalog: PlanCatalog,
): Set<FeatureKey> {
    const out = new Set<FeatureKey>();
    for (const f of features) {
        if (!isFeaturePlannedOnly(catalog, f)) {
            out.add(f);
        }
    }
    return out;
}

/**
 * Applies `customLimits` (ENTERPRISE special contract, pilot) field-by-field to
 * the plan default limits. `quotas[k]` overrides; `features[]` adds.
 * Fields not set in the override fall back to the default.
 */
export function applyCustomLimits(
    base: EffectiveLimits,
    custom: CustomLimitsShape | null | undefined,
): EffectiveLimits {
    if (!custom) return base;
    const quotas = { ...base.quotas };
    if (custom.quotas) {
        for (const [k, v] of Object.entries(custom.quotas)) {
            quotas[k] = v;
        }
    }
    const features = new Set(base.features);
    if (custom.features) {
        for (const f of custom.features) features.add(f);
    }
    return { plan: base.plan, quotas, features };
}

/**
 * Main aggregator — yields the effective limits from PlanVersion + optional
 * BusinessTypeVersion + active bundle bookings + catalog + optional
 * CustomLimits override.
 *
 * Order (SPEC_V2 §11.1 M5 + GESCHAEFTSTYP_SPEC §6):
 *   1. Filter active bundle bookings (canceledEffectiveAt).
 *   2. Sum plan quotas + (BusinessType quotas with override logic) + bundle quotas
 *      per `quotaKey`. -1 (unlimited) dominates.
 *   3. Collect plan features ∪ BusinessType features ∪ bundle features
 *      (set union, deduplicated).
 *   4. Apply CustomLimits (quotas override, features add).
 *   5. Consistently hide plannedOnly features.
 */
export function aggregateLimits(
    input: SubscriptionLimitsInput,
    catalog: PlanCatalog,
    now: Date,
): EffectiveLimits {
    const businessTypeQuotas = input.businessTypeVersion
        ? aggregateBusinessTypeQuotas(input.businessTypeVersion)
        : {};
    const businessTypeFeatures = input.businessTypeVersion
        ? collectBusinessTypeFeatures(input.businessTypeVersion)
        : [];

    const activeBundles = filterActiveSubscriptionBundles(input.subscriptionBundles ?? [], now);
    const subBundleQuotas = aggregateSubscriptionBundleQuotas(activeBundles);
    const subBundleFeatures = collectSubscriptionBundleFeatures(activeBundles);

    const quotas: Record<QuotaKey, number> = {};
    // Plan defaults as base.
    for (const [k, v] of Object.entries(input.planVersion.quotas)) {
        quotas[k] = v;
    }
    // Add the BusinessType share (with -1 dominance).
    for (const [k, v] of Object.entries(businessTypeQuotas)) {
        if (quotas[k] === -1 || v === -1) {
            quotas[k] = -1;
        } else {
            quotas[k] = (quotas[k] ?? 0) + v;
        }
    }
    // Add SubscriptionBundle quotas (with -1 dominance). Independently
    // booked bundles add their quotas on top of plan + BusinessType.
    for (const [k, v] of Object.entries(subBundleQuotas)) {
        if (quotas[k] === -1 || v === -1) {
            quotas[k] = -1;
        } else {
            quotas[k] = (quotas[k] ?? 0) + v;
        }
    }

    const features = new Set<FeatureKey>([
        ...input.planVersion.features,
        ...businessTypeFeatures,
        ...subBundleFeatures,
    ]);

    const withCustom = applyCustomLimits(
        { plan: input.plan, quotas, features },
        input.customLimits,
    );
    const filteredFeatures = filterPlannedOnlyFeatures(withCustom.features, catalog);

    return { plan: withCustom.plan, quotas: withCustom.quotas, features: filteredFeatures };
}

/**
 * Checks whether a feature is contained in the effective limits.
 */
export function hasFeature(limits: EffectiveLimits, feature: FeatureKey): boolean {
    return limits.features.has(feature);
}

/**
 * Checks whether at least one of the given features is contained in the
 * effective limits. An empty list yields `false`.
 */
export function hasAnyFeature(limits: EffectiveLimits, features: readonly FeatureKey[]): boolean {
    return features.some((f) => limits.features.has(f));
}

/**
 * Converts EffectiveLimits into a JSON-serializable shape (Set → sorted
 * array). Used e.g. in `Invoice.entitlementSnapshot`.
 */
export function toEffectiveLimitsSnapshot(limits: EffectiveLimits): EffectiveLimitsSnapshot {
    return {
        plan: limits.plan,
        quotas: { ...limits.quotas },
        features: Array.from(limits.features).sort(),
    };
}
