// Calendar days in the installation's time zone.
//
// An instant is the same everywhere; the day it falls on is not. An invoice
// issued half an hour after midnight on 1 January in Berlin belongs to the new
// year, while the server's clock, in UTC, still reads 31 December — and the
// year decides its number, the day decides its date, its due date and the
// tax period it reports in (`SC-PRIC-045`). So every day an invoice states is
// read in the zone `config/saas.yaml` names, never in the host's.
//
// A day is the text `YYYY-MM-DD`: it sorts as it reads, a database `date`
// column takes it as it is, and nothing about it suggests a time of day.

/** A calendar day, `YYYY-MM-DD`. */
export type CalendarDay = string;

/** The shape of a calendar day, `YYYY-MM-DD`; whether the calendar has it is a second question. */
export const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MS_PER_HOUR = 3_600_000;
/**
 * How far before its UTC midnight a day may begin somewhere, and how far after:
 * zones run from fourteen hours ahead of UTC to twelve behind it, so the first
 * moment of any day lies inside this margin around its UTC midnight.
 */
const EARLIEST_START_MS = 15 * MS_PER_HOUR;
const LATEST_START_MS = 13 * MS_PER_HOUR;

/**
 * The day `at` falls on in `timeZone`. Throws a `RangeError` for a zone the
 * runtime does not know, and for no zone at all — without one `Intl` would
 * read the host's, and the day would depend on the machine.
 */
export function dayInZone(at: Date, timeZone: string): CalendarDay {
    if (typeof timeZone !== 'string' || timeZone === '') {
        throw new RangeError('A day is read in a named time zone.');
    }
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(at);
    const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The last day a period covers in `timeZone`. A period ends before `until`, so
 * its last moment is one millisecond earlier: a month from 1 October to
 * 1 November covers 31 October as its last day.
 */
export function lastDayInZone(period: { from: Date; until: Date }, timeZone: string): CalendarDay {
    if (!(period.until.getTime() > period.from.getTime())) {
        throw new RangeError('A period ends after it begins.');
    }
    return dayInZone(new Date(period.until.getTime() - 1), timeZone);
}

/**
 * The first moment of `day` in `timeZone`: its midnight there, or, in a zone
 * whose clocks skip midnight for daylight saving time, the first moment the
 * day has. A day is the moments from this one to the next day's, so whether a
 * moment falls on it is two comparisons a store can make.
 */
export function startOfDayInZone(day: CalendarDay, timeZone: string): Date {
    const [year, month, date] = day.split('-').map(Number);
    const midnight = Date.UTC(year ?? NaN, (month ?? NaN) - 1, date ?? NaN);
    if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) {
        throw new RangeError(`${day} is not a day.`);
    }
    // The moments before `low` fall on an earlier day and those from `high`
    // on this one or a later; the first of this day is found between them.
    let low = midnight - EARLIEST_START_MS;
    let high = midnight + LATEST_START_MS;
    while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (dayInZone(new Date(middle), timeZone) < day) low = middle;
        else high = middle;
    }
    return new Date(high);
}

/** The day `days` calendar days after `day`; months and years roll over as the calendar does. */
export function addDaysToDay(day: CalendarDay, days: number): CalendarDay {
    if (!Number.isInteger(days)) throw new RangeError('Days are counted in whole days.');
    const [year, month, date] = day.split('-').map(Number);
    if (!year || !month || !date) throw new RangeError(`${day} is not a day.`);
    const moved = new Date(Date.UTC(year, month - 1, date + days));
    return moved.toISOString().slice(0, 10);
}

/** The year a day belongs to. */
export function yearOfDay(day: CalendarDay): number {
    return Number(day.slice(0, 4));
}
