// What is kept of a subscription that ended (`SC-CANC-027`).
//
// A subscription ends when its cancellation lands — the tenant's own, one the
// application declared for a trial that ran out unbought, or one the operator
// landed through its own path. The platform learns of it on its next run,
// records the end with the day the tenant's data is deleted on, and holds the
// tenant read-only until then (`SC-ADM-052`).
//
// The deletion day is fixed when the end is recorded. A later change to the
// read-only period in `config/saas.yaml` applies to ends recorded after it and
// moves none already told.

import { addDaysToDay, dayInZone, type CalendarDay } from './zoned-day.js';

/** One subscription's end, as a store reads it back. */
export interface SubscriptionEnd {
    id: string;
    tenantId: string;
    subscriptionId: string;
    /** The moment the cancellation landed. */
    endsAt: Date;
    /** The installation's day the tenant's data is deleted on. */
    deletesOn: CalendarDay;
    /** When the end was recorded, and who recorded it, as the audit log tags an actor, or the run. */
    recordedAt: Date;
    recordedBy: string;
}

/** An end to record: the id is the store's to assign. */
export type NewSubscriptionEnd = Omit<SubscriptionEnd, 'id'>;

/**
 * The day a tenant's data is deleted on: the first day after `readOnlyDays`,
 * counted in `timeZone` from the day the subscription ended at `endsAt` — or
 * from the day its end is recorded at `recordedAt`, where that is later.
 *
 * Counting from the later day keeps an end the platform learns of late from
 * being given less than the period's notice: one that landed before the
 * release that records ends, or while the run did not run. An end recorded on
 * its own day, as the run records it, counts from that day either way.
 */
export function deletionDayOf(
    endsAt: Date,
    recordedAt: Date,
    readOnlyDays: number,
    timeZone: string,
): CalendarDay {
    const ended = dayInZone(endsAt, timeZone);
    const recorded = dayInZone(recordedAt, timeZone);
    // Days are `YYYY-MM-DD`, so the later one is also the larger text.
    return addDaysToDay(recorded > ended ? recorded : ended, readOnlyDays);
}
