// The days a tenant is shown, handed out beside the moments they are days of.
//
// A moment is the same everywhere; the day it falls on is not, and neither is
// the last day of what it ends. Whoever writes a moment as a day has to know
// the installation's zone, and a page embedded in somebody else's application
// does not — nor does that application's own screen built from the same
// answer. So the server, which knows the zone, puts the days beside the moment
// (`daysAround`), and everybody else writes them as they are.
//
// The name follows the moment's: `startedAt` gains `startedDays`, a moment
// without the suffix, such as `currentPeriodEnd`, gains `currentPeriodEndDays`.

import { daysAround, type DaysAround } from './zoned-day.js';

/** The name the days of the moment `Key` stand under. */
export type DaysKeyOf<Key extends string> = Key extends `${infer Base}At`
    ? `${Base}Days`
    : `${Key}Days`;

/** A moment as an answer carries it: a date, or its ISO 8601 text once written out. */
type Moment = Date | string;

/** The days beside a moment that may be absent: absent with it. */
type DaysOf<Value> = Value extends Moment ? DaysAround : null;

/** `T` with the days of each moment `Keys` names beside it. */
export type WithDays<T, Keys extends keyof T & string> = T & {
    [Key in Keys as DaysKeyOf<Key>]: DaysOf<T[Key]>;
};

/** The name the days of the moment `key` stand under. */
export function daysKeyOf<Key extends string>(key: Key): DaysKeyOf<Key> {
    const base = key.endsWith('At') ? key.slice(0, -'At'.length) : key;
    // SAFETY: `base` is `key` without a trailing `At` exactly where
    // `DaysKeyOf` strips one, and `Days` is appended in both.
    return `${base}Days` as DaysKeyOf<Key>;
}

/**
 * `value` with the days of each moment `keys` names beside it, read in
 * `timeZone`; a moment that is absent has no days. A key whose value is
 * neither a date nor an ISO 8601 moment is refused: naming it is a mistake the
 * types let through only where the field is typed loosely.
 */
export function withDays<T extends object, Keys extends keyof T & string>(
    value: T,
    keys: readonly Keys[],
    timeZone: string,
): WithDays<T, Keys> {
    const days: Record<string, DaysAround | null> = {};
    for (const key of keys) {
        days[daysKeyOf(key)] = daysOfMoment(value[key], key, timeZone);
    }
    // SAFETY: `days` holds, for every key in `keys`, the entry `WithDays`
    // names — `DaysAround` beside a moment, `null` beside an absent one —
    // and `value` is spread as it is.
    return { ...value, ...days } as WithDays<T, Keys>;
}

function daysOfMoment(moment: unknown, key: string, timeZone: string): DaysAround | null {
    if (moment === null || moment === undefined) return null;
    const at = moment instanceof Date ? moment : new Date(String(moment));
    if (Number.isNaN(at.getTime())) {
        throw new TypeError(`${key} is not a moment, so it has no days.`);
    }
    return daysAround(at, timeZone);
}
