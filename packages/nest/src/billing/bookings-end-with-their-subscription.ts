// The add-ons of a subscription end with it. A booking is a junction of its
// own, cancelled or not on its own, and nothing about a subscription's end
// writes it; left running, it would come back with the next subscription on
// the same row — a return, a checkout offer, the application's own conclusion
// — granted and charged without being chosen. So the end of a subscription is
// recorded only once every booking of it that runs past the end has ended
// there.
//
// A booking belongs to the subscription that ended where it began before that
// end. One that began from the end on was booked on a subscription after it,
// since a tenant past its end books nothing, and is left alone.

import type { SubscriptionBundleRecord, SubscriptionBundleRepository } from '@saasicat/core';

import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';

/**
 * Ends at `endsAt` every booking of `subscriptionId` that began before it and
 * runs past it: one not cancelled, and one cancelled for a later date. A
 * booking that ends by `endsAt` already is left as it is, so a second call
 * writes nothing. Throws where a booking could not be ended there; the
 * bookings ended before it stay ended.
 */
export async function endBookingsWithTheirSubscription(
    bookings: SubscriptionBundleRepository,
    subscriptionId: string,
    endsAt: Date,
): Promise<void> {
    for (const booking of await bookings.listBySubscription(subscriptionId)) {
        if (booking.startedAt >= endsAt || endsBy(booking, endsAt)) continue;
        await endBookingAt(bookings, booking, endsAt);
    }
}

/** Whether `booking`'s cancellation lands at or before `endsAt`. */
function endsBy(booking: SubscriptionBundleRecord, endsAt: Date): boolean {
    const landsAt = cancellationLandsAt(booking);
    return landsAt !== null && landsAt <= endsAt;
}

/**
 * Ends `booking` at `endsAt`. Both writes are conditional on the booking as it
 * was read; where one does not claim it, the booking is read again, and one
 * that ends by `endsAt` now was ended beside this call — by another instance
 * recording the same end at the same moment — which is what was asked.
 */
async function endBookingAt(
    bookings: SubscriptionBundleRepository,
    booking: SubscriptionBundleRecord,
    endsAt: Date,
): Promise<void> {
    const landsAt = cancellationLandsAt(booking);
    if (landsAt === null) {
        try {
            await bookings.cancel(booking.id, { canceledAt: endsAt, canceledEffectiveAt: endsAt });
        } catch (error) {
            // A read that fails on its own must not replace the refusal.
            if (await endedBeside(bookings, booking.id, endsAt).catch(() => false)) return;
            throw error;
        }
        return;
    }
    if (!bookings.endNow) {
        throw new Error(
            `Booking ${booking.id} is cancelled for ${landsAt.toISOString()}, after its ` +
                `subscription ended at ${endsAt.toISOString()}, and the SubscriptionBundleRepository ` +
                'has no `endNow` to end it there, so the end of the subscription is not recorded. ' +
                'Both shipped adapters have it.',
        );
    }
    const ended = await bookings.endNow(booking.id, {
        at: endsAt,
        expectedCanceledEffectiveAt: landsAt,
    });
    if (ended || (await endedBeside(bookings, booking.id, endsAt))) return;
    throw new Error(
        `Booking ${booking.id} changed while it was ended at the end of its subscription, ` +
            `${endsAt.toISOString()}, and does not end there now. The end of the subscription is ` +
            'not recorded; recording it again reads the booking as it stands.',
    );
}

/** Whether the booking `id`, read again, ends by `endsAt`. */
async function endedBeside(
    bookings: SubscriptionBundleRepository,
    id: string,
    endsAt: Date,
): Promise<boolean> {
    const now = await bookings.findById(id);
    return now !== null && endsBy(now, endsAt);
}
