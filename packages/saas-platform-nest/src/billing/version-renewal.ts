// Pure-function building blocks for PlanVersion renewal and period-roll logic.
//
// Consumers implement the cron-job loop (DB query, transaction,
// audit, cache invalidate) — the platform provides the **decision
// pure functions** defined here, which determine for each subscription
// what to do.

import type { BillingCycle } from '@saasicat/types';
import { periodEndAfter } from './billing-period.js';

/**
 * What the renewal cron should do with a subscription whose
 * `pendingPlanVersionEffectiveAt` has been reached.
 *
 *   - `ROLL_FORWARD`: pending becomes the new live version. Happens when
 *     either `nonRegressive=true` (platform guarantee: no regression)
 *     or `accepted=true` (the tenant has agreed to the change).
 *   - `CLEAR_PENDING`: pending is discarded. Happens when the
 *     pending version is regressive AND the tenant has **not** agreed
 *     by the effective date (variant B from roadmap §6.2: opt-in
 *     missed → no change).
 *   - `SKIP`: the sub has no pending version or the effective date is
 *     still in the future. (Should normally not be found by the cron
 *     filter at all — caught defensively here.)
 */
export type RenewalDecision = 'ROLL_FORWARD' | 'CLEAR_PENDING' | 'SKIP';

/** Input shape for `decideRenewal` (what the cron reads from the sub). */
export interface RenewalSubInput {
    pendingPlanVersionId: string | null;
    pendingPlanVersionEffectiveAt: Date | null;
    pendingPlanVersionAccepted: boolean;
    /** `nonRegressive` from the referenced PlanVersion. */
    pendingPlanVersionNonRegressive: boolean;
}

/**
 * Decides what should happen to a subscription with a due pending version.
 */
export function decideRenewal(sub: RenewalSubInput, now: Date): RenewalDecision {
    if (!sub.pendingPlanVersionId || !sub.pendingPlanVersionEffectiveAt) return 'SKIP';
    if (sub.pendingPlanVersionEffectiveAt > now) return 'SKIP';
    if (sub.pendingPlanVersionNonRegressive || sub.pendingPlanVersionAccepted) {
        return 'ROLL_FORWARD';
    }
    return 'CLEAR_PENDING';
}

/**
 * Returns the fields that must be reset in the subscription update after a
 * `ROLL_FORWARD` or `CLEAR_PENDING`. The consumer inserts them
 * into its Prisma `update.data` block.
 */
export function clearPendingPlanVersionFields(): {
    pendingPlanVersionId: null;
    pendingPlanVersionEffectiveAt: null;
    pendingPlanVersionAccepted: false;
    pendingPlanVersionAcceptedAt: null;
    pendingPlanVersionAcceptedByUserId: null;
    pendingPlanVersionNotifiedAt: null;
    pendingPlanVersionReminderSentAt: null;
} {
    return {
        pendingPlanVersionId: null,
        pendingPlanVersionEffectiveAt: null,
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
        pendingPlanVersionAcceptedByUserId: null,
        pendingPlanVersionNotifiedAt: null,
        pendingPlanVersionReminderSentAt: null,
    };
}

/** Input shape for `computeNextPeriod`. */
export interface PeriodRollInput {
    /** Subscription.currentPeriodEnd. NULL → no period active → SKIP. */
    currentPeriodEnd: Date | null;
    billingCycle: BillingCycle;
    canceledAt: Date | null;
}

/** Result: the next period window or `null` (skip). */
export interface NextPeriodWindow {
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
}

/**
 * Computes the next period window. `null` means: no action
 * (either the period hasn't been reached yet, canceled, or NULL period).
 *
 * Logic (spec: SUPERADMIN_PLANS_DASHBOARD_TODO §2.2):
 *   - If `canceledAt` is set → SKIP.
 *   - If `currentPeriodEnd === null` → SKIP (trial / PENDING_SALES).
 *   - If `currentPeriodEnd > now` → SKIP (period still active).
 *   - Otherwise → start := old `currentPeriodEnd`, end := periodEndAfter(start).
 */
export function computeNextPeriod(sub: PeriodRollInput, now: Date): NextPeriodWindow | null {
    if (sub.canceledAt !== null) return null;
    if (sub.currentPeriodEnd === null) return null;
    if (sub.currentPeriodEnd > now) return null;
    const newStart = sub.currentPeriodEnd;
    const newEnd = periodEndAfter(newStart, sub.billingCycle, now);
    return { currentPeriodStart: newStart, currentPeriodEnd: newEnd };
}
