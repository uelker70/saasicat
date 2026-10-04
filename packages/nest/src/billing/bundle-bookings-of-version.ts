import type {
    SubscriptionBundleRecord,
    SubscriptionBundleRepository,
    SubscriptionUsagePort,
    TenantSubscriptionUsage,
} from '@saasicat/core';

/** How many subscriptions one read asks for. */
const IDS_PER_READ = 1000;

/** The bookings on one add-on version by id, and their subscriptions by id. */
export interface BookingsOnVersion {
    readonly bookings: Map<string, SubscriptionBundleRecord>;
    readonly owners: Map<string, TenantSubscriptionUsage>;
}

/**
 * Every booking of the add-on version `bundleVersionId`, in every tenant and
 * whatever its state, and the subscription each belongs to — read inside the
 * caller's RLS bypass. A booking whose subscription cannot be read has no
 * owner here.
 *
 * Both ports are optional on their interfaces; an add-on retirement is refused
 * at start-up without them, and nothing else reads this.
 */
export async function bookingsOfVersion(
    bookings: Pick<SubscriptionBundleRepository, 'listOfVersion'>,
    subscriptions: Pick<SubscriptionUsagePort, 'listByIds'>,
    bundleVersionId: string,
): Promise<BookingsOnVersion> {
    const rows = await bookings.listOfVersion!(bundleVersionId);
    const ids = [...new Set(rows.map((row) => row.subscriptionId))];
    // In slices: a query binds a bounded number of values, and a version can
    // be booked on more subscriptions than that.
    const owners: TenantSubscriptionUsage[] = [];
    for (let start = 0; start < ids.length; start += IDS_PER_READ) {
        owners.push(...(await subscriptions.listByIds!(ids.slice(start, start + IDS_PER_READ))));
    }
    return {
        bookings: new Map(rows.map((row) => [row.id, row])),
        owners: new Map(owners.map((owner) => [owner.subscription.id, owner])),
    };
}
