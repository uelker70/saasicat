// Whether an add-on retirement reaches a booking, and when it takes effect there.
//
// The booking's own period sets the date: the first end of it that lies at
// least three calendar months after the notice reached the subscriber, never
// inside a period the customer has paid for — the lead and the notice are the
// plan retirement's (`retirementReach`). A booking's periods end on the plan's
// billing day in the booking's own rhythm; one without a rhythm or a period of
// its own is billed with the plan, so it ends with the plan's terms.
//
// What the replacement has to run beside is the plan as it stands on that
// date — a change scheduled to land by then, and a retirement of the plan's
// version told to take effect by then, included — and every plan the
// subscription is already set to move to after it, since the booking meets
// each of those on the version it continues on.

import type {
    BillingCycle,
    BundleRetirementSkipReason,
    SubscriptionBundleRecord,
} from '@saasicat/core';

import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import type { PlanAhead, PlanBeside } from './add-on-fits-plan.js';
import { advanceOneCycle } from './billing-period.js';
import {
    RETIREMENT_LEAD_MONTHS,
    calendarMonthsAfter,
    effectiveDate,
    lastDayBefore,
    rhythmAt,
    type RetiringSubscription,
} from './retirement-reach.js';
import { rhythmTheChangeLandsIn } from './scheduled-change.js';

/** What an add-on retirement means for one booking, or why it does not reach it. */
export type BundleRetirementReach =
    | {
          readonly reached: true;
          /** When it continues on the replacement: an end of its period, at least the lead after `toldAt`. */
          readonly effectiveAt: Date;
          /** The last whole UTC day before it takes effect: the last day to cancel without the minimum term. */
          readonly lastDayToCancel: string;
          /** The plan the add-on runs beside on that day, and the rhythm that plan is billed in. */
          readonly plan: PlanBeside;
          /** The plans the subscription is set to move to after that day, before it ends. */
          readonly plansAfter: readonly PlanAhead[];
          /** The rhythm the booking is billed in. */
          readonly billingCycle: BillingCycle;
      }
    | { readonly reached: false; readonly reason: BundleRetirementSkipReason };

/** The booking dates the decision reads. */
export type RetiringBooking = Pick<
    SubscriptionBundleRecord,
    'billingCycle' | 'currentPeriodEnd' | 'canceledAt' | 'canceledEffectiveAt'
>;

/**
 * Whether an add-on retirement whose notice reaches the subscription of
 * `booking` at `toldAt` reaches the booking, and when it takes effect.
 * `ahead` are the plans the subscription is set to move to (`plansAheadOf`).
 */
export function bundleRetirementReach(
    booking: RetiringBooking,
    sub: RetiringSubscription,
    toldAt: Date,
    ahead: readonly PlanAhead[] = [],
): BundleRetirementReach {
    // A booking whose cancellation has landed is over, like a subscription
    // that has ended; the version still names it, nothing else does.
    if (sub.status === 'CANCELED' || bookingEndsBy(booking, toldAt)) {
        return { reached: false, reason: 'ended' };
    }
    const earliest = calendarMonthsAfter(toldAt, RETIREMENT_LEAD_MONTHS);
    const at = periodEndOf(booking, sub, earliest);
    if (!at) return { reached: false, reason: 'no-term' };
    // A booking ends with the subscription that pays for it, and with its own
    // cancellation: either by the date, and nothing is left to move.
    const subscriptionEnds = cancellationLandsAt(sub);
    if ((subscriptionEnds !== null && subscriptionEnds <= at) || bookingEndsBy(booking, at)) {
        return { reached: false, reason: 'cancelled-before' };
    }
    const plan = planAt(sub, at, ahead);
    return {
        reached: true,
        effectiveAt: at,
        lastDayToCancel: lastDayBefore(at),
        plan,
        plansAfter: plansMetAfter(ahead, at, sub),
        billingCycle: (booking.billingCycle as BillingCycle | null) ?? plan.billingCycle,
    };
}

/**
 * The plans in `ahead` that something running past `at` still meets: those the
 * subscription moves to after it, before the subscription itself ends.
 */
export function plansMetAfter(
    ahead: readonly PlanAhead[],
    at: Date,
    sub: Pick<RetiringSubscription, 'canceledAt' | 'canceledEffectiveAt'>,
): PlanAhead[] {
    const ends = cancellationLandsAt(sub);
    return ahead.filter((plan) => plan.from > at && (ends === null || plan.from < ends));
}

/**
 * Whether the booking's cancellation lands by `at`, so it does not run past it:
 * a retirement taking effect then has nothing to move, and nothing to say.
 */
export function bookingEndsBy(
    booking: Pick<SubscriptionBundleRecord, 'canceledAt' | 'canceledEffectiveAt'>,
    at: Date,
): boolean {
    const ends = booking.canceledEffectiveAt ?? booking.canceledAt;
    return ends !== null && ends <= at;
}

/**
 * Whether the booking runs no longer than `at`: its own cancellation, or that
 * of the subscription paying for it (`subscriptionEndsAt`, when that one
 * lands), lands by then.
 *
 * The run that moves bookings and the journal that charges them both ask it
 * at `now`, and must answer alike: a booking the run no longer moves is one
 * whose periods the journal no longer holds back for the move (`SC-BUN-050`).
 */
export function bookingOverBy(
    booking: Pick<SubscriptionBundleRecord, 'canceledAt' | 'canceledEffectiveAt'>,
    subscriptionEndsAt: Date | null,
    at: Date,
): boolean {
    return bookingEndsBy(booking, at) || (subscriptionEndsAt !== null && subscriptionEndsAt <= at);
}

/**
 * The first end of the booking's period at or after `earliest`. Its periods
 * run in its own rhythm and end on the plan's billing day; where it has no
 * rhythm or no period of its own, it is billed with the plan and ends with the
 * plan's terms.
 */
function periodEndOf(
    booking: RetiringBooking,
    sub: RetiringSubscription,
    earliest: Date,
): Date | null {
    const rhythm = booking.billingCycle as BillingCycle | null;
    if (!rhythm || !booking.currentPeriodEnd) return effectiveDate(sub, earliest)?.at ?? null;
    const day =
        sub.billingAnchorDay ??
        sub.currentPeriodStart?.getUTCDate() ??
        booking.currentPeriodEnd.getUTCDate();
    let boundary = new Date(booking.currentPeriodEnd);
    while (boundary < earliest) boundary = advanceOneCycle(boundary, rhythm, day);
    return boundary;
}

/**
 * The plan the subscription is on at `at`, and the rhythm it is billed in
 * then. A change to another plan it scheduled itself, landing by then, is
 * where it is: landing first, it takes the subscription off the version a
 * retirement would move; landing after a retirement's move, it is carried
 * along by it (`SC-SUB-031`). Otherwise a retirement it was told of that takes
 * effect by then (`ahead`) has moved it to that retirement's plan. The rhythm
 * is the one billed then, a change of rhythm alone included.
 */
export function planAt(
    sub: Pick<
        RetiringSubscription,
        'plan' | 'billingCycle' | 'pendingPlan' | 'pendingBillingCycle' | 'pendingEffectiveAt'
    >,
    at: Date,
    ahead: readonly PlanAhead[] = [],
): PlanBeside {
    const changeLands = sub.pendingEffectiveAt !== null && sub.pendingEffectiveAt <= at;
    if (sub.pendingPlan && sub.pendingPlan !== sub.plan && changeLands) {
        return { planKey: sub.pendingPlan, billingCycle: rhythmTheChangeLandsIn(sub) };
    }
    const moved = ahead.find((plan) => plan.by === 'retirement' && plan.from <= at);
    return { planKey: moved?.planKey ?? sub.plan, billingCycle: rhythmAt(sub, at) };
}
