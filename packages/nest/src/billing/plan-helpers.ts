// Plan helpers — pure functions over a loaded PlanCatalog.
//
// Consumers read the catalogue from `PLAN_CATALOG_SOURCE_TOKEN` —
// `await source.current()`, once per operation — and hand it to these
// functions.

import {
    BILLING_ERROR_CODES,
    type BillingCycle,
    type FeatureKey,
    type PlanCatalog,
    type PlanDef,
    type PlanId,
    type QuotaKey,
} from '@saasicat/core';
import { grossFromNet } from '../promo/math.js';
import { assertTaxRatePercent } from '../subscription-contract/contract-refusals.js';

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
        throw new Error(`Plan "${planId}" is not in the catalog`);
    }
    return plan;
}

/**
 * Returns all marketed plans (`marketed: true` or undefined). Order as in the
 * catalog. ENTERPRISE and other `marketed: false` plans are NOT included —
 * these are activated by a catalogue apply or a special contract, and do
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
    return plan ? listPriceNet(plan, cycle) : null;
}

/** The same rule for a plan already in hand, whichever version it describes. */
export function listPriceNet(plan: PlanDef, cycle: BillingCycle): number | null {
    if (plan.marketed === false) return null;
    const net = cycle === 'YEARLY' ? plan.yearlyNet : plan.monthlyNet;
    return net ?? null;
}

/**
 * Whether a plan on the list carries no price for a cycle, and so is not sold
 * in it: a plan without a yearly price is a monthly plan, one without either is
 * sold on request. A plan that is not marketed is sold under a special
 * contract, whose price the catalogue does not hold, so this is never true of
 * it.
 */
export function isPlanNotSoldInCycle(plan: PlanDef, cycle: BillingCycle): boolean {
    if (plan.marketed === false) return false;
    return (cycle === 'YEARLY' ? plan.yearlyNet : plan.monthlyNet) == null;
}

/**
 * The refusal for a plan that is not sold in a cycle — the same body for the
 * plan change's blocker and for the contract, which would otherwise record the
 * plan at 0.00.
 */
export function planNotSoldInCycle(
    plan: PlanDef,
    cycle: BillingCycle,
): { code: string; message: string; params: Record<string, string> } {
    const planName = plan.name ?? plan.id;
    return {
        code: BILLING_ERROR_CODES.PLAN_NOT_SOLD_IN_CYCLE,
        message: `${planName} has no price for this billing rhythm and cannot be booked in it.`,
        params: { planName, planKey: plan.id, billingCycle: cycle },
    };
}

/**
 * Gross list price from the catalog, through `grossFromNet`.
 * `null` with the same rules as `getPlanPriceNet`. `vatRate` is optional;
 * default: `catalog.vatRate`. A rate that is not a percentage is refused, as it
 * is wherever a rate is stated.
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
    assertTaxRatePercent(vatRate === undefined ? 'catalog.vatRate' : 'vatRate', rate);
    return grossFromNet(net, rate);
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
