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

/**
 * The shape of a calendar day, `YYYY-MM-DD`, from the year 1000 on, as a month
 * is (`CALENDAR_MONTH_PATTERN`); whether the calendar has it is a second
 * question. A year of fewer digits is one a date field shows while it is being
 * typed, not a day somebody means.
 */
export const CALENDAR_DAY_PATTERN = /^[1-9]\d{3}-\d{2}-\d{2}$/;

const MS_PER_HOUR = 3_600_000;
/**
 * How far before the same reading in UTC a clock somewhere shows a time, and
 * how far after: zones run from fourteen hours ahead of UTC to twelve behind
 * it, so every moment that shows a time — the first of a day among them — lies
 * inside this margin around the moment UTC shows it.
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
    // `Intl` writes a year below 1000 with fewer digits, which would sort a
    // day of it after one of the year 1000.
    return `${(part('year') ?? '').padStart(4, '0')}-${part('month')}-${part('day')}`;
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
 * A day and a time of day as a clock in some zone shows them,
 * `YYYY-MM-DDTHH:MM:SS`; it sorts as it reads, as a day does.
 */
export type LocalMoment = string;

/**
 * The shape of a local moment from the year 1000 on, from 00:00 to 23:59:59; the
 * seconds may be left out. Whether the calendar has its day is `isLocalMoment`'s
 * second question.
 */
export const LOCAL_MOMENT_PATTERN =
    /^[1-9]\d{3}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

/** `local` with its seconds, where it left them out. */
const withSeconds = (local: LocalMoment): string => (local.length === 16 ? `${local}:00` : local);

/** Whether `text` is a local moment whose day the calendar has: 30 February is none. */
export function isLocalMoment(text: string): boolean {
    if (!LOCAL_MOMENT_PATTERN.test(text)) return false;
    const stamp = withSeconds(text);
    const naive = Date.parse(`${stamp}Z`);
    return Number.isFinite(naive) && new Date(naive).toISOString().slice(0, 19) === stamp;
}

/** What a clock in `timeZone` shows at `at`, to the second. */
export function localMomentInZone(at: Date, timeZone: string): LocalMoment {
    if (typeof timeZone !== 'string' || timeZone === '') {
        throw new RangeError('A moment is read in a named time zone.');
    }
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(at);
    const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value;
    const day = `${(part('year') ?? '').padStart(4, '0')}-${part('month')}-${part('day')}`;
    return `${day}T${part('hour')}:${part('minute')}:${part('second')}`;
}

/**
 * How far a clock in `timeZone` is ahead of UTC at `at`, a whole second: a
 * reading names the second, so that is where it is compared.
 */
function offsetInZone(at: number, timeZone: string): number {
    return Date.parse(`${localMomentInZone(new Date(at), timeZone)}Z`) - at;
}

/**
 * The first moment a clock in `timeZone` shows `local` or later: that moment
 * where the clock shows it once, the first of the two where daylight saving
 * time shows it twice, and the moment the clock jumps to where it skips it.
 */
export function firstMomentInZone(local: LocalMoment, timeZone: string): Date {
    if (!isLocalMoment(local)) throw new RangeError(`${local} is not a day and a time.`);
    const stamp = withSeconds(local);
    const naive = Date.parse(`${stamp}Z`);
    // A clock shows `stamp` at `naive` less its offset then. The offset it has
    // before every moment that can show `stamp` gives the earliest of them:
    // where the clock goes back, a time it shows twice is shown first under the
    // offset from before, and its readings fall back in between, so no search
    // over them could find the first.
    const before = naive - offsetInZone(naive - EARLIEST_START_MS, timeZone);
    if (localMomentInZone(new Date(before), timeZone) === stamp) return new Date(before);
    // Shown only after the clock changed, or skipped: then every reading before
    // the first moment that shows it, or that the clock jumps to, is an earlier
    // time and every reading from it this one or a later, so the moments before
    // `low` show an earlier time, those from `high` this one or a later, and the
    // first of those is found between.
    let low = naive - EARLIEST_START_MS;
    let high = naive + LATEST_START_MS;
    while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (localMomentInZone(new Date(middle), timeZone) < stamp) low = middle;
        else high = middle;
    }
    return new Date(high);
}

/**
 * The first moment of `day` in `timeZone`: its midnight there, or, in a zone
 * whose clocks skip midnight for daylight saving time, the first moment the
 * day has. A day is the moments from this one to the next day's, so whether a
 * moment falls on it is two comparisons a store can make.
 */
export function startOfDayInZone(day: CalendarDay, timeZone: string): Date {
    const midnight = Date.parse(`${day}T00:00:00Z`);
    if (!CALENDAR_DAY_PATTERN.test(day) || !Number.isFinite(midnight)) {
        throw new RangeError(`${day} is not a day.`);
    }
    if (new Date(midnight).toISOString().slice(0, 10) !== day) {
        throw new RangeError(`${day} is not a day.`);
    }
    return firstMomentInZone(`${day}T00:00:00`, timeZone);
}

/** The day `days` calendar days after `day`; months and years roll over as the calendar does. */
export function addDaysToDay(day: CalendarDay, days: number): CalendarDay {
    if (!Number.isInteger(days)) throw new RangeError('Days are counted in whole days.');
    const [year, month, date] = day.split('-').map(Number);
    if (!year || !month || !date) throw new RangeError(`${day} is not a day.`);
    const moved = new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
    // Past 9999-12-31 the ISO text grows a sign and a fifth digit; that is no day.
    if (!CALENDAR_DAY_PATTERN.test(moved)) {
        throw new RangeError(`${days} days after ${day} is past the days a calendar day names.`);
    }
    return moved;
}

/** The year a day belongs to. */
export function yearOfDay(day: CalendarDay): number {
    return Number(day.slice(0, 4));
}
