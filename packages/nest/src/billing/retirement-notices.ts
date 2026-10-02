// What the retirement notices on record say: the one place a subscription's
// retirement is read from, by the run that moves it and the journal that
// charges it. The notice is what the subscriber was told, so its dates are the
// ones that hold.

import type {
    SubscriptionNoticeRecord,
    SubscriptionNoticeRepository,
    VersionRetiredNotice,
} from '@saasicat/core';

import type { RetiredPlanVersion } from './charges/charge-derivation.js';

const KIND = 'version-retired';

/**
 * Every retirement notice on record, as it was told.
 *
 * Read in full: a subscription is reached at most once a year, so the notices
 * grow with subscriptions and years, not with runs.
 */
export async function retirementNoticesOnRecord(
    notices: SubscriptionNoticeRepository,
): Promise<VersionRetiredNotice[]> {
    const records = await notices.listOfKindSince(KIND, new Date(0));
    return records.map((record) => record.content as VersionRetiredNotice);
}

/** Every retirement notice whose date has come by `now`. */
export async function retirementNoticesDue(
    notices: SubscriptionNoticeRepository,
    now: Date,
): Promise<VersionRetiredNotice[]> {
    return (await retirementNoticesOnRecord(notices)).filter(
        (notice) => new Date(notice.effectiveAt) <= now,
    );
}

/** The plan versions a subscription's retirements move it off, each from the date it was told. */
export function retiredVersionsOf(
    records: readonly SubscriptionNoticeRecord[],
): RetiredPlanVersion[] {
    return records
        .filter((record) => record.kind === KIND)
        .map((record) => record.content as VersionRetiredNotice)
        .map((notice) => ({
            planVersionId: notice.retired.planVersionId,
            from: new Date(notice.effectiveAt),
            retirementId: notice.retirementId,
        }));
}
