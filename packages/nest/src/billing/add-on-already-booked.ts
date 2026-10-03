import {
    BILLING_ERROR_CODES,
    type BundleRepository,
    type BundleVersionRow,
    type SubscriptionBundleRepository,
} from '@saasicat/core';

import type { BundleBookingRefusal } from './bundle-version-not-on-sale.js';

/**
 * Whether two bundle versions belong to one add-on.
 *
 * Two versions of an add-on are one add-on to the tenant who books it: holding
 * both, they pay twice for what the two have in common. So the rule that an
 * add-on is booked once (`SC-BUN-027`) compares add-ons, never versions.
 */
export function sameAddOn(
    a: Pick<BundleVersionRow, 'bundleId'>,
    b: Pick<BundleVersionRow, 'bundleId'>,
): boolean {
    return a.bundleId === b.bundleId;
}

/**
 * The refusal for booking `version` on a subscription whose running bookings
 * name `running`, or `null` when none of them is a version of its add-on.
 *
 * One refusal for the booking and its preview, so the preview cannot let
 * through what the booking then refuses.
 */
export function addOnAlreadyBooked(
    subscriptionId: string,
    running: readonly Pick<BundleVersionRow, 'bundleId'>[],
    version: Pick<BundleVersionRow, 'bundleId'>,
): BundleBookingRefusal | null {
    if (!running.some((held) => sameAddOn(held, version))) return null;
    return {
        code: BILLING_ERROR_CODES.BUNDLE_ALREADY_SUBSCRIBED,
        message: `Subscription '${subscriptionId}' has already actively booked this bundle.`,
        params: { subscriptionId },
    };
}

/**
 * The versions a subscription's running bookings name — what a new booking is
 * compared against, and what the preview reads the plan's neighbours from. A
 * booking whose version cannot be read is left out rather than refused for: a
 * booked version cannot be deleted from the catalogue, so the row is broken,
 * and the tenant cannot repair it.
 */
export async function runningBundleVersions(
    bookings: Pick<SubscriptionBundleRepository, 'listActiveBySubscription'>,
    bundles: Pick<BundleRepository, 'findVersionById'>,
    subscriptionId: string,
): Promise<BundleVersionRow[]> {
    const running = await bookings.listActiveBySubscription(subscriptionId);
    const versions = await Promise.all(
        running.map((booking) => bundles.findVersionById(booking.bundleVersionId)),
    );
    return versions.filter((version): version is BundleVersionRow => version !== null);
}
