// The tenant's add-on route hands out, beside every moment of a booking, a
// preview and a switch, the days around it in the installation's zone — the
// zone `config/saas.yaml` names, UTC where it names none — so a page writes the
// day the platform decided rather than the one the browser's clock reads.

// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { buildTenantSubscriptionBundlesController } from '../dist/billing/index.js';
import { bookingOf, subscriptionOf } from './helpers/add-on-retirement-fixtures.js';

const BERLIN = { timeZone: 'Europe/Berlin' };
/** Midnight before 1 December in Berlin: 30 November in UTC. */
const MIDNIGHT_IN_BERLIN = new Date('2026-11-30T23:00:00.000Z');
const REQ = { user: { tenantId: 't1', sub: 'user-1' } };

/** The route over t1's subscription and one booking, reading days in `settings`' zone. */
function routeIn(settings, booking = {}) {
    const Ctrl = buildTenantSubscriptionBundlesController();
    const record = bookingOf('t1', {
        startedAt: MIDNIGHT_IN_BERLIN,
        minimumTermEndsAt: MIDNIGHT_IN_BERLIN,
        ...booking,
    });
    const service = {
        listForSubscription: async () => [{ ...record, bundleKey: 'REPORTS', label: 'Reports' }],
        addBundleToSubscription: async () => record,
        cancelBundleFromSubscription: async () => record,
        reactivateBundle: async () => record,
    };
    const previews = {
        previewAdd: async () => ({
            action: 'add',
            minimumTermEndsAt: null,
            firstPeriodEnd: MIDNIGHT_IN_BERLIN,
            endsWithPlanAt: MIDNIGHT_IN_BERLIN,
        }),
        previewCancel: async () => ({ action: 'cancel', effectiveAt: MIDNIGHT_IN_BERLIN }),
    };
    const switches = {
        take: async () => ({
            class: 'takes-something-away',
            subscriptionBundleId: record.id,
            fromBundleVersionId: 'bv-1',
            bundleVersionId: 'bv-2',
            immediate: false,
            takesEffectAt: MIDNIGHT_IN_BERLIN.toISOString(),
        }),
    };
    return new Ctrl(
        service,
        previews,
        { findForTenant: async () => subscriptionOf('t1').subscription },
        () => 't1',
        null,
        null,
        { of: async () => [] },
        null,
        null,
        null,
        switches,
        null,
        null,
        null,
        null,
        settings,
    );
}

const AROUND_MIDNIGHT = { until: '2026-11-30', from: '2026-12-01' };
const ON_30_NOVEMBER_IN_UTC = { until: '2026-11-30', from: '2026-11-30' };

describe('the days of an add-on booking', () => {
    test('are read in the zone the settings name', async () => {
        const [booking] = await routeIn(BERLIN).list(REQ);

        assert.deepEqual(booking.startedDays, AROUND_MIDNIGHT);
        assert.deepEqual(booking.minimumTermEndsDays, AROUND_MIDNIGHT);
        assert.equal(booking.canceledDays, null);
        assert.equal(booking.canceledEffectiveDays, null);
    });

    test('in UTC where the settings name none', async () => {
        const [booking] = await routeIn({}).list(REQ);

        assert.deepEqual(booking.startedDays, ON_30_NOVEMBER_IN_UTC);
    });

    test('are named for every moment of a booking, beside the moment itself', async () => {
        const [booking] = await routeIn(BERLIN, {
            canceledAt: MIDNIGHT_IN_BERLIN,
            canceledEffectiveAt: MIDNIGHT_IN_BERLIN,
            currentPeriodEnd: MIDNIGHT_IN_BERLIN,
            pendingVersionEffectiveAt: MIDNIGHT_IN_BERLIN,
        }).list(REQ);

        for (const days of [
            'startedDays',
            'minimumTermEndsDays',
            'canceledDays',
            'canceledEffectiveDays',
            'currentPeriodEndDays',
            'pendingVersionEffectiveDays',
        ]) {
            assert.deepEqual(booking[days], AROUND_MIDNIGHT, days);
        }
        assert.equal(booking.startedAt, MIDNIGHT_IN_BERLIN);
    });

    test('come with a booking added, cancelled or reinstated', async () => {
        const route = routeIn(BERLIN);
        const asked = { bundleVersionId: 'bv-1' };

        for (const answer of [
            await route.add(REQ, asked),
            await route.cancel(REQ, 'sb-t1', {}),
            await route.reactivate(REQ, 'sb-t1'),
        ]) {
            assert.deepEqual(answer.startedDays, AROUND_MIDNIGHT);
        }
    });
});

describe('the days of what a tenant is about to agree to', () => {
    test('a booking’s preview names the days of its first period, its term and its end', async () => {
        const preview = await routeIn(BERLIN).preview(REQ, { bundleVersionId: 'bv-1' });

        assert.equal(preview.minimumTermEndsDays, null);
        assert.deepEqual(preview.firstPeriodEndDays, AROUND_MIDNIGHT);
        assert.deepEqual(preview.endsWithPlanDays, AROUND_MIDNIGHT);
    });

    test('a cancellation’s preview names the days of when it takes effect', async () => {
        const preview = await routeIn(BERLIN).preview(REQ, { subscriptionBundleId: 'sb-t1' });

        assert.deepEqual(preview.effectiveDays, AROUND_MIDNIGHT);
    });

    test('a newer version taken names the days of when it takes effect', async () => {
        const taken = await routeIn(BERLIN).acceptVersionOffer(REQ, 'sb-t1', {
            bundleVersionId: 'bv-2',
        });

        assert.deepEqual(taken.takesEffectDays, AROUND_MIDNIGHT);
    });
});

// @requirement SC-ADM-026
describe('who may make an add-on change, as its preview says', () => {
    const as = (role) => ({ user: { ...REQ.user, role } });

    test('the administrator may book and cancel what the previews show', async () => {
        const route = routeIn(BERLIN);
        const booking = await route.preview(as('TENANT_ADMIN'), { bundleVersionId: 'bv-1' });
        const cancellation = await route.preview(as('TENANT_ADMIN'), {
            subscriptionBundleId: 'sb-t1',
        });

        assert.equal(booking.mayChange, true);
        assert.equal(cancellation.mayChange, true);
    });

    test('a member reads both previews, and is told the administration makes the change', async () => {
        const route = routeIn(BERLIN);
        const booking = await route.preview(as('TENANT_USER'), { bundleVersionId: 'bv-1' });
        const cancellation = await route.preview(as('TENANT_USER'), {
            subscriptionBundleId: 'sb-t1',
        });

        assert.equal(booking.mayChange, false);
        assert.deepEqual(booking.firstPeriodEndDays, AROUND_MIDNIGHT);
        assert.equal(cancellation.mayChange, false);
        assert.deepEqual(cancellation.effectiveDays, AROUND_MIDNIGHT);
    });
});
