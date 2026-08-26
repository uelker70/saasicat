import type { BillingCycle } from '@saasicat/core';

// Period-boundary calculations for subscriptions.
//
// UTC methods chosen deliberately: with locally-relative setMonth/setFullYear,
// DST transitions cause an off-by-one-day in the UTC output. Period boundaries
// are UTC-stable — we want "1 month later, same UTC day".

/**
 * One period onwards, on `anchorDay` where the month has one.
 *
 * The anchor is the day the subscription is billed on, and it survives months
 * that are too short for it. Without one, this function has to read the day
 * from its own input — and its own input is the previous clamped result, so a
 * February eats the anchor and never gives it back: 31 January became 28
 * February and then 28 March, 28 April, 28 May, for the rest of the
 * subscription's life. Three days lost once, invisibly, and every later date
 * measured from the wrong one.
 *
 * Clamping applies to the step's OUTPUT, never to the next step's input. A
 * subscription anchored on the 31st is billed on the 28th in February and on
 * the 31st again in March; one anchored on the 30th is billed on the 30th in
 * October, not the 31st. The anchor is a day number, not "the end of the
 * month".
 *
 * Omitting it keeps the old reading — the day of `d` — which is right wherever
 * a caller has only one step to take and `d` is itself the anchor.
 */
export function advanceOneCycle(d: Date, cycle: BillingCycle, anchorDay?: number): Date {
    // `setUTCMonth` does not clamp, it overflows: 31 January plus one month is
    // 3 March, and 29 February plus one year is 1 March.
    const year = d.getUTCFullYear() + (cycle === 'YEARLY' ? 1 : 0);
    const month = d.getUTCMonth() + (cycle === 'YEARLY' ? 0 : 1);
    const day = Math.min(usableAnchor(anchorDay) ?? d.getUTCDate(), daysInMonth(year, month));
    const out = new Date(d);
    out.setUTCFullYear(year, month, day);
    return out;
}

/**
 * The day of the month a subscription is billed on.
 *
 * Read from whichever date opened the current run of periods — the start of the
 * window, not the end of the last one, because the end has already been through
 * a clamp.
 */
export function billingAnchorDay(windowStart: Date): number {
    return windowStart.getUTCDate();
}

/**
 * An anchor that can be a day of a month, or nothing.
 *
 * A value outside 1–31 is treated as absent rather than clamped into range,
 * because a number that cannot be a day is not a day and guessing which one it
 * meant would be inventing a billing date. The column is a plain nullable
 * integer that a consumer's own backfill fills, and zero is what an `EXTRACT`
 * over a missing date can leave behind.
 *
 * Left unguarded this was not a rounding error: `Math.min(0, 31)` is 0, and day
 * 0 of a month is the last day of the month BEFORE it — so an anchor of zero
 * moved the period boundary backwards, and a subscription's next period ended
 * before its current one did.
 */
function usableAnchor(anchorDay: number | undefined): number | undefined {
    if (anchorDay === undefined) return undefined;
    if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) return undefined;
    return anchorDay;
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
export function periodEndAfter(
    startedAt: Date | null,
    cycle: BillingCycle,
    after: Date,
    anchorDay?: number,
): Date {
    const start = new Date(startedAt ?? after);
    // Every step measures from the anchor rather than from the step before it.
    // Iterating without one loses the anchor at the first short month and then
    // carries the loss forward — which is the whole of the drift this function
    // used to produce.
    const anchor = anchorDay ?? billingAnchorDay(start);
    let candidate = start;
    // If `startedAt > after` (subscription starts in the future), the first
    // period boundary is startedAt itself — after that we iterate upward.
    while (candidate <= after) {
        candidate = advanceOneCycle(candidate, cycle, anchor);
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
    anchorDay?: number,
): Date {
    const minLeadMs = minLeadDays * 86_400_000;
    const anchor = anchorDay ?? billingAnchorDay(new Date(startedAt ?? now));
    let candidate = periodEndAfter(startedAt, cycle, now, anchor);
    while (candidate.getTime() - now.getTime() < minLeadMs) {
        candidate = advanceOneCycle(candidate, cycle, anchor);
    }
    return candidate;
}
