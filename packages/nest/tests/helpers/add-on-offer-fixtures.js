// A newer add-on version offered to a booking, as the tests build it: Reports
// v1 booked and a v2 on sale, subscriptions and bookings kept in memory, and
// the offer, the switch and the run over them.
//
// t1 holds a yearly Standard subscription whose year ends on 1 January 2027,
// and a monthly booking of Reports v1 (9.90 a month, 10 reports) whose period
// runs from 1 October to 1 November. It is 15 October.

import {
    BundleVersionOfferService,
    BundleVersionSwitchRunService,
    BundleVersionSwitchService,
} from '../../dist/billing/index.js';
import {
    NOW,
    RETIRED,
    addOnVersion,
    bookingOf,
    catalogueOf,
    subscriptionOf,
} from './add-on-retirement-fixtures.js';

export { NOW };

/** Reports v1, the version booked, whose sale ended when v2 took over on 1 October. */
export const BOOKED = RETIRED;

/** Reports v2 on sale from 1 October, with `fields` deciding what kind of offer it is. */
export function offeredVersion(fields = {}) {
    return addOnVersion('bv-2', {
        version: 2,
        validFrom: '2026-10-01T00:00:00.000Z',
        ...fields,
    });
}

/** The same price, twenty reports: nothing dearer, nothing less. */
export const IMPROVEMENT = offeredVersion({ quotas: { reports: 20 } });
/** 12.90 a month and 129 a year, twenty reports: more for more. */
export const MORE_FOR_MORE = offeredVersion({
    monthlyNet: '12.90',
    yearlyNet: '129.00',
    quotas: { reports: 20 },
});
/** The same price, five reports: takes something away. */
export const TAKES_AWAY = offeredVersion({ quotas: { reports: 5 } });

/** A booking of `tenantId`, on v1 unless said, with no switch scheduled. */
export function bookedOf(tenantId, overrides = {}) {
    return bookingOf(tenantId, {
        pendingBundleVersionId: null,
        pendingVersionEffectiveAt: null,
        ...overrides,
    });
}

/** The booking store over `rows`, with every method the platform asks of one. */
export function bookingStore(rows) {
    return {
        rows,
        async findById(id) {
            return rows.find((row) => row.id === id) ?? null;
        },
        async listBySubscription(subscriptionId) {
            return rows.filter((row) => row.subscriptionId === subscriptionId);
        },
        async listActiveBySubscription(subscriptionId, asOf = new Date()) {
            return rows.filter(
                (row) =>
                    row.subscriptionId === subscriptionId &&
                    (row.canceledAt === null || row.canceledEffectiveAt > asOf),
            );
        },
        async listOfVersion(bundleVersionId) {
            return rows.filter((row) => row.bundleVersionId === bundleVersionId);
        },
        async moveToVersion(id, from, to) {
            const at = rows.findIndex((row) => row.id === id && row.bundleVersionId === from);
            if (at === -1) return null;
            rows[at] = { ...rows[at], bundleVersionId: to };
            return rows[at];
        },
        async scheduleVersion(id, { from, to, effectiveAt }) {
            const at = rows.findIndex(
                (row) =>
                    row.id === id && row.bundleVersionId === from && !row.pendingBundleVersionId,
            );
            if (at === -1) return null;
            rows[at] = {
                ...rows[at],
                pendingBundleVersionId: to,
                pendingVersionEffectiveAt: effectiveAt,
            };
            return rows[at];
        },
        async unscheduleVersion(id, to) {
            const at = rows.findIndex((row) => row.id === id && row.pendingBundleVersionId === to);
            if (at === -1) return null;
            rows[at] = {
                ...rows[at],
                pendingBundleVersionId: null,
                pendingVersionEffectiveAt: null,
            };
            return rows[at];
        },
        async listScheduledVersionsDue(asOf) {
            return rows.filter(
                (row) => row.pendingVersionEffectiveAt && row.pendingVersionEffectiveAt <= asOf,
            );
        },
    };
}

/** The usage port over `subscriptions` (`{ tenantId, subscription }`). */
export function usageOf(subscriptions) {
    return {
        async listByIds(ids) {
            return subscriptions.filter(({ subscription }) => ids.includes(subscription.id));
        },
        async findForTenant(tenantId) {
            return subscriptions.find((row) => row.tenantId === tenantId)?.subscription ?? null;
        },
    };
}

/**
 * The offer, the switch and the run over one world. `ahead` are the plans the
 * subscription is set to move to; `withRun: false` leaves the run out, as an
 * installation without the quarter-hourly steps has none; `journalFailures`
 * is how many times the journal fails to record before it records again.
 */
export function offering({
    versions = [BOOKED, IMPROVEMENT],
    subscriptions = [subscriptionOf('t1')],
    bookings = [bookedOf('t1')],
    deleted = [],
    ahead = [],
    blocked = null,
    withRun = true,
    store = bookingStore(bookings),
    noParty = [],
    freezeFails = false,
    journalFailures = 0,
} = {}) {
    const catalogue = catalogueOf(versions, { deleted });
    const usage = usageOf(subscriptions);
    const frozen = [];
    const invalidated = [];
    const recorded = [];
    const asked = [];
    const askedWhileOn = [];
    const audited = [];
    const contractFreeze = {
        async assertPartyFor(tenantId, intended) {
            asked.push({ tenantId, intended });
            askedWhileOn.push(
                store.rows.find((row) => row.id === `sb-${tenantId}`)?.bundleVersionId,
            );
            if (noParty.includes(tenantId)) throw new Error('no party');
        },
        async freezeOnPlanChange(...args) {
            if (freezeFails) throw new Error('the contract store is down');
            frozen.push(args);
        },
    };
    const entitlements = { invalidateTenant: (tenantId) => invalidated.push(tenantId) };
    let failuresLeft = journalFailures;
    const charges = {
        async recordDueCharges(tenantId) {
            if (failuresLeft > 0) {
                failuresLeft -= 1;
                throw new Error('the journal is down');
            }
            recorded.push(tenantId);
        },
    };
    const run = withRun
        ? new BundleVersionSwitchRunService(
              store,
              usage,
              entitlements,
              null,
              contractFreeze,
              charges,
              { log: async (entry) => audited.push(entry) },
          )
        : null;
    const offers = new BundleVersionOfferService(
        store,
        catalogue,
        { of: async () => ahead },
        blocked,
        run,
    );
    const switches = new BundleVersionSwitchService(
        offers,
        usage,
        store,
        entitlements,
        contractFreeze,
        charges,
    );
    return {
        offers,
        switches,
        run,
        store,
        usage,
        catalogue,
        subscriptions,
        frozen,
        invalidated,
        recorded,
        asked,
        askedWhileOn,
        audited,
    };
}

/** The booking `id` as the store holds it now. */
export const bookingIn = (world, id) => world.store.rows.find((row) => row.id === id);

/** What `offers.offerFor` answers for the booking of `tenantId` at `at`. */
export async function offerOf(world, tenantId = 't1', at = NOW) {
    const sub = await world.usage.findForTenant(tenantId);
    return world.offers.offerFor(sub, bookingIn(world, `sb-${tenantId}`), at);
}
