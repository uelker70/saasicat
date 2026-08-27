import type { BillingCycle } from '@saasicat/core';

import { advanceOneCycle, periodEndAfter, retreatOneCycle } from './billing-period.js';

// When a bundle's periods begin and end.
//
// A bundle hangs off the plan that pays for it, and the two have to end on the
// same day — otherwise a plan cancellation leaves a bundle running with nothing
// to grant, or a bundle has to be trimmed and somebody is owed the difference.
// Aligning at booking means the trimming case never arises, which is the whole
// reason to do it here rather than at the end.
//
// The alignment is one rule: **a bundle's periods end on the day the plan's
// do.** The first one is short, from the booking to the next occurrence of that
// day, and is charged pro rata for exactly that stretch. Every one after it runs
// from anchor to anchor, in step with the plan for as long as both live.
//
//   plan ends 31.07, bundle booked monthly on 21.02
//     → 21.02–28.02, then 31.03, 30.04, 31.05, 30.06, and 31.07 with the plan
//
//   plan ends 17.07, bundle booked monthly on 21.02
//     → 21.02–17.03, then 17.04, 17.05, 17.06, and 17.07 with the plan
//
// A yearly bundle cannot be aligned by a day alone — its period is a year, so
// it has to land on the plan's own boundary, month and day together. That also
// makes a yearly bundle on a monthly plan impossible rather than merely
// discouraged: there is no yearly boundary to meet.

/** The last day of a month, for clamping an anchor that the month is too short for. */
function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * `day` in the month of `reference`, at the plan's time of day, clamped where
 * that month is shorter.
 *
 * The time comes from `timeOfDay` — the plan's own boundary — and not from
 * midnight. A plan whose periods end at 14:00 was being read as ending at 00:00,
 * so a bundle booked at 10:00 on the boundary day saw a boundary that had
 * "already passed", took the next month instead, and was then paid through a
 * date after its plan had stopped granting it. Midnight is only the right
 * answer where the plan's boundaries are at midnight, and nothing guarantees
 * that.
 */
function onDayOfMonth(reference: Date, day: number, timeOfDay: Date): Date {
    const year = reference.getUTCFullYear();
    const month = reference.getUTCMonth();
    const out = new Date(reference);
    out.setUTCFullYear(year, month, Math.min(day, daysInMonth(year, month)));
    out.setUTCHours(
        timeOfDay.getUTCHours(),
        timeOfDay.getUTCMinutes(),
        timeOfDay.getUTCSeconds(),
        timeOfDay.getUTCMilliseconds(),
    );
    return out;
}

/** What a caller knows about the plan's billing rhythm, before resolving it. */
export interface PlanAnchorSource {
    /** The stored anchor, where the subscription has one. */
    billingAnchorDay?: number | null;
    /** The date that opened the current run of periods. */
    currentPeriodStart?: Date | null;
    /** What opened it before the first window was written. */
    startedAt?: Date | null;
}

/**
 * The day of the month the plan is billed on, resolved once for everybody.
 *
 * Every caller that quotes a bundle and every caller that books one has to
 * reach the same answer, or the preview describes a different contract from the
 * one written — and this is the field that decides the difference. It happened:
 * the preview derived the day from the window start while the booking left the
 * value null and let the arithmetic read the window END, so for a 31 January to
 * 28 February window the preview quoted a period ending on the 31st and the
 * booking stored the 28th, after which the two renewed on different days
 * forever.
 *
 * The order is authority, not convenience. The stored anchor is the answer
 * where it exists. Failing that, the day that OPENED the current window —
 * never the day that closed it, because a closing day has already been through
 * a clamp and reading it is how a subscription billed on the 31st ends up
 * billed on the 28th for the rest of its life.
 */
export function resolvePlanAnchorDay(source: PlanAnchorSource): number | null {
    const stored = source.billingAnchorDay;
    if (stored != null && Number.isInteger(stored) && stored >= 1 && stored <= 31) {
        return stored;
    }
    const windowStart = source.currentPeriodStart ?? source.startedAt;
    return windowStart ? windowStart.getUTCDate() : null;
}

export interface BundleFirstPeriodInput {
    /** When the bundle was booked. */
    startedAt: Date;
    /** The bundle's own cycle — never longer than the plan's. */
    cycle: BillingCycle;
    /** When the plan's current period ends, if it has one. */
    planPeriodEnd: Date | null;
    /** The day of the month the plan is billed on, if it is known. */
    planAnchorDay: number | null;
}

/**
 * The end of a bundle's first period: short, and landing on the plan's day.
 *
 * Null where the plan has no period to align to — a trial, or a subscription
 * still waiting for sales. A bundle booked there has no period of its own
 * either, rather than one invented from the booking date.
 */
export function bundleFirstPeriodEnd(input: BundleFirstPeriodInput): Date | null {
    const { startedAt, cycle, planPeriodEnd, planAnchorDay } = input;
    // `== null`, so a caller that omits the field says the same thing as one
    // that passes null. The type asks for `Date | null`, but this is reached
    // from JavaScript too, and "no period" is one statement however it arrives.
    if (planPeriodEnd == null) return null;

    // A yearly bundle has to meet the plan's own boundary, month and day
    // together — a day of the month says nothing about which month.
    if (cycle === 'YEARLY') {
        return planPeriodEnd > startedAt ? planPeriodEnd : advanceOneCycle(planPeriodEnd, 'YEARLY');
    }

    // Monthly: the next occurrence of the plan's billing day. Taken from the
    // plan's anchor rather than from its period end, because the period end may
    // itself have been clamped by a short month and would then hand on the
    // wrong day — the drift the anchor exists to stop.
    const anchor = planAnchorDay ?? planPeriodEnd.getUTCDate();
    const thisMonth = onDayOfMonth(startedAt, anchor, planPeriodEnd);
    if (thisMonth > startedAt) return thisMonth;
    return advanceOneCycle(thisMonth, 'MONTHLY', anchor);
}

/**
 * The start of the full cycle that the first period is a part of.
 *
 * Not the booking date: the first period is short, and a short period is
 * charged pro rata against a **whole** cycle. That whole cycle ends where the
 * first period ends and begins one cycle before it — so a monthly bundle
 * booked on 21 February against a plan anchored on the 31st is charged for
 * 7 of the 28 days between 31 January and 28 February, not for 7 of 31, and
 * not for the 160 days left of the plan's own yearly period.
 *
 * Prorating against the plan's period was the shape this used to have, and it
 * is wrong by the width of the difference between the two cycles: a monthly
 * bundle on a yearly plan was charged a fraction of a *year* at a monthly
 * price.
 */
export function bundleFirstPeriodStart(
    firstPeriodEnd: Date,
    cycle: BillingCycle,
    planAnchorDay: number | null,
): Date {
    return retreatOneCycle(firstPeriodEnd, cycle, planAnchorDay ?? undefined);
}

/**
 * The end of every period after the first: one cycle on, still on the plan's
 * day.
 */
export function bundleNextPeriodEnd(
    currentPeriodEnd: Date,
    cycle: BillingCycle,
    planAnchorDay: number | null,
): Date {
    return advanceOneCycle(currentPeriodEnd, cycle, planAnchorDay ?? undefined);
}

/**
 * Whether a bundle may be billed on `bundleCycle` beside a plan on `planCycle`.
 *
 * A bundle may run in a shorter rhythm than its plan, never a longer one. A
 * yearly bundle on a monthly plan has no boundary to meet — the plan's periods
 * end twelve times before the bundle's first one does, and every one of those
 * ends is a moment the plan could stop and leave the bundle committed with
 * nothing to grant.
 *
 * The shorter direction is fine and is the interesting case: a monthly bundle
 * on a yearly plan simply lands on the plan's day every month, and on the
 * plan's own boundary in the month the plan ends.
 */
/**
 * How long a booking commits the tenant when nobody says otherwise: **not at
 * all**.
 *
 * An add-on can be cancelled at any time up to the moment its next period
 * begins, and the cancellation takes effect at the end of the period it is in.
 * The tenant pays for the period they are in, it ends normally, and nothing
 * has to be paid back — which is the whole reason the rule is shaped this way.
 *
 * It was 12 until 2026-08-27, applied to every booking without an operator
 * doing anything, and it made that rule impossible: a cancellation lands at
 * `max(currentPeriodEnd, minimumTermEndsAt)`, so a monthly add-on booked today
 * could not be cancelled to next month. On a yearly plan the term even
 * outlasted the bundle's own last period. An operator who wants a commitment
 * configures one; nobody gets one by default.
 */
export const DEFAULT_BUNDLE_MINIMUM_TERM_MONTHS = 0;

export function bundleCycleFitsPlan(bundleCycle: BillingCycle, planCycle: BillingCycle): boolean {
    return !(bundleCycle === 'YEARLY' && planCycle === 'MONTHLY');
}

/** What a renewal job reads from a booking to decide whether to roll it on. */
export interface BundlePeriodRollInput {
    /**
     * Null in two different situations, and the difference decides everything:
     * a booking made before these columns existed, and one whose plan had no
     * period to align to yet — a trial, or a subscription awaiting sales.
     *
     * `billingCycle` is what tells them apart. The booking route always writes
     * it, so a row that has one but no window is the second case and is waiting
     * for a window; a row with neither is the first and is billed with the plan.
     */
    currentPeriodEnd: Date | null;
    /** Null only on a booking made before bundles had a rhythm of their own. */
    billingCycle: BillingCycle | null;
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
}

/** The plan the booking hangs off, as the same job reads it. */
export interface BundlePlanContext {
    billingCycle: BillingCycle;
    billingAnchorDay: number | null;
    /** When the plan ends, or null while it runs on. */
    endsAt: Date | null;
    /**
     * The plan's own window, which a booking still waiting for one joins.
     *
     * Null while the plan has no paid period either — then there is nothing to
     * align to and the booking keeps waiting.
     */
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
}

/** The window a roll opens. */
export interface BundlePeriodWindow {
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
}

/**
 * The window a booking should hold now, or `null` for nothing to do.
 *
 * The bundle counterpart of `computeNextPeriod`, and the same division of
 * labour: the platform decides, the consumer's cron reads, writes and audits.
 * Without it the columns written at booking would never move again, and "every
 * period after the first runs anchor to anchor" would be a claim nothing keeps.
 *
 * It answers two questions the job cannot tell apart from the outside, because
 * both look like a booking whose window is not current:
 *
 * - **Opening the first window.** A bundle booked while its plan had no period —
 *   during a trial, or before sales finished — was stored without one, because
 *   there was nothing to align to. Once the plan has a paid period the booking
 *   joins it. Left undone, a monthly bundle on a yearly trial kept granting its
 *   features and never acquired a window to bill them in.
 * - **Rolling the next one.** The ordinary case, anchor to anchor.
 *
 * It declines in four:
 *
 * - **A booking billed with the plan** — written before these columns existed,
 *   recognisable by having no rhythm of its own either. Giving it a window would
 *   start billing it a second time.
 * - **The plan has no paid period yet**, so there is still nothing to align to.
 * - **The period is still running.** The job's filter should not have offered it.
 * - **The booking's own cancellation has landed.** A declared one changes
 *   nothing, exactly as for a subscription.
 * - **The plan has ended, or ends before the new period could open.** This is
 *   the rule the alignment exists for: the bundle ends with the plan, without a
 *   cancellation of its own.
 *
 * Where the plan ends *inside* the new period — which only happens when someone
 * ends it off-anchor — the window is cut back to the plan's end rather than
 * allowed to outlive it. A bundle committed past its plan is the one state this
 * whole arrangement is built to prevent.
 */
export function computeNextBundlePeriod(
    booking: BundlePeriodRollInput,
    plan: BundlePlanContext,
    now: Date,
): BundlePeriodWindow | null {
    // Two dates end this booking, and neither may be run past: the plan's end,
    // and the booking's own cancellation. The second was missed for as long as
    // only the first was checked — a cancellation declared inside a minimum
    // term lands on a date measured from the booking, while periods land on the
    // plan's anchor, so the two rarely coincide and a renewal opened a whole
    // cycle past the date the cancel API had promised.
    const endsAt = earliest(plan.endsAt, booking.canceledEffectiveAt ?? booking.canceledAt);
    if (endsAt !== null && endsAt <= now) return null;

    const window =
        booking.currentPeriodEnd === null
            ? openFirstWindow(booking, plan, now)
            : rollNextWindow(booking, plan, now);
    if (window === null) return null;
    // However the window was arrived at, it stops where the booking does.
    if (endsAt !== null && endsAt <= window.currentPeriodStart) return null;
    return endsAt !== null && endsAt < window.currentPeriodEnd
        ? { currentPeriodStart: window.currentPeriodStart, currentPeriodEnd: endsAt }
        : window;
}

/** The earlier of two dates, either of which may be absent. */
function earliest(a: Date | null, b: Date | null): Date | null {
    if (a === null) return b;
    if (b === null) return a;
    return a <= b ? a : b;
}

/** A booking that was stored without a window, now that the plan has one. */
function openFirstWindow(
    booking: BundlePeriodRollInput,
    plan: BundlePlanContext,
    now: Date,
): BundlePeriodWindow | null {
    // No rhythm either: written before these columns existed, billed with the
    // plan, and not waiting for anything.
    if (booking.billingCycle === null) return null;
    const planPeriodEnd = plan.currentPeriodEnd ?? null;
    if (planPeriodEnd === null) return null;

    const currentPeriodStart = plan.currentPeriodStart ?? now;
    const firstEnd = bundleFirstPeriodEnd({
        startedAt: currentPeriodStart,
        cycle: booking.billingCycle,
        planPeriodEnd,
        planAnchorDay: plan.billingAnchorDay,
    });
    if (firstEnd === null) return null;
    // To a boundary AFTER now, exactly as the roll does. The plan's window may
    // have opened months ago while nothing was here to notice — a bundle booked
    // during a trial, a yearly period that began in January, a job that first
    // runs in April. Handing back January to February would be a window already
    // over, and the documented integration writes once per booking per run, so
    // the booking would stay unbillable for as many runs as were missed.
    const currentPeriodEnd =
        firstEnd > now
            ? firstEnd
            : periodEndAfter(
                  firstEnd,
                  booking.billingCycle,
                  now,
                  plan.billingAnchorDay ?? undefined,
              );
    return { currentPeriodStart, currentPeriodEnd };
}

/**
 * The ordinary case: the period is over, the next one runs anchor to anchor.
 *
 * To the first boundary **after now**, not one cycle on. A job that has not run
 * for three months would otherwise hand back a window that ended two months
 * ago, and the integration in the guide writes once per booking per run — so
 * catching up would take as many runs as were missed. `computeNextPeriod` has
 * always jumped for the plan; a bundle that did not would drift away from the
 * plan it is supposed to run in step with, which is the one thing it must not
 * do.
 */
function rollNextWindow(
    booking: BundlePeriodRollInput,
    plan: BundlePlanContext,
    now: Date,
): BundlePeriodWindow | null {
    const currentPeriodStart = booking.currentPeriodEnd;
    if (currentPeriodStart === null || currentPeriodStart > now) return null;
    const cycle = booking.billingCycle ?? plan.billingCycle;
    return {
        currentPeriodStart,
        currentPeriodEnd: periodEndAfter(
            currentPeriodStart,
            cycle,
            now,
            plan.billingAnchorDay ?? undefined,
        ),
    };
}
