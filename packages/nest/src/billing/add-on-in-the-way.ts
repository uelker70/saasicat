import type { SubscriptionBundleRecord, SubscriptionUsageRecord } from '@saasicat/core';

import type { ContinuesOn, HeldAddOnMisfit } from './add-on-fits-plan.js';
import { resolveBundleCancelEffectiveAt } from './subscription-bundles.service.js';

/** What of the subscription decides when one of its bookings can end. */
type Parent = Pick<
    SubscriptionUsageRecord,
    'currentPeriodEnd' | 'canceledAt' | 'canceledEffectiveAt'
>;

/**
 * How a refusal names a booking that stands in the way of a move, read at
 * `now`: the add-on's name, and the earliest day the booking can end. Where
 * the version booked cannot be read, its id stands in for the name. A booking
 * told that its version is being retired may be cancelled without its minimum
 * term until the retirement's date (`SC-BUN-045`), so the term does not count
 * then — whichever version is in the way; a switch the booking took for the
 * end of its term lifts nothing. Where a version it continues on from a later
 * date is the one in the way, that version and its date (`continuesOn`) — but
 * only while the date is ahead and the booking is not cancelled yet, since
 * only then does cancelling end it by the date. Past the date a cancellation
 * lands after it, and a cancelled booking cannot be cancelled again: both are
 * told the day they can end instead.
 */
export function addOnInTheWay(
    held: HeldAddOnMisfit,
    sub: Parent,
    now: Date,
): { bundleName: string; until: string; continuesOn: ContinuesOn | null } {
    const termLapses = Boolean(held.retirement && new Date(held.retirement.effectiveAt) > now);
    const until = earliestEndOf(
        termLapses ? { ...held.booking, minimumTermEndsAt: null } : held.booking,
        {
            now,
            planPeriodEnd: sub.currentPeriodEnd,
            parentEndsAt: sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
        },
    );
    const cancellingHelps =
        held.ahead && new Date(held.ahead.effectiveAt) > now && held.booking.canceledAt === null;
    const continuesOn =
        cancellingHelps && held.ahead && held.version
            ? { version: held.version.version, from: held.ahead.effectiveAt.slice(0, 10) }
            : null;
    return {
        bundleName: held.version?.label ?? held.booking.bundleVersionId,
        until: until.toISOString().slice(0, 10),
        continuesOn,
    };
}

/**
 * The earliest day a running booking can end: where its cancellation is
 * declared, the day that lands; otherwise the day a cancellation declared
 * `now` would land, as the cancel route computes it. Never past the end of the
 * subscription it hangs off. A booking from before bundles had periods ends
 * with the plan's period, as the cancellation reads it.
 */
function earliestEndOf(
    booking: Pick<
        SubscriptionBundleRecord,
        'canceledEffectiveAt' | 'currentPeriodEnd' | 'minimumTermEndsAt'
    >,
    at: { now: Date; planPeriodEnd: Date | null; parentEndsAt: Date | null },
): Date {
    const ends =
        booking.canceledEffectiveAt ??
        resolveBundleCancelEffectiveAt({
            canceledAt: at.now,
            currentPeriodEnd: booking.currentPeriodEnd ?? at.planPeriodEnd,
            minimumTermEndsAt: booking.minimumTermEndsAt,
            parentEndsAt: at.parentEndsAt,
        });
    return at.parentEndsAt !== null && at.parentEndsAt < ends ? at.parentEndsAt : ends;
}
