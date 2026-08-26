// Pure-function building blocks for PlanVersion renewal and period-roll logic.
//
// Consumers implement the cron-job loop (DB query, transaction,
// audit, cache invalidate) — the platform provides the **decision
// pure functions** defined here, which determine for each subscription
// what to do.

import type { BillingCycle } from '@saasicat/core';
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
    /**
     * The cancellation, read the same way `computeNextPeriod` reads it below.
     *
     * A version published before the customer cancelled still comes due
     * afterwards, and rolling it forward rewrites the plan of a subscription
     * whose term is over. Required, and required together, because a record
     * that omits them answers "not cancelled" and goes ahead.
     */
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
}

/**
 * Decides what should happen to a subscription with a due pending version.
 */
export function decideRenewal(sub: RenewalSubInput, now: Date): RenewalDecision {
    if (!sub.pendingPlanVersionId || !sub.pendingPlanVersionEffectiveAt) return 'SKIP';
    if (sub.pendingPlanVersionEffectiveAt > now) return 'SKIP';
    // Nothing rolls onto a subscription whose term is over. The same rule the
    // scheduled plan change follows, one level up: a version is due because a
    // date arrived, not because anybody still wants it.
    const landedAt = sub.canceledEffectiveAt ?? sub.canceledAt;
    if (landedAt !== null && landedAt <= now) return 'SKIP';
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
    /**
     * The day of the month this subscription is billed on, or null on a row
     * that predates the column. Null falls back to the day of the period end,
     * which is the reading that drifts — so a consumer that stores the anchor
     * gets the correct date and one that does not keeps today's behaviour.
     */
    billingAnchorDay?: number | null;
    /** Subscription.currentPeriodEnd. NULL → no period active → SKIP. */
    currentPeriodEnd: Date | null;
    billingCycle: BillingCycle;
    /**
     * When a cancellation was declared — and, on a row written before the two
     * fields parted company, also when it lands.
     *
     * It used to stop the renewal on its own, which was right while it carried
     * both meanings. Since they separated it is normally only "the customer
     * said so": a subscription cancelled in month three of a year still runs,
     * and stopping its renewal would end it nine months early.
     *
     * The exception is the row that predates the split. There `canceledAt`
     * holds the period end the old code computed and `canceledEffectiveAt` is
     * null, so reading only the second would roll a cancelled subscription into
     * another paid term, and the next one, forever.
     */
    canceledAt: Date | null;
    /**
     * When that cancellation lands. This is what stops the renewal.
     *
     * Null while none was declared. A period may still roll onto it: with a
     * notice period configured, a late cancellation lands at the end of the
     * FOLLOWING period, and that period has to exist to end.
     */
    canceledEffectiveAt: Date | null;
}

/** Result: the next period window or `null` (skip). */
export interface NextPeriodWindow {
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    /**
     * The renewed commitment, which is the period itself.
     *
     * The minimum term IS the chosen billing period (rule a), it starts at
     * activation (rule c) and it renews with the period unless a cancellation
     * was declared first (rule d). Written on every roll so nothing has to
     * reconstruct it later from a start date and a cycle.
     */
    minimumTermUntil: Date;
}

/**
 * Computes the next period window. `null` means: no action
 * (either the period hasn't been reached yet, canceled, or NULL period).
 *
 * Logic (spec: SUPERADMIN_PLANS_DASHBOARD_TODO §2.2):
 *   - If a cancellation has LANDED → SKIP. A declared one has not, unless the
 *     row predates the split and carries its effective date in `canceledAt`.
 *   - If `currentPeriodEnd === null` → SKIP (trial / PENDING_SALES).
 *   - If `currentPeriodEnd > now` → SKIP (period still active).
 *   - If a cancellation has LANDED → SKIP. A declared one has not.
 *   - Otherwise → start := old `currentPeriodEnd`, end := periodEndAfter(start),
 *     and the minimum term renews with it.
 */
export function computeNextPeriod(sub: PeriodRollInput, now: Date): NextPeriodWindow | null {
    if (sub.currentPeriodEnd === null) return null;
    if (sub.currentPeriodEnd > now) return null;
    // A declared cancellation does not stop anything; a landed one does.
    //
    // `landedAt` falls back to `canceledAt` for rows written before the two
    // fields separated: there it IS the effective date. A backfill is the other
    // half of this and belongs in the migration guide, but the reading must not
    // depend on every consumer having run it — an unbilled subscription that
    // keeps renewing is not a defect anybody notices from the inside.
    const landedAt = sub.canceledEffectiveAt ?? sub.canceledAt;
    if (landedAt !== null && landedAt <= now) return null;
    const newStart = sub.currentPeriodEnd;
    // The anchor, not the day of `newStart` — `newStart` is the previous period
    // end, and that has already been through a clamp. Reading the day from it
    // is how a subscription billed on the 31st ended up billed on the 28th for
    // the rest of its life after one February.
    const newEnd = periodEndAfter(
        newStart,
        sub.billingCycle,
        now,
        sub.billingAnchorDay ?? undefined,
    );
    return {
        currentPeriodStart: newStart,
        currentPeriodEnd: newEnd,
        minimumTermUntil: newEnd,
    };
}
