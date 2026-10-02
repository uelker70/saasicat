// The one reminder a retirement sends (`SC-SUB-034`): where staying put costs a
// subscription something, 14 days before the retirement takes effect. One
// answer for the run that sends it and for whatever shows it.

import { retirementSwitchTerms } from './retirement-switch.js';
import { takesSomethingAway } from './version-offer.js';
import type { VersionRetiredNotice } from './version-retirement.types.js';

/** How many days before a retirement takes effect its reminder is due. */
export const RETIREMENT_REMINDER_LEAD_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the reminder of a retirement is due: 14 days before it takes effect, at
 * the same time of day. UTC has no change of clocks, so that is the effective
 * day less 14 calendar days.
 */
export function retirementReminderDueAt(notice: Pick<VersionRetiredNotice, 'effectiveAt'>): Date {
    return new Date(Date.parse(notice.effectiveAt) - RETIREMENT_REMINDER_LEAD_DAYS * DAY_MS);
}

/**
 * Whether the reminder is due at `now`: from its day until the retirement
 * takes effect. A run that did not happen on the day is caught up by the next
 * one before the date; after it there is nothing left to remind of.
 */
export function retirementReminderIsDue(
    notice: Pick<VersionRetiredNotice, 'effectiveAt'>,
    now: Date,
): boolean {
    return retirementReminderDueAt(notice) <= now && now.getTime() < Date.parse(notice.effectiveAt);
}

/**
 * Whether staying put costs the subscription something when the retirement
 * takes effect (D9): the replacement takes a feature or a quota away, or is
 * dearer in `billingCycle`, the rhythm it is billed in then — or not sold in
 * it. A price that rises only in another rhythm costs it nothing.
 */
export function retirementCostsTheSubscription(
    notice: Pick<VersionRetiredNotice, 'retired' | 'replacement' | 'changes' | 'lastDayToCancel'>,
    billingCycle: string,
): boolean {
    if (notice.changes.some(takesSomethingAway)) return true;
    const terms = retirementSwitchTerms(notice, billingCycle);
    return terms === null || terms.held !== null;
}
