// The days of what a tenant's plan answers carry, in the installation's zone
// (`SC-UI-028`): beside each moment of the subscription, of the cancellation
// the account projects and of a retirement on its way, the days a page writes
// it as — so the tenant's page and an application's own screen built from the
// same answer name the same day.
//
// One function, because the server applies it and whatever stands for the
// server's answer — a test's fixture — has to name the same days by the same
// rule rather than by one it made up.

import { withDays, type WithDays } from './days-beside-moments.js';
import type { AnnouncedDeletion } from './subscription-end.types.js';
import { SUBSCRIPTION_USAGE_MOMENTS, type SubscriptionUsageDays } from './subscription.types.js';
import type {
    VersionRetiredNotice,
    VersionRetiredNoticeWithDays,
} from './version-retirement.types.js';
import { daysAround, pickedDayOf, type DaysAround } from './zoned-day.js';

/** A moment as an answer carries it: a date, or its ISO 8601 text once written out. */
type Moment = Date | string;

/** The moments of what cancelling now would do. */
export const CANCELLATION_MOMENTS = ['effectiveAt', 'termEndsAt', 'noticeDeadline'] as const;

/** The moments of what a declared cancellation answers. */
export const CANCELLATION_RESULT_MOMENTS = [
    'canceledAt',
    'canceledEffectiveAt',
    'termEndsAt',
    'noticeDeadline',
] as const;

/** The moments of what cancelling now would do, as an answer carries them. */
export interface CancellationMoments {
    effectiveAt: Moment;
    termEndsAt: Moment;
    noticeDeadline: Moment | null;
    /**
     * The deletion day confirming now leaves on record, and the day a
     * confirmation is held to: once a cancellation is declared, the day it was
     * told or the one a repeat records, and null once it has landed. Days
     * already, so it is carried as it is.
     */
    deletion?: AnnouncedDeletion | null;
}

/** What `withUsageDays` reads the days of. */
export type UsageMoments = {
    [Key in (typeof SUBSCRIPTION_USAGE_MOMENTS)[number] | 'pilotEndsAt']: Moment | null;
} & {
    cancellation: CancellationMoments;
    retirement: VersionRetiredNotice | null;
    packageSnapshot: unknown;
    /**
     * What the tenant was told of its deletion when it confirmed its
     * cancellation. Days already, so it is carried as it is.
     */
    announcedDeletion?: AnnouncedDeletion | null;
};

/** The days of what cancelling now would do. */
export type CancellationDays = Omit<
    WithDays<CancellationMoments, (typeof CANCELLATION_MOMENTS)[number]>,
    keyof CancellationMoments
>;

/** `T` with the days `withUsageDays` puts beside its moments. */
export type WithUsageDays<T extends UsageMoments> = T &
    SubscriptionUsageDays & {
        cancellation: T['cancellation'] & CancellationDays;
        retirement: VersionRetiredNoticeWithDays | null;
        /** The days of when the package snapshot was captured; null without one. */
        packageSnapshotCapturedDays: DaysAround | null;
    };

/**
 * `answer` — what `GET /billing/usage` answers — with the days of each moment
 * it carries, read in `timeZone`.
 */
export function withUsageDays<T extends UsageMoments>(
    answer: T,
    timeZone: string,
): WithUsageDays<T> {
    const { effectiveDays, termEndsDays, noticeDeadlineDays } = withDays(
        answer.cancellation,
        CANCELLATION_MOMENTS,
        timeZone,
    );
    return {
        ...withDays(answer, SUBSCRIPTION_USAGE_MOMENTS, timeZone),
        pilotEndsDay: answer.pilotEndsAt ? pickedDayOf(new Date(answer.pilotEndsAt)) : null,
        cancellation: { ...answer.cancellation, effectiveDays, termEndsDays, noticeDeadlineDays },
        retirement: answer.retirement && withDays(answer.retirement, ['effectiveAt'], timeZone),
        packageSnapshotCapturedDays: capturedDaysOf(answer.packageSnapshot, timeZone),
    };
}

/**
 * The days of the moment a package snapshot was captured. The snapshot is the
 * offer's JSON as it was frozen, so a moment it does not carry, or carries as
 * something other than a moment, has no days rather than failing the read.
 */
function capturedDaysOf(snapshot: unknown, timeZone: string): DaysAround | null {
    if (typeof snapshot !== 'object' || snapshot === null || !('capturedAt' in snapshot)) {
        return null;
    }
    const { capturedAt } = snapshot;
    if (typeof capturedAt !== 'string') return null;
    const at = new Date(capturedAt);
    return Number.isNaN(at.getTime()) ? null : daysAround(at, timeZone);
}
