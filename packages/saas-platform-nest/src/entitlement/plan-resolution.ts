// Entitlement plan resolution — pure functions that resolve the effective
// plan under trial / pilot / pending-plan-change.
//
// Consumers configure their strategy via `EntitlementResolutionConfig`:
//   - `pilotEntitlementPlan`: which plan counts during pilot? (e.g. BUSINESS).
//   - `pendingSalesEntitlementPlan`: fallback while waiting for ENTERPRISE sales.
//   - `defaultTrialEntitlementPlan`: fallback when `Subscription.trialEntitlementPlan`
//     is null.
//
// If one of the configured strategies is `undefined`, resolution falls back to
// `subscription.plan` (no override).

import type { PlanId } from '@saasicat/types';

/** Input shape: only the fields relevant to resolution. */
export interface EntitlementResolutionInput {
    plan: PlanId;
    status: string;
    isPilot?: boolean;
    trialEntitlementPlan?: PlanId | null;
    pendingPlan?: PlanId | null;
    pendingEffectiveAt?: Date | null;
}

/**
 * Consumer-specific override strategy. All fields optional —
 * undefined means: no special handling, falls back to `subscription.plan`.
 */
export interface EntitlementResolutionConfig {
    /** If `isPilot=true`, this plan applies instead of `subscription.plan`. */
    pilotEntitlementPlan?: PlanId;
    /** If `status="PENDING_SALES"`, this plan applies. */
    pendingSalesEntitlementPlan?: PlanId;
    /**
     * Fallback during TRIAL, when `subscription.trialEntitlementPlan` is null.
     * If the subscription sets a `trialEntitlementPlan`, that one wins.
     */
    defaultTrialEntitlementPlan?: PlanId;
}

/**
 * Resolves the effective plan of a subscription for limit aggregation.
 *
 * Order of the override rules (highest first):
 *   1. `isPilot` → `config.pilotEntitlementPlan` (if set).
 *   2. `status === 'TRIAL'` → `subscription.trialEntitlementPlan`
 *      or `config.defaultTrialEntitlementPlan` (if set).
 *   3. `status === 'PENDING_SALES'` → `config.pendingSalesEntitlementPlan`
 *      (if set).
 *   4. `pendingPlan` with `pendingEffectiveAt <= now` → `pendingPlan`.
 *   5. Default → `subscription.plan`.
 */
export function resolveEntitlementPlan(
    input: EntitlementResolutionInput,
    config: EntitlementResolutionConfig,
    now: Date,
): PlanId {
    if (input.isPilot && config.pilotEntitlementPlan !== undefined) {
        return config.pilotEntitlementPlan;
    }
    if (input.status === 'TRIAL') {
        return input.trialEntitlementPlan ?? config.defaultTrialEntitlementPlan ?? input.plan;
    }
    if (input.status === 'PENDING_SALES' && config.pendingSalesEntitlementPlan !== undefined) {
        return config.pendingSalesEntitlementPlan;
    }
    if (input.pendingPlan && input.pendingEffectiveAt && input.pendingEffectiveAt <= now) {
        return input.pendingPlan;
    }
    return input.plan;
}
