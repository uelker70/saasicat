import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    SubscriptionBundlePreviewService,
    SubscriptionBundlesService,
} from '../dist/billing/index.js';
import { FakeBundleRepository, FakeSubscriptionBundleRepository } from '../dist/testing/index.js';

// An operator deletes Reports from the catalogue. Deleting it leaves its
// version's dates as they were — on sale since January, with no last day — so
// a check that asks only about the version still says yes. The catalogue no
// longer shows Reports, and a booking must not take it either.

const at = (day) => new Date(`${day}T00:00:00.000Z`);
const NOW = at('2026-05-15');

const REPORTS = {
    id: 'b-reports',
    bundleKey: 'REPORTS',
    label: 'Reports',
    description: null,
    icon: null,
    sortOrder: 0,
    i18n: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
};

const REPORTS_V1 = {
    id: 'bv-r1',
    bundleId: REPORTS.id,
    bundleKey: REPORTS.bundleKey,
    label: REPORTS.label,
    version: 1,
    baseVersionId: null,
    features: ['REPORTS'],
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

/** The catalogue as `catalogue` leaves it, with a subscription that holds nothing. */
async function catalogue(change = async () => {}) {
    const bundles = new FakeBundleRepository();
    bundles.seedBundle({ ...REPORTS });
    bundles.seedVersion({ ...REPORTS_V1 });
    await change(bundles);
    const bookings = new FakeSubscriptionBundleRepository();
    const book = () =>
        new SubscriptionBundlesService(bookings, bundles, {
            defaultMinimumTermMonths: 0,
        }).addBundleToSubscription({
            subscriptionId: 'sub-1',
            bundleVersionId: REPORTS_V1.id,
            currentPlanKey: 'STANDARD',
            startedAt: NOW,
            parentEndsAt: null,
            planCycle: 'MONTHLY',
            planPeriodEnd: at('2026-06-01'),
            planAnchorDay: 1,
        });
    const preview = () =>
        new SubscriptionBundlePreviewService(bookings, bundles, null).previewAdd(
            {
                subscriptionId: 'sub-1',
                currentPlanKey: 'STANDARD',
                billingCycle: 'MONTHLY',
                status: 'ACTIVE',
                startedAt: at('2026-01-01'),
                currentPeriodStart: at('2026-05-01'),
                currentPeriodEnd: at('2026-06-01'),
                parentEndsAt: null,
                planAnchorDay: 1,
            },
            { bundleVersionId: REPORTS_V1.id },
            NOW,
        );
    return { book, preview, bookings: () => bookings.listBySubscription('sub-1') };
}

const deleted = (bundles) => bundles.softDelete(REPORTS.id);

/** Refused with 422, `BUNDLE_DELETED` and the add-on's key. */
const refusedAsDeleted = (error) => {
    assert.equal(error.getStatus?.(), 422);
    assert.equal(error.getResponse().code, 'BUNDLE_DELETED');
    assert.deepEqual(error.getResponse().params, { bundleKey: 'REPORTS' });
    return true;
};

// @requirement SC-BUN-036 — A deleted add-on cannot be booked, whatever its versions' dates say
describe('a tenant booking a version of an add-on', () => {
    test('books it while the add-on is in the catalogue', async () => {
        const { book, bookings } = await catalogue();
        await book();
        assert.equal((await bookings()).length, 1);
    });

    test('is refused once the add-on is deleted, though the version is inside its window', async () => {
        const { book, bookings } = await catalogue(deleted);
        await assert.rejects(book, refusedAsDeleted);
        assert.equal((await bookings()).length, 0);
    });

    test('is refused where the add-on cannot be read at all', async () => {
        const { book } = await catalogue((bundles) => {
            bundles.clear();
            bundles.seedVersion({ ...REPORTS_V1 });
        });
        await assert.rejects(book, refusedAsDeleted);
    });
});

// @requirement SC-BUN-036 — A deleted add-on cannot be booked, whatever its versions' dates say
describe('the preview of that booking', () => {
    test('says what the booking would say', async () => {
        const { preview } = await catalogue(deleted);
        const blockers = (await preview()).blockers.map((blocker) => blocker.code);
        assert.ok(blockers.includes('BUNDLE_DELETED'));
    });
});
