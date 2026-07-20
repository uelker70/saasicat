// Entitlement-Plan-Resolution — Pure Functions zur Auflösung des effektiven
// Plans bei Trial / Pilot / Pending-Plan-Wechsel.
//
// Konsumenten konfigurieren ihre Strategie via `EntitlementResolutionConfig`:
//   - `pilotEntitlementPlan`: welcher Plan zählt während Pilot? (z. B. BUSINESS).
//   - `pendingSalesEntitlementPlan`: Fallback während ENTERPRISE-Sales-Wartezeit.
//   - `defaultTrialEntitlementPlan`: Fallback wenn `Subscription.trialEntitlementPlan`
//     null ist.
//
// Ist eine der Konfigurations-Strategien `undefined`, fällt die Auflösung auf
// `subscription.plan` zurück (kein Override).

import type { PlanId } from '@saasicat/types';

/** Eingabe-Form: nur die Felder, die für die Auflösung relevant sind. */
export interface EntitlementResolutionInput {
    plan: PlanId;
    status: string;
    isPilot?: boolean;
    trialEntitlementPlan?: PlanId | null;
    pendingPlan?: PlanId | null;
    pendingEffectiveAt?: Date | null;
}

/**
 * Konsumenten-spezifische Override-Strategie. Alle Felder optional —
 * undefined heißt: keine Sonderbehandlung, fällt auf `subscription.plan` zurück.
 */
export interface EntitlementResolutionConfig {
    /** Wenn `isPilot=true`, gilt dieser Plan statt `subscription.plan`. */
    pilotEntitlementPlan?: PlanId;
    /** Wenn `status="PENDING_SALES"`, gilt dieser Plan. */
    pendingSalesEntitlementPlan?: PlanId;
    /**
     * Fallback während TRIAL, wenn `subscription.trialEntitlementPlan` null ist.
     * Wenn die Subscription einen `trialEntitlementPlan` setzt, gewinnt der.
     */
    defaultTrialEntitlementPlan?: PlanId;
}

/**
 * Löst den effektiven Plan einer Subscription für die Limit-Aggregation auf.
 *
 * Reihenfolge der Override-Regeln (höchste zuerst):
 *   1. `isPilot` → `config.pilotEntitlementPlan` (falls gesetzt).
 *   2. `status === 'TRIAL'` → `subscription.trialEntitlementPlan`
 *      oder `config.defaultTrialEntitlementPlan` (falls gesetzt).
 *   3. `status === 'PENDING_SALES'` → `config.pendingSalesEntitlementPlan`
 *      (falls gesetzt).
 *   4. `pendingPlan` mit `pendingEffectiveAt <= now` → `pendingPlan`.
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
