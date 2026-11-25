// Whether a tenant whose subscription ended can come back (`SC-CANC-034`):
// take out a new subscription on the same subscription row, which lifts the
// end, its deletion day and the read-only state that end put it in.
//
// Decided here once, for the three that ask: the access check that lets the
// request through a read-only tenant, the tenant's view that offers it, and the
// service that writes it — the last asks again in its transaction, after it
// locked the end's reason against a deletion beginning beside it. The order is
// the strictness of what refuses: a deletion that has begun holds the tenant
// for good; a suspension is the operator's to lift, and comes before the
// read-only period it would otherwise leave; without a recorded end there is
// nothing to come back from; and from the deletion day on, in the
// installation's days, the way back is a new tenant, even where the deletion
// is held on that day. An invoice still overdue refuses nothing: it keeps the
// tenant read-only once it is back, until it is paid.

import type { SubscriptionEnd } from './subscription-end.types.js';
import type { TenantAccessHold } from './tenant-access.types.js';
import { deletionDayHasCome } from './tenant-deletion-status.js';
import { dayInZone } from './zoned-day.js';

/** Why a tenant cannot take out a new subscription now. */
export type SubscriptionReturnRefusal =
    /** An open `deleting` reason: its deletion has begun. */
    | 'deletion-begun'
    /** An open suspension, which only the operator lifts. */
    | 'suspended'
    /** No open `ended` reason, or no end recorded for it yet. */
    | 'not-ended'
    /** The installation's day has reached the deletion day the end names. */
    | 'deletion-day-reached';

/** What decides whether a tenant can come back. */
export interface SubscriptionReturnInput {
    /** The tenant's reasons; only the open ones count. */
    readonly holds: readonly TenantAccessHold[];
    /** The recorded end of the subscription the open `ended` reason names; null where none is. */
    readonly end: Pick<SubscriptionEnd, 'deletesOn'> | null;
    readonly now: Date;
    /** The installation's zone, which decides the day it is at `now`. */
    readonly timeZone: string;
}

/**
 * The open `ended` reason among `holds`, the one a return lifts; null where
 * none is open. A tenant has one subscription, so at most one is.
 */
export function openEndedHoldOf(holds: readonly TenantAccessHold[]): TenantAccessHold | null {
    return holds.find((hold) => hold.kind === 'ended' && hold.liftedAt === null) ?? null;
}

/** Why the tenant cannot come back now; null where it can. */
export function subscriptionReturnRefusal(
    input: SubscriptionReturnInput,
): SubscriptionReturnRefusal | null {
    const open = input.holds.filter((hold) => hold.liftedAt === null);
    if (open.some((hold) => hold.kind === 'deleting')) return 'deletion-begun';
    if (open.some((hold) => hold.kind === 'suspended')) return 'suspended';
    if (!openEndedHoldOf(open) || !input.end) return 'not-ended';
    if (deletionDayHasCome(input.end, dayInZone(input.now, input.timeZone))) {
        return 'deletion-day-reached';
    }
    return null;
}
