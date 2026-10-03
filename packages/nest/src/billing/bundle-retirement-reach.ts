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
// date: a change scheduled to land by then included.

import type {
    BillingCycle,
    BundleRetirementSkipReason,
    SubscriptionBundleRecord,
} from '@saasicat/core';

import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import type { PlanBeside } from './add-on-fits-plan.js';
import { advanceOneCycle } from './billing-period.js';
import {
    RETIREMENT_LEAD_MONTHS,
    calendarMonthsAfter,
    effectiveDate,
    lastDayBefore,
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
 */
export function bundleRetirementReach(
    booking: RetiringBooking,
    sub: RetiringSubscription,
    toldAt: Date,
): BundleRetirementReach {
    if (sub.status === 'CANCELED') return { reached: false, reason: 'ended' };
    const earliest = calendarMonthsAfter(toldAt, RETIREMENT_LEAD_MONTHS);
    const at = periodEndOf(booking, sub, earliest);
    if (!at) return { reached: false, reason: 'no-term' };
    // A booking ends with the subscription that pays for it, and with its own
    // cancellation: either by the date, and nothing is left to move.
    const subscriptionEnds = cancellationLandsAt(sub);
    const bookingEnds = booking.canceledEffectiveAt ?? booking.canceledAt;
    if (
        (subscriptionEnds !== null && subscriptionEnds <= at) ||
        (bookingEnds !== null && bookingEnds <= at)
    ) {
        return { reached: false, reason: 'cancelled-before' };
    }
    const plan = planAt(sub, at);
    return {
        reached: true,
        effectiveAt: at,
        lastDayToCancel: lastDayBefore(at),
        plan,
        billingCycle: (booking.billingCycle as BillingCycle | null) ?? plan.billingCycle,
    };
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
 * then: the target of a change scheduled to land by then, in the rhythm the
 * change lands in, or the plan it is on.
 */
export function planAt(
    sub: Pick<
        RetiringSubscription,
        'plan' | 'billingCycle' | 'pendingPlan' | 'pendingBillingCycle' | 'pendingEffectiveAt'
    >,
    at: Date,
): PlanBeside {
    if (sub.pendingPlan && sub.pendingEffectiveAt && sub.pendingEffectiveAt <= at) {
        return { planKey: sub.pendingPlan, billingCycle: rhythmTheChangeLandsIn(sub) };
    }
    return { planKey: sub.plan, billingCycle: sub.billingCycle as BillingCycle };
}
