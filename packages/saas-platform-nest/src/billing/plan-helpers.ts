// Plan helpers — pure functions over a loaded PlanCatalog.
//
// Consumers inject the catalog via PLAN_CATALOG_TOKEN and delegate to these
// functions. This replaces the static top-level functions
// (`getPlan`, `getPlanPriceNet`, `getPlanPriceGross`, `getMarketedPlans`),
// which still operate over a static TS const.

import type {
    BillingCycle,
    FeatureKey,
    PlanCatalog,
    PlanDef,
    PlanId,
    QuotaKey,
} from '@saasicat/types';
import { round2 } from '../promo/math.js';

/**
 * Finds a plan in the catalog. `undefined` if it does not exist.
 */
export function findPlan(catalog: PlanCatalog, planId: PlanId): PlanDef | undefined {
    return (catalog.plans ?? []).find((p) => p.id === planId);
}

/**
 * Like `findPlan`, but throws a typed error if the plan does not exist.
 * For code paths where its absence is a bug (plan-change validation,
 * subscription snapshot on creation).
 */
export function getPlanOrThrow(catalog: PlanCatalog, planId: PlanId): PlanDef {
    const plan = findPlan(catalog, planId);
    if (!plan) {
        throw new Error(`Plan "${planId}" nicht im Catalog (${catalog.projectKey}) gefunden`);
    }
    return plan;
}

/**
 * Returns all marketed plans (`marketed: true` or undefined). Order as in the
 * catalog. ENTERPRISE and other `marketed: false` plans are NOT included —
 * these can only be activated via `ahp paket apply` / special contract and do
 * not belong in self-service onboarding lists.
 */
export function getMarketedPlans(catalog: PlanCatalog): PlanDef[] {
    return (catalog.plans ?? []).filter((p) => p.marketed !== false);
}

/**
 * Net list price from the catalog. `null` when:
 *   - the plan does not exist
 *   - the plan is `marketed: false` (e.g. ENTERPRISE — special contract,
 *     no list price)
 *   - the plan has no price for the cycle (`monthlyNet`/`yearlyNet === null`)
 */
export function getPlanPriceNet(
    catalog: PlanCatalog,
    planId: PlanId,
    cycle: BillingCycle,
): number | null {
    const plan = findPlan(catalog, planId);
    if (!plan) return null;
    if (plan.marketed === false) return null;
    const net = cycle === 'YEARLY' ? plan.yearlyNet : plan.monthlyNet;
    return net ?? null;
}

/**
 * Gross list price from the catalog (net * (1 + vatRate/100)).
 * `null` with the same rules as `getPlanPriceNet`. `vatRate` is optional;
 * default: `catalog.vatRate`.
 */
export function getPlanPriceGross(
    catalog: PlanCatalog,
    planId: PlanId,
    cycle: BillingCycle,
    vatRate?: number,
): number | null {
    const net = getPlanPriceNet(catalog, planId, cycle);
    if (net === null) return null;
    const rate = vatRate ?? catalog.vatRate;
    return round2(net * (1 + rate / 100));
}

/**
 * Checks whether a plan directly contains a feature (without considering
 * Bundles / subscription). For marketing lists, plan comparison tables.
 *
 * Note: this is NOT the entitlement check for a concrete tenant.
 * The real entitlement check (`EntitlementService.computeLimits`) takes
 * Bundle bookings and custom limits into account — this helper function is
 * only the static plan definition.
 */
export function isFeatureInPlan(
    catalog: PlanCatalog,
    planId: PlanId,
    featureKey: FeatureKey,
): boolean {
    const plan = findPlan(catalog, planId);
    if (!plan) return false;
    return plan.features.includes(featureKey);
}

/**
 * Aggregated plan Quota for a key. Returns `undefined` when the plan or the
 * key does not exist.
 *
 * `-1` is the catalog convention for "unlimited"; consumers must map that to
 * `Number.POSITIVE_INFINITY` themselves if they compute with it.
 */
export function getPlanQuota(
    catalog: PlanCatalog,
    planId: PlanId,
    quotaKey: QuotaKey,
): number | undefined {
    const plan = findPlan(catalog, planId);
    return plan?.quotas[quotaKey];
}

/**
 * List of all feature keys declared in the catalog that are not
 * `plannedOnly: true`. For UI lists that show bookable features.
 */
export function getActiveFeatureKeys(catalog: PlanCatalog): FeatureKey[] {
    return (catalog.features ?? []).filter((f) => !f.plannedOnly).map((f) => f.key);
}

/**
 * Checks whether a feature is `plannedOnly: true`. If the feature is not
 * declared in the catalog, the function returns `false` (conservative:
 * unknown keys are not marked as "planned").
 */
export function isFeaturePlannedOnly(catalog: PlanCatalog, featureKey: FeatureKey): boolean {
    const def = (catalog.features ?? []).find((f) => f.key === featureKey);
    return def?.plannedOnly === true;
}
