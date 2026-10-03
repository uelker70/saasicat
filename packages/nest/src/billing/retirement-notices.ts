// What the retirement notices on record say: the one place a subscription's
// retirement is read from, by the run that moves it, the journal that charges
// it, the reminder and the tenant's page. The notice is what the subscriber
// was told, so its dates are the ones that hold — and a retirement counts only
// from a notice that reached somebody (`SC-SUB-038`): one recorded and not yet
// delivered sets no date, moves nothing and charges nothing differently.

import type {
    SubscriptionNoticeRecord,
    SubscriptionNoticeRepository,
    VersionRetiredNotice,
} from '@saasicat/core';

import type { RetiredPlanVersion } from './charges/charge-derivation.js';
import { RETIREMENT_REPEAT_MONTHS, calendarMonthsAfter } from './retirement-reach.js';

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

/** The retirement notices among `records` that reached their subscriber, as they were told. */
export function toldRetirementNotices(
    records: readonly SubscriptionNoticeRecord[],
): VersionRetiredNotice[] {
    return records
        .filter((record) => record.kind === KIND && reachedSomebody(record))
        .map((record) => record.content as VersionRetiredNotice);
}

/**
 * Of the retirements `told`, those of the version `subscription` is on: until
 * it has moved off that version, each still sets the plan it moves to.
 */
export function retirementsOfItsVersion(
    told: readonly VersionRetiredNotice[],
    subscription: { readonly id?: string; readonly planVersion?: { readonly id: string } | null },
): VersionRetiredNotice[] {
    const bound = subscription.planVersion?.id;
    if (!subscription.id || !bound) return [];
    return told.filter(
        (notice) =>
            notice.subscriptionId === subscription.id && notice.retired.planVersionId === bound,
    );
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
    return toldRetirementNotices(records).map((notice) => ({
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

/** Whether `record` is a retirement notice that reached somebody at or after `since`. */
function toldSince(record: SubscriptionNoticeRecord, since: Date): boolean {
    return (
        (RETIREMENT_NOTICE_KINDS as readonly string[]).includes(record.kind) &&
        reachedSomebody(record) &&
        record.deliveredAt !== null &&
        record.deliveredAt >= since
    );
}

/**
 * The subscriptions told of a retirement at or after `since`, plan or add-on
 * alike: a subscription is reached at most once in twelve months, whichever it
 * was told of (`SC-SUB-028`, `SC-BUN-041`). A retirement counts from its
 * notice reaching somebody, as its date does (`SC-SUB-038`), which can be long
 * after the notice was recorded. A notice still waiting holds nothing back: one
 * that is never sent — its booking or subscription left before it could be —
 * would otherwise hold back every retirement the subscription meets for a
 * year. It is held back itself when it finally goes out
 * (`toldOfAnotherRetirementWithinAYear`).
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
            if (toldSince(record, since)) reached.add(record.subscriptionId);
        }
    }
    return reached;
}

/**
 * Whether the subscription was told of a retirement other than the one about
 * `subject` within the twelve months before `at`. A waiting notice is not sent
 * while it was: the subscriber hears of one retirement in twelve months, and
 * this one waits until those are over, its date counting from when it goes out.
 */
export async function toldOfAnotherRetirementWithinAYear(
    notices: Pick<SubscriptionNoticeRepository, 'listForSubscription'>,
    subscriptionId: string,
    subject: string,
    at: Date,
): Promise<boolean> {
    const since = calendarMonthsAfter(at, -RETIREMENT_REPEAT_MONTHS);
    return (await notices.listForSubscription(subscriptionId)).some(
        (record) => record.subject !== subject && toldSince(record, since),
    );
}
