// The pure decision behind a renewal: the next billing window of a
// subscription. A renewal keeps the plan version the subscription is bound to;
// a newer one reaches it as an offer, never through the renewal.
//
// Consumers implement the cron-job loop (DB query, transaction, audit, cache
// invalidate) — the platform provides the decision defined here.

import type { BillingCycle } from '@saasicat/core';
import { periodEndAfter } from './billing-period.js';

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
