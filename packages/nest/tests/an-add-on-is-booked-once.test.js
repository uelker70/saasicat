import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    SubscriptionBundlePreviewService,
    SubscriptionBundlesService,
} from '../dist/billing/index.js';
import { FakeBundleRepository, FakeSubscriptionBundleRepository } from '../dist/testing/index.js';

// A subscription holds an add-on once, whichever version each booking names.
//
// Reports has two versions on sale. A tenant who holds version 1 and books
// version 2 would hold Reports twice and pay twice for what the two have in
// common. Exports is another add-on, and booking it beside Reports is fine.

const at = (day) => new Date(`${day}T00:00:00.000Z`);
const NOW = at('2026-05-15');
const SUB = 'sub-1';

function addOn(id, bundleKey) {
    return {
        id,
        bundleKey,
        label: bundleKey,
        description: null,
        icon: null,
        sortOrder: 0,
        i18n: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
    };
}

function onSale({ id, bundleId, bundleKey, version }) {
    return {
        id,
        bundleId,
        bundleKey,
        label: bundleKey,
        version,
        baseVersionId: null,
        features: [bundleKey],
        quotas: {},
        compatibility: {},
        pricingOverrides: [],
        monthlyNet: '9.90',
        yearlyNet: '99.00',
        marketed: true,
        publishedAt: '2026-01-01T00:00:00.000Z',
        supersededAt: null,
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: null,
        publishedChanges: [],
        changeNote: '',
        nonRegressive: true,
        createdByUserId: null,
        publishedByUserId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    };
}

const REPORTS_V1 = onSale({ id: 'bv-r1', bundleId: 'b-reports', bundleKey: 'REPORTS', version: 1 });
const REPORTS_V2 = onSale({ id: 'bv-r2', bundleId: 'b-reports', bundleKey: 'REPORTS', version: 2 });
const EXPORTS_V1 = onSale({ id: 'bv-e1', bundleId: 'b-exports', bundleKey: 'EXPORTS', version: 1 });

/** The catalogue above, and a subscription holding the bookings `holding` makes. */
async function subscriptionHolding(holding) {
    const bundles = new FakeBundleRepository();
    bundles.seedBundle(addOn('b-reports', 'REPORTS'));
    bundles.seedBundle(addOn('b-exports', 'EXPORTS'));
    for (const version of [REPORTS_V1, REPORTS_V2, EXPORTS_V1]) bundles.seedVersion(version);
    const bookings = new FakeSubscriptionBundleRepository();
    await holding(bookings);
    const service = new SubscriptionBundlesService(bookings, bundles, {
        defaultMinimumTermMonths: 0,
    });
    const book = (bundleVersionId) =>
        service.addBundleToSubscription({
            subscriptionId: SUB,
            bundleVersionId,
            currentPlanKey: 'STANDARD',
            startedAt: NOW,
            parentEndsAt: null,
            planCycle: 'MONTHLY',
            planPeriodEnd: at('2026-06-01'),
            planAnchorDay: 1,
        });
    const preview = (bundleVersionId) =>
        new SubscriptionBundlePreviewService(bookings, bundles, null).previewAdd(
            {
                subscriptionId: SUB,
                currentPlanKey: 'STANDARD',
                billingCycle: 'MONTHLY',
                status: 'ACTIVE',
                startedAt: at('2026-01-01'),
                currentPeriodStart: at('2026-05-01'),
                currentPeriodEnd: at('2026-06-01'),
                parentEndsAt: null,
                planAnchorDay: 1,
            },
            { bundleVersionId },
            NOW,
        );
    return { book, preview, bookings: () => bookings.listBySubscription(SUB) };
}

/** A running booking of `version`, made in January. */
const running = (version) => (bookings) =>
    bookings.add({
        subscriptionId: SUB,
        bundleVersionId: version.id,
        startedAt: at('2026-01-10'),
        minimumTermEndsAt: null,
        billingCycle: 'MONTHLY',
        currentPeriodStart: at('2026-05-01'),
        currentPeriodEnd: at('2026-06-01'),
    });

/** A booking of `version` cancelled for `effectiveAt`. */
const cancelledFor = (version, effectiveAt) => async (bookings) => {
    const booking = await running(version)(bookings);
    await bookings.cancel(booking.id, {
        canceledAt: at('2026-01-20'),
        canceledEffectiveAt: effectiveAt,
    });
};

/** Refused with 422 and `code`. */
const refusedWith = (code) => (error) => {
    assert.equal(error.getStatus?.(), 422);
    assert.equal(error.getResponse().code, code);
    return true;
};

const codes = (preview) => preview.blockers.map((blocker) => blocker.code);

// @requirement SC-BUN-027 — The same add-on cannot be booked twice on one subscription
describe('a tenant booking an add-on', () => {
    test('is refused a newer version while a booking of an older one runs', async () => {
        const { book, bookings } = await subscriptionHolding(running(REPORTS_V1));
        await assert.rejects(() => book(REPORTS_V2.id), refusedWith('BUNDLE_ALREADY_SUBSCRIBED'));
        assert.deepEqual(
            (await bookings()).map((booking) => booking.bundleVersionId),
            [REPORTS_V1.id],
        );
    });

    test('is refused it while the older booking is cancelled but has not ended', async () => {
        const { book } = await subscriptionHolding(cancelledFor(REPORTS_V1, at('2099-01-01')));
        await assert.rejects(() => book(REPORTS_V2.id), refusedWith('BUNDLE_ALREADY_SUBSCRIBED'));
    });

    test('books it once the older booking has ended', async () => {
        const { book, bookings } = await subscriptionHolding(
            cancelledFor(REPORTS_V1, at('2026-02-01')),
        );
        await book(REPORTS_V2.id);
        assert.equal((await bookings()).length, 2);
    });

    test('books a different add-on beside it', async () => {
        const { book, bookings } = await subscriptionHolding(running(REPORTS_V1));
        await book(EXPORTS_V1.id);
        assert.equal((await bookings()).length, 2);
    });
});

// @requirement SC-BUN-027 — The same add-on cannot be booked twice on one subscription
describe('the preview of that booking', () => {
    test('says what the booking would say', async () => {
        const { preview } = await subscriptionHolding(running(REPORTS_V1));
        assert.ok(codes(await preview(REPORTS_V2.id)).includes('BUNDLE_ALREADY_SUBSCRIBED'));
    });

    test('has no word against a different add-on', async () => {
        const { preview } = await subscriptionHolding(running(REPORTS_V1));
        assert.equal(
            codes(await preview(EXPORTS_V1.id)).includes('BUNDLE_ALREADY_SUBSCRIBED'),
            false,
        );
    });
});
