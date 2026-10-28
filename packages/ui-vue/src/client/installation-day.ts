// The days the administration shows (`SC-ADM-048`). Every value shown as a
// day is one of three things, and each has its own way here:
//
// - a moment something happened — an attempt sent, a credit opened, a contract
//   concluded, a login: the day it falls on in the installation's time zone,
//   which the manifest names. An attempt sent at 00:30 on 2 November in Berlin
//   is on 2 November for an operator in Berlin and one in New York alike,
//   beside days overdue the platform counts in that zone.
// - a moment something ends at — a period, a trial, a minimum term, shown as
//   "ends" or "until": the last day it still covers there, as a contract's last
//   day is. A period that ends at midnight before 1 December ends with
//   30 November.
// - a day somebody picked in a date field and stored as that day's UTC
//   midnight — a version's validity, which the platform stores, a pilot's end,
//   which the application's pilot routes store (`PilotRow`): that day, in
//   every zone.
//
// A day the platform hands out as a calendar day (`YYYY-MM-DD`) is written as
// it is (`formatDay`). A moment shown with its time of day is another matter:
// it is the reader's, with the zone named (`formatMoment`). And a promo code's
// days are read in the zone their server stores them in, which the application
// names (`promo-days.ts`, `SC-PROMO-031`) and need not be this one.
//
// Framework-free, so it is tested without a browser.

import { dayInZone, type AdminManifest, type CalendarDay } from '@saasicat/core';

import { formatDay } from './i18n/format.js';

/** The zone days are read in where the manifest names none, as the platform reads them then. */
export const DEFAULT_INSTALLATION_ZONE = 'UTC';

/** `YYYY-MM-DD` — the length of the day an ISO moment begins with. */
const ISO_DAY_LENGTH = 10;

/** The installation's time zone as `manifest` names it, UTC where it names none. */
export function installationZoneOf(manifest: Pick<AdminManifest, 'timeZone'> | null): string {
    return manifest?.timeZone ?? DEFAULT_INSTALLATION_ZONE;
}

/** The day the moment `iso` falls on in `timeZone`. */
export function dayOfMoment(iso: string, timeZone: string): CalendarDay {
    return dayInZone(new Date(iso), timeZone);
}

/**
 * The last day an end at `iso` still covers in `timeZone`: an end is the first
 * moment no longer covered, so the day of the moment just before it.
 */
export function lastDayBefore(iso: string, timeZone: string): CalendarDay {
    return dayInZone(new Date(Date.parse(iso) - 1), timeZone);
}

/**
 * The day somebody picked, stored as its UTC midnight: the day an ISO moment
 * begins with. A calendar day is returned as it is.
 */
export function storedDayOf(iso: string): CalendarDay {
    return iso.slice(0, ISO_DAY_LENGTH);
}

/** Today in `timeZone`: what a form offers as today, and the earliest day it accepts as one. */
export function todayIn(timeZone: string, now: Date = new Date()): CalendarDay {
    return dayInZone(now, timeZone);
}

/** `dayOfMoment`, as the reader writes a day; a dash for none. */
export function formatMomentDay(
    iso: string | null | undefined,
    timeZone: string,
    intlLocale: string,
): string {
    return iso ? formatDay(dayOfMoment(iso, timeZone), intlLocale) : '—';
}

/** `lastDayBefore`, as the reader writes a day; a dash for none. */
export function formatLastDayBefore(
    iso: string | null | undefined,
    timeZone: string,
    intlLocale: string,
): string {
    return iso ? formatDay(lastDayBefore(iso, timeZone), intlLocale) : '—';
}

/** `storedDayOf`, as the reader writes a day; a dash for none. */
export function formatStoredDay(iso: string | null | undefined, intlLocale: string): string {
    return iso ? formatDay(storedDayOf(iso), intlLocale) : '—';
}
