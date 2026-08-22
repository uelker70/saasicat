import type { BillingCycle } from '@saasicat/types';

// Period-boundary calculations for subscriptions.
//
// UTC methods chosen deliberately: with locally-relative setMonth/setFullYear,
// DST transitions cause an off-by-one-day in the UTC output. Period boundaries
// are UTC-stable — we want "1 month later, same UTC day".

function advanceOneCycle(d: Date, cycle: BillingCycle): Date {
    const out = new Date(d);
    if (cycle === 'YEARLY') {
        out.setUTCFullYear(out.getUTCFullYear() + 1);
    } else {
        out.setUTCMonth(out.getUTCMonth() + 1);
    }
    return out;
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
