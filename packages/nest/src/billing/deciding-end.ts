// Which end decides when a tenant is deleted (`SC-PRIV-022`).
//
// A tenant can be held to reading by more than one end at once: where the
// reason an end opened is still open when the tenant's next subscription ends,
// that end opens a reason beside it. The end that ended last decides. Its deletion day is the one the tenant was told
// last, its read-only period is the one running, and the export is offered
// for it (`SC-PRIV-024`); a contract concluded between the two ends runs past
// the first and not past the last (`SC-PRIV-026`). Measured against the first,
// the deletion would begin inside the second read-only period, or a contract
// ended by its date would hold the tenant forever.

import type { SubscriptionEnd, TenantAccessHold } from '@saasicat/core';

/** The end that decides a tenant's deletion, with the open reason that names it. */
export interface DecidingEnd {
    readonly end: SubscriptionEnd;
    readonly ended: TenantAccessHold;
}

/**
 * Whether `a` ended after `b`. Two ends of one moment are told apart by the
 * later deletion day, so the run never deletes on the earlier one.
 */
function endedAfter(a: SubscriptionEnd, b: SubscriptionEnd): boolean {
    const byMoment = a.endsAt.getTime() - b.endsAt.getTime();
    if (byMoment !== 0) return byMoment > 0;
    // Days are `YYYY-MM-DD`, so the later day is also the larger text.
    return a.deletesOn > b.deletesOn;
}

/** The end of `ends` that ended last, or undefined where there is none. */
export function lastEndOf(ends: readonly SubscriptionEnd[]): SubscriptionEnd | undefined {
    let last: SubscriptionEnd | undefined;
    for (const end of ends) {
        if (!last || endedAfter(end, last)) last = end;
    }
    return last;
}

/**
 * By tenant, the end that decides its deletion: of the ends in `ends` that
 * the open `ended` reasons among `holds` name, the one that ended last.
 *
 * A tenant one of whose open `ended` reasons names no recorded end has none.
 * The reason is recorded before its end, so between the two its subscription
 * may have ended after every end recorded, and the day it fixes is known only
 * once it is recorded — by the next run that records ends. A reason whose
 * subscription's end is another tenant's decides nothing for this one.
 */
export function decidingEnds(
    holds: readonly TenantAccessHold[],
    ends: readonly SubscriptionEnd[],
): Map<string, DecidingEnd> {
    const bySubscription = new Map(ends.map((end) => [end.subscriptionId, end]));
    const deciding = new Map<string, DecidingEnd>();
    const undecided = new Set<string>();
    for (const ended of holds) {
        if (ended.kind !== 'ended' || ended.liftedAt !== null || ended.reference === null) continue;
        const end = bySubscription.get(ended.reference);
        if (!end) {
            undecided.add(ended.tenantId);
            continue;
        }
        if (end.tenantId !== ended.tenantId) continue;
        const before = deciding.get(ended.tenantId);
        if (!before || endedAfter(end, before.end)) deciding.set(ended.tenantId, { end, ended });
    }
    for (const tenantId of undecided) deciding.delete(tenantId);
    return deciding;
}
