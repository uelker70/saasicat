import type { BillingCycle } from '@saasicat/core';

// Period-boundary calculations for subscriptions.
//
// UTC methods chosen deliberately: with locally-relative setMonth/setFullYear,
// DST transitions cause an off-by-one-day in the UTC output. Period boundaries
// are UTC-stable — we want "1 month later, same UTC day".

/** One period onwards. Exported for the cancellation rules next door. */
export function advanceOneCycle(d: Date, cycle: BillingCycle): Date {
    // Clamped to the target month's last day, because `setUTCMonth` does not
    // clamp — it overflows. 31 January plus one month is 3 March, and 29
    // February plus one year is 1 March, so a subscription that started on a
    // month end drifts a few days further into the next month at every
    // renewal. Nobody noticed while the result was only a period boundary; a
    // cancellation now reports it to a customer as the day their contract ends.
    const year = d.getUTCFullYear() + (cycle === 'YEARLY' ? 1 : 0);
    const month = d.getUTCMonth() + (cycle === 'YEARLY' ? 0 : 1);
    const day = Math.min(d.getUTCDate(), daysInMonth(year, month));
    const out = new Date(d);
    out.setUTCFullYear(year, month, day);
    return out;
}

/** Day 0 of the next month is the last day of this one. Handles month 12. */
function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Finds the next period boundary that lies strictly **after** `after`.
 * Iterates from `startedAt` (fallback: `after`) by +1 cycle each time, until
 * the result is greater than `after`.
 */
export function periodEndAfter(startedAt: Date | null, cycle: BillingCycle, after: Date): Date {
    let candidate = new Date(startedAt ?? after);
    // If `startedAt > after` (subscription starts in the future), the first
    // period boundary is startedAt itself — after that we iterate upward.
    while (candidate <= after) {
        candidate = advanceOneCycle(candidate, cycle);
    }
    return candidate;
}

/**
 * Returns the initial period window for a subscription
 * (`currentPeriodStart`/`currentPeriodEnd`). `start` is `startedAt`,
 * `end = start + 1 cycle`. We deliberately do not iterate — on a
 * plan change / renewal cron run the value is actively reset.
 */
export function initialPeriodWindow(
    startedAt: Date,
    cycle: BillingCycle,
): { start: Date; end: Date } {
    return { start: startedAt, end: advanceOneCycle(startedAt, cycle) };
}

/**
 * Finds the earliest period boundary that lies **at least `minLeadDays` days**
 * in the future. Used by the notification cron to determine the effective
 * period for upcoming version changes:
 *
 *  - `BillingCycle = YEARLY` with `currentPeriodEnd ∈ [+42d, +43d)`: trivial,
 *    effective date = currentPeriodEnd.
 *  - `BillingCycle = MONTHLY` with `currentPeriodEnd in 16d`: 16d < 42d → the
 *    function jumps to the period after next (≥ 42d lead time).
 *
 * Spec: ROADMAP §2 no. 3 (advance-warning period), §6.1 (time-based selection).
 */
export function periodEndWithMinLead(
    startedAt: Date | null,
    cycle: BillingCycle,
    now: Date,
    minLeadDays = 42,
): Date {
    const minLeadMs = minLeadDays * 86_400_000;
    let candidate = periodEndAfter(startedAt, cycle, now);
    while (candidate.getTime() - now.getTime() < minLeadMs) {
        candidate = advanceOneCycle(candidate, cycle);
    }
    return candidate;
}
