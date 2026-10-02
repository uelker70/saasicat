// Whether a retirement reaches a subscription, and when it takes effect there.
//
// A retirement reaches running contracts, so it comes with notice: it takes
// effect at the first end of one of the subscription's terms that lies at least
// three calendar months after the announcement — never inside a term, where the
// customer has paid for the version they are on. A term is the period of the
// subscription's rhythm; a subscription still in its trial counts its terms
// from the end of the trial, and one with a change of rhythm scheduled counts
// them in the new rhythm from the day it lands.

import {
    startOfUtcDay,
    type BillingCycle,
    type RetirementSkipReason,
    type SubscriptionUsageRecord,
} from '@saasicat/core';

import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { advanceOneCycle, periodEndAfter } from './billing-period.js';

/** Calendar months between an announcement and the earliest effective date. */
export const RETIREMENT_LEAD_MONTHS = 3;

/** A subscription is reached by a retirement at most once in this many calendar months. */
export const RETIREMENT_REPEAT_MONTHS = 12;

/** What a retirement means for one subscription, or why it does not reach it. */
export type RetirementReach =
    | {
          readonly reached: true;
          /** When it continues on the replacement: a term end, at least the lead after the announcement. */
          readonly effectiveAt: Date;
          /**
           * The last day it may be cancelled without notice: the last whole UTC
           * day before it takes effect, which is the day before the effective
           * day — a term ends at the moment it was booked, not at midnight.
           */
          readonly lastDayToCancel: string;
          /** The rhythm it is billed in when the retirement takes effect. */
          readonly billingCycle: BillingCycle;
      }
    | { readonly reached: false; readonly reason: RetirementSkipReason };

/**
 * The subscription dates the decision reads, with the version it is on and the
 * one a scheduled change binds, where an adapter passes them.
 */
export type RetiringSubscription = Pick<
    SubscriptionUsageRecord,
    | 'plan'
    | 'status'
    | 'billingCycle'
    | 'trialEndsAt'
    | 'startedAt'
    | 'currentPeriodStart'
    | 'currentPeriodEnd'
    | 'billingAnchorDay'
    | 'canceledAt'
    | 'canceledEffectiveAt'
    | 'pendingPlan'
    | 'pendingBillingCycle'
    | 'pendingEffectiveAt'
    | 'pendingChangeVersionId'
> & { readonly planVersion?: { readonly id: string } | null };

/**
 * `months` calendar months after `from`: the same day of the month where that
 * month has it, otherwise its last day, at the same time of day.
 */
export function calendarMonthsAfter(from: Date, months: number): Date {
    const year = from.getUTCFullYear();
    const month = from.getUTCMonth() + months;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const out = new Date(from);
    out.setUTCFullYear(year, month, Math.min(from.getUTCDate(), lastDay));
    return out;
}

/** Whether a retirement announced at `announcedAt` reaches `sub`, and when it takes effect. */
export function retirementReach(sub: RetiringSubscription, announcedAt: Date): RetirementReach {
    if (sub.status === 'CANCELED') return { reached: false, reason: 'ended' };
    const effective = effectiveDate(sub, calendarMonthsAfter(announcedAt, RETIREMENT_LEAD_MONTHS));
    if (!effective) return { reached: false, reason: 'no-term' };
    const effectiveAt = effective.at;
    const landsAt = cancellationLandsAt(sub);
    if (landsAt !== null && landsAt <= effectiveAt) {
        return { reached: false, reason: 'cancelled-before' };
    }
    if (leavesTheVersionBy(sub, effectiveAt)) {
        return { reached: false, reason: 'changes-before' };
    }
    return {
        reached: true,
        effectiveAt,
        lastDayToCancel: new Date(startOfUtcDay(effectiveAt).getTime() - 1)
            .toISOString()
            .slice(0, 10),
        billingCycle: effective.billingCycle,
    };
}

/**
 * Whether a scheduled change takes the subscription off the version it is on by
 * `at`: to another plan, or to another version of this one — a newer version it
 * took for the end of its term is scheduled on the same plan and in the same
 * rhythm, so only the version it binds tells the two apart.
 */
function leavesTheVersionBy(sub: RetiringSubscription, at: Date): boolean {
    if (sub.pendingEffectiveAt === null || sub.pendingEffectiveAt > at) return false;
    if (sub.pendingPlan !== null && sub.pendingPlan !== sub.plan) return true;
    const next = sub.pendingChangeVersionId;
    return Boolean(next && sub.planVersion && next !== sub.planVersion.id);
}

/** A change of rhythm scheduled on the plan the subscription keeps, or null. */
function scheduledRhythm(sub: RetiringSubscription): { at: Date; cycle: BillingCycle } | null {
    if (sub.pendingPlan !== sub.plan || !sub.pendingBillingCycle || !sub.pendingEffectiveAt) {
        return null;
    }
    if (sub.pendingBillingCycle === sub.billingCycle) return null;
    return { at: sub.pendingEffectiveAt, cycle: sub.pendingBillingCycle as BillingCycle };
}

/**
 * The first term end at or after `earliest`, counted the way the subscription
 * is billed — in its new rhythm from the day a scheduled change of rhythm
 * lands — and the rhythm it is billed in from then.
 */
function effectiveDate(
    sub: RetiringSubscription,
    earliest: Date,
): { at: Date; billingCycle: BillingCycle } | null {
    const cycle = sub.billingCycle as BillingCycle;
    const inTrial = sub.status === 'TRIAL' && sub.trialEndsAt !== null;
    // Where the terms are counted from, and the day of the month they fall on:
    // the end of the trial, which opens the first paid period; otherwise the
    // end of the period running now, on the day the subscription is billed.
    const first = inTrial
        ? sub.trialEndsAt
        : (sub.currentPeriodEnd ??
          (sub.startedAt
              ? periodEndAfter(sub.startedAt, cycle, earliest, sub.billingAnchorDay ?? undefined)
              : null));
    if (!first) return null;
    const anchor = inTrial
        ? first.getUTCDate()
        : (sub.billingAnchorDay ?? sub.currentPeriodStart?.getUTCDate() ?? first.getUTCDate());
    const change = scheduledRhythm(sub);
    let rhythm = cycle;
    let day = anchor;
    let boundary = new Date(first);
    while (boundary < earliest) {
        // A change of rhythm lands at the end of a term, and the terms after it
        // run in the new rhythm, counted from that day.
        if (change && rhythm !== change.cycle && boundary >= change.at) {
            boundary = new Date(change.at);
            rhythm = change.cycle;
            day = change.at.getUTCDate();
            if (boundary >= earliest) break;
        }
        boundary = advanceOneCycle(boundary, rhythm, day);
    }
    const billingCycle = change && change.at <= boundary ? change.cycle : cycle;
    return { at: boundary, billingCycle };
}
