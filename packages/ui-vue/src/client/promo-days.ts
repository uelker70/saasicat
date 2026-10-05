// The days of a promo code, read in the zone the application names for them
// (`SC-PROMO-031`).
//
// A consumer's server turns the day an operator picks into an instant — the
// start or the end of that day, in a zone of its own — and the administration
// has to read that instant back as the same day, or a code saved without a
// change would move. The zone is the application's to name
// (`createSuperAdminApp({ promoCodes: { timeZone } })`); without one it is UTC,
// at whose midnight the platform's own promo-code routes store a day. The
// browser's zone is never used: an operator abroad reads the day an operator at
// home reads. Framework-free, so it is tested without a browser.

import { attachCause } from './attach-cause.js';

/** The zone promo days are read in where the application names none. */
export const DEFAULT_PROMO_DAY_ZONE = 'UTC';

/**
 * The zone promo days are read in: `named`, where it is one this runtime can
 * read, or UTC where none is named. A name it cannot read is refused here, at
 * start, rather than on the first page that shows a day.
 */
export function promoDayZoneOf(named: string | undefined): string {
    if (named === undefined) return DEFAULT_PROMO_DAY_ZONE;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: named });
    } catch (error) {
        throw attachCause(
            new Error(
                `promoCodes.timeZone '${named}' is not a time zone this browser can read days ` +
                    "in. Name an IANA zone such as 'Europe/Berlin', or leave it out for UTC.",
            ),
            error,
        );
    }
    return named;
}

/** The fields of `moment` in `timeZone`, by part. */
function fieldsIn(moment: Date, timeZone: string, withTime: boolean): Record<string, string> {
    const format = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        ...(withTime
            ? {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hourCycle: 'h23',
                  timeZoneName: 'short',
              }
            : {}),
    });
    return Object.fromEntries(format.formatToParts(moment).map((part) => [part.type, part.value]));
}

/** `iso` as a moment, or null where there is none or it is not a date. */
function momentOf(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const moment = new Date(iso);
    return Number.isNaN(moment.getTime()) ? null : moment;
}

/** The day (`YYYY-MM-DD`) `iso` falls on in `timeZone`; empty where there is none. */
export function promoDayOf(iso: string | null | undefined, timeZone: string): string {
    const moment = momentOf(iso);
    if (!moment) return '';
    const fields = fieldsIn(moment, timeZone, false);
    return `${fields.year}-${fields.month}-${fields.day}`;
}

/**
 * `YYYY-MM-DD HH:mm:ss` of `iso` in `timeZone`, and the zone it is read in, as
 * the runtime abbreviates it (`UTC`, `GMT+2`): a time without its zone reads as
 * the reader's own. Empty where there is none.
 */
export function promoMomentOf(iso: string | null | undefined, timeZone: string): string {
    const moment = momentOf(iso);
    if (!moment) return '';
    const fields = fieldsIn(moment, timeZone, true);
    return (
        `${fields.year}-${fields.month}-${fields.day} ` +
        `${fields.hour}:${fields.minute}:${fields.second} ${fields.timeZoneName}`
    );
}
