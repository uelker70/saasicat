// What is kept of a subscription that ended (`SC-CANC-027`).
//
// A subscription ends when its cancellation lands — the tenant's own, one the
// application declared for a trial that ran out unbought, or one the operator
// landed through its own path. The platform learns of it on its next run,
// records the end with the day the tenant's data is deleted on, and holds the
// tenant read-only until then (`SC-ADM-055`).
//
// The deletion day is fixed when the end is recorded. Where the tenant was
// told a day when it confirmed its cancellation, or ended its subscription at
// once — an announcement, kept apart from the end because the end has not
// been recorded yet — the end is recorded with that day, provided it landed
// no later than the end announced (`endKeepsAnnouncedDay`); otherwise, and
// where it was told none, the day is counted when the end is recorded. A later
// change to the read-only period in `config/saas.yaml` applies to ends
// recorded or announced after it and moves none already told.

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

/** What a tenant is told before it ends its subscription. */
export interface AnnouncedDeletion {
    /** The read-only period, in days, the days below were counted with. */
    readOnlyDays: number;
    /** The last day the tenant can still read on: the day before `deletesOn`. */
    readOnlyUntil: CalendarDay;
    /** The installation's day the tenant's data is deleted on. */
    deletesOn: CalendarDay;
}

/**
 * The day a tenant was told when it confirmed the end of its subscription, as
 * a store reads it back. One per subscription, kept beside the end that is
 * later recorded with its day; it does not itself mean the subscription ended.
 */
export interface SubscriptionEndAnnouncement {
    id: string;
    tenantId: string;
    subscriptionId: string;
    /** The moment the cancellation was to land when it was confirmed. */
    endsAt: Date;
    /** The read-only period the day was counted with. */
    readOnlyDays: number;
    /** The installation's day the tenant's data is deleted on. */
    deletesOn: CalendarDay;
    /** When the cancellation was confirmed, and who confirmed it, as the audit log tags an actor. */
    announcedAt: Date;
    announcedBy: string;
}

/** An announcement to record: the id is the store's to assign. */
export type NewSubscriptionEndAnnouncement = Omit<SubscriptionEndAnnouncement, 'id'>;

/**
 * What cancelling so that the subscription ends at `endsAt`, confirmed at
 * `announcedAt`, announces: the deletion day `deletionDayOf` counts, and the
 * day before it as the last one the tenant can still read on.
 *
 * Counted as an end recorded at `announcedAt` would be, so a confirmation
 * given after the moment it lands — a cancellation effective at once — still
 * leaves the whole period from the day it is confirmed.
 */
export function deletionAnnouncedFor(
    endsAt: Date,
    announcedAt: Date,
    readOnlyDays: number,
    timeZone: string,
): AnnouncedDeletion {
    return announcedDeletionOf({
        readOnlyDays,
        deletesOn: deletionDayOf(endsAt, announcedAt, readOnlyDays, timeZone),
    });
}

/**
 * Whether an end landing at `endsAt` is recorded with the day `announcement`
 * told: where it landed at or before the end announced — earlier is a
 * subscription ended at once, and keeps its day. One that landed later is an
 * end the announcement was not made for, and gets the day counted from the
 * period, as one told none: the announced day could give less than the
 * read-only period, or come before the end itself.
 */
export function endKeepsAnnouncedDay(
    announcement: Pick<SubscriptionEndAnnouncement, 'endsAt'>,
    endsAt: Date,
): boolean {
    return endsAt.getTime() <= announcement.endsAt.getTime();
}

/**
 * What a tenant was told, read back from what was recorded of it: the period
 * and the deletion day as they were counted, and the day before that day as
 * the last one it can still read on.
 */
export function announcedDeletionOf(
    announced: Pick<SubscriptionEndAnnouncement, 'readOnlyDays' | 'deletesOn'>,
): AnnouncedDeletion {
    return {
        readOnlyDays: announced.readOnlyDays,
        readOnlyUntil: addDaysToDay(announced.deletesOn, -1),
        deletesOn: announced.deletesOn,
    };
}

/**
 * One download of a tenant's export, taken after its subscription ended, as a
 * store reads it back — kept beside the end it was offered for, and the
 * tenant's acknowledgement that `SC-PRIV-017` names.
 *
 * It is written once the application has handed the export over and before
 * the file is sent, so it shows that the application produced the export at
 * that moment, `size` bytes of it, for the tenant's administrator whom
 * `downloadedByUserId` and `downloadedBy` name. It cannot show that the browser
 * saved the file. Every download is its own record: two downloads are two rows,
 * neither replacing the other.
 */
export interface TenantExportDownload {
    id: string;
    tenantId: string;
    /** The subscription whose end the export was offered for. */
    subscriptionId: string;
    /** When the export was handed out. */
    downloadedAt: Date;
    /**
     * Who took it, as the audit log tags an actor: `web:<email>:<context>`.
     * Its email reads `unknown` where the session carries none, and its
     * context is the application's, so it is read beside `downloadedByUserId`.
     */
    downloadedBy: string;
    /** The id of the user who took it, as the session the platform authenticated names them. */
    downloadedByUserId: string;
    /** The size of the file handed out, in bytes; never 0, since an empty export is refused. */
    size: number;
}

/** A download to record: the id is the store's to assign. */
export type NewTenantExportDownload = Omit<TenantExportDownload, 'id'>;
