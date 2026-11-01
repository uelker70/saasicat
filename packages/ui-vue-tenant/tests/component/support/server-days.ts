// The days the server hands out beside each moment the tenant is shown as a
// day, by the rule the platform applies (`withDays`, `daysAround`). A fixture
// that stands for an answer passes through here, so a test reads the day the
// platform would name rather than one the test made up.

import {
    withDays,
    withUsageDays,
    type CancellationDays,
    type SubscriptionUsageDays,
    type VersionRetiredNotice,
    type WithDays,
} from '@saasicat/core';
import type { UsageSnapshotShape } from '@saasicat/ui-vue';

/** The installation's zone in these tests: one that is not UTC, so the two can differ. */
export const ZONE = 'Europe/Berlin';

/** `value` as the server answers it: with the days of each moment `moments` names. */
export function answered<T extends object, Moments extends keyof T & string>(
    value: T,
    moments: readonly Moments[],
): WithDays<T, Moments> {
    return withDays(value, moments, ZONE);
}

/** A subscription's account as the server reads it, before it names the days of its moments. */
export type UsageAsRead = Omit<
    UsageSnapshotShape,
    keyof SubscriptionUsageDays | 'packageSnapshotCapturedDays' | 'cancellation' | 'retirement'
> & {
    cancellation: Omit<UsageSnapshotShape['cancellation'], keyof CancellationDays>;
    retirement: VersionRetiredNotice | null;
};

/** That account as `GET /billing/usage` answers it, with the days of each moment (`withUsageDays`). */
export function answeredUsage(usage: UsageAsRead): UsageSnapshotShape {
    return withUsageDays(usage, ZONE);
}
