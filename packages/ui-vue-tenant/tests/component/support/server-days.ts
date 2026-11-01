// The days the server hands out beside each moment the tenant is shown as a
// day, by the rule the platform applies (`withDays`, `daysAround`). A fixture
// that stands for an answer passes through here, so a test reads the day the
// platform would name rather than one the test made up.

import { withDays, type WithDays } from '@saasicat/core';

/** The installation's zone in these tests: one that is not UTC, so the two can differ. */
export const ZONE = 'Europe/Berlin';

/** `value` as the server answers it: with the days of each moment `moments` names. */
export function answered<T extends object, Moments extends keyof T & string>(
    value: T,
    moments: readonly Moments[],
): WithDays<T, Moments> {
    return withDays(value, moments, ZONE);
}
