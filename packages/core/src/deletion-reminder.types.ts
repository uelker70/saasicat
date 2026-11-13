// The reminders a tenant's administrators are sent before its data is deleted
// (`SC-CANC-022`).
//
// `config/saas.yaml` names lead times in days before the deletion day
// (`tenantBilling.endOfSubscription.reminderDaysBefore`). A lead time is due
// from the installation's day that many days before the deletion day, and a run
// reminds each end of one lead time at most: the smallest that is due and not
// yet covered, where a reminder told for a lead time covers it and every larger
// one. So lead times that passed before the end was recorded, or while no run
// ran, collapse into one reminder sent at once, the later ones go on their day,
// and none goes twice. From the deletion day on nothing is reminded: the
// deletion itself is due.

import { calendarDaysBetween, type CalendarDay } from './zoned-day.js';

/**
 * A tenant's data is deleted soon. Sent to the administrators of the tenant
 * whose subscription ended, once per end and lead time, while the tenant is
 * read-only — nobody may sign in any more, so this notice is how they learn
 * the day.
 *
 * Write the two days, not a count of days: a reminder that covers lead times
 * passed while no run ran goes out later than `daysBefore` days before the
 * deletion. Tell the administrator to take the tenant's export first: it is
 * `GET billing/export`, answered to the tenant's own administrator — signed
 * in as the tenant, not an operator acting as it — from the moment the end is
 * recorded until the data is deleted, unless the tenant is suspended, which
 * refuses it as it refuses every read. The application knows the address it
 * serves that route at, and its own words for the rest.
 */
export interface DeletionReminderNotice {
    readonly kind: 'deletion-reminder';
    readonly tenantId: string;
    readonly subscriptionId: string;
    /** The end the reminder is for: the record that keeps the deletion day. */
    readonly subscriptionEndId: string;
    /** The lead time the reminder answers, in days before `deletesOn`. */
    readonly daysBefore: number;
    /** The last day the tenant can still read and take its export on: the day before `deletesOn`. */
    readonly readOnlyUntil: CalendarDay;
    /** The installation's day the tenant's data is deleted on. */
    readonly deletesOn: CalendarDay;
}

/** What a reminder is recorded under, read apart: the end and the lead time. */
export interface DeletionReminderSubject {
    readonly subscriptionEndId: string;
    readonly daysBefore: number;
}

/**
 * The subject a reminder is recorded under: the end's id and the lead time,
 * `<end id>:<days>`, so one end is reminded once per lead time.
 */
export function deletionReminderSubjectOf(reminder: DeletionReminderSubject): string {
    return `${reminder.subscriptionEndId}:${reminder.daysBefore}`;
}

/**
 * The end and the lead time `deletionReminderSubjectOf` wrote into `subject`,
 * or null where it wrote none: no separator, no id before it, or no whole
 * number of days of at least one after it. Split at the last separator, so an
 * id holding one reads back whole.
 */
export function deletionReminderSubjectIn(subject: string): DeletionReminderSubject | null {
    const separator = subject.lastIndexOf(':');
    if (separator < 1) return null;
    const days = subject.slice(separator + 1);
    if (!/^[1-9]\d*$/.test(days)) return null;
    return { subscriptionEndId: subject.slice(0, separator), daysBefore: Number(days) };
}

/** What deciding on an end's reminder takes. */
export interface DeletionReminderQuestion {
    /** The installation's day the end's data is deleted on. */
    readonly deletesOn: CalendarDay;
    /** The lead times `config/saas.yaml` names now, in any order. */
    readonly reminderDaysBefore: readonly number[];
    /**
     * The lead times reminders of this end were told for — delivered, to
     * somebody or to nobody — whatever the file named when they were. One
     * recorded and not delivered was not told.
     */
    readonly toldDaysBefore: readonly number[];
    /** The installation's day the run is deciding on, `dayInZone(now, installationZoneOf(…))`. */
    readonly today: CalendarDay;
}

/**
 * The lead time to remind the end of today, or null where none is due.
 *
 * Due is a lead time whose day — `deletesOn` less that many days — has come;
 * the one reminded of is the smallest that is due, and only where no reminder
 * was told for it or for a smaller one. Lead times the file no longer names
 * still cover: a reminder told at 7 days covers a 10-day lead time added
 * since, and a new 5-day one is still reminded of on its day. Nothing is due
 * from `deletesOn` on.
 */
export function deletionReminderDue(question: DeletionReminderQuestion): number | null {
    const { deletesOn, reminderDaysBefore, toldDaysBefore, today } = question;
    // A lead time's day has come once no more days are left than it names.
    // Counting the days left rather than the lead day itself keeps a lead time
    // longer than the calendar reaches back an ordinary, long-due one.
    const daysLeft = calendarDaysBetween(today, deletesOn);
    if (daysLeft <= 0) return null;
    const due = reminderDaysBefore.filter((daysBefore) => daysBefore >= daysLeft);
    if (due.length === 0) return null;
    const smallest = Math.min(...due);
    return toldDaysBefore.some((told) => told <= smallest) ? null : smallest;
}
