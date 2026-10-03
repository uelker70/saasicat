// What the retirement notices on record say: the one place a subscription's
// retirement is read from, by the run that moves it, the journal that charges
// it, the reminder and the tenant's page. The notice is what the subscriber
// was told, so its dates are the ones that hold — and a retirement counts only
// from a notice that reached somebody (`SC-SUB-036`): one recorded and not yet
// delivered sets no date, moves nothing and charges nothing differently.

import type {
    SubscriptionNoticeRecord,
    SubscriptionNoticeRepository,
    VersionRetiredNotice,
} from '@saasicat/core';

import type { RetiredPlanVersion } from './charges/charge-derivation.js';

const KIND = 'version-retired';

/** A retirement notice on record, and whether it reached the subscriber. */
export interface RetirementNoticeOnRecord {
    readonly notice: VersionRetiredNotice;
    readonly told: boolean;
}

/** Whether a notice reached anybody: delivered, to at least one recipient. */
export function reachedSomebody(record: SubscriptionNoticeRecord): boolean {
    return (record.delivery?.recipients.length ?? 0) > 0;
}

/**
 * Every retirement notice on record, with whether it was told.
 *
 * Read in full: a subscription is reached at most once a year, so the notices
 * grow with subscriptions and years, not with runs.
 */
export async function retirementNoticesOnRecord(
    notices: SubscriptionNoticeRepository,
): Promise<RetirementNoticeOnRecord[]> {
    const records = await notices.listOfKindSince(KIND, new Date(0));
    return records.map((record) => ({
        notice: record.content as VersionRetiredNotice,
        told: reachedSomebody(record),
    }));
}

/** Every retirement notice that reached its subscriber, as it was told. */
export async function retirementNoticesTold(
    notices: SubscriptionNoticeRepository,
): Promise<VersionRetiredNotice[]> {
    return (await retirementNoticesOnRecord(notices))
        .filter((onRecord) => onRecord.told)
        .map((onRecord) => onRecord.notice);
}

/** Every retirement notice that reached its subscriber and whose date has come by `now`. */
export async function retirementNoticesDue(
    notices: SubscriptionNoticeRepository,
    now: Date,
): Promise<VersionRetiredNotice[]> {
    return (await retirementNoticesTold(notices)).filter(
        (notice) => new Date(notice.effectiveAt) <= now,
    );
}

/** `notices` by the version they retire, so the subscriptions on each are read once. */
export function groupByRetiredVersion<T extends Pick<VersionRetiredNotice, 'retired'>>(
    notices: readonly T[],
): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const notice of notices) {
        const id = notice.retired.planVersionId;
        groups.set(id, [...(groups.get(id) ?? []), notice]);
    }
    return groups;
}

/**
 * The plan versions a subscription's retirements move it off, each from the
 * date it was told — only where it was: a notice that reached nobody moves
 * nothing, and the version it is on prices its periods as before.
 */
export function retiredVersionsOf(
    records: readonly SubscriptionNoticeRecord[],
): RetiredPlanVersion[] {
    return records
        .filter((record) => record.kind === KIND && reachedSomebody(record))
        .map((record) => record.content as VersionRetiredNotice)
        .map((notice) => ({
            planVersionId: notice.retired.planVersionId,
            from: new Date(notice.effectiveAt),
            retirementId: notice.retirementId,
        }));
}

/**
 * The kinds of notice a retirement tells a subscription with: of the plan
 * version it is on, and of an add-on version it holds.
 */
const RETIREMENT_NOTICE_KINDS = ['version-retired', 'bundle-version-retired'] as const;

/**
 * The subscriptions a retirement reached at or after `since`, plan or add-on
 * alike: a subscription is reached at most once in twelve months, whichever it
 * was told of (`SC-SUB-028`, `SC-BUN-041`). A retirement counts from its
 * notice reaching somebody, as its date does (`SC-SUB-036`), which can be long
 * after the notice was recorded. One whose notice still waits counts from the
 * announcement, so a second retirement is not announced on top of one nobody
 * has been told of yet.
 *
 * Read in full: a notice recorded before `since` may have reached somebody
 * after it.
 */
export async function subscriptionsReachedSince(
    notices: Pick<SubscriptionNoticeRepository, 'listOfKindSince'>,
    since: Date,
): Promise<Set<string>> {
    const reached = new Set<string>();
    for (const kind of RETIREMENT_NOTICE_KINDS) {
        for (const record of await notices.listOfKindSince(kind, new Date(0))) {
            const counted = reachedSomebody(record) ? record.deliveredAt : record.createdAt;
            if (counted !== null && counted >= since) reached.add(record.subscriptionId);
        }
    }
    return reached;
}
