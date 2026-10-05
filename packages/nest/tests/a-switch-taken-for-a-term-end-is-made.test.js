// The switches taken for the end of a booking's term, made at that moment by
// the quarter-hourly run: what it writes, what it clears, and what it leaves
// for the next run.
//
// Every case is t1's monthly booking of Reports v1 beside a yearly Standard
// plan, scheduled on 15 October to switch to v2 — which takes reports away — at
// the end of its period, 1 November.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { subscriptionOf } from './helpers/add-on-retirement-fixtures.js';
import {
    BOOKED,
    TAKES_AWAY,
    bookedOf,
    bookingIn,
    bookingStore,
    offering,
} from './helpers/add-on-offer-fixtures.js';

const THE_MOMENT = new Date('2026-11-01T00:00:00.000Z');
const ON_TIME = new Date('2026-11-01T00:10:00.000Z');

/** A booking with the switch to v2 scheduled for 1 November. */
const scheduledOf = (tenantId, overrides = {}) =>
    bookedOf(tenantId, {
        pendingBundleVersionId: TAKES_AWAY.id,
        pendingVersionEffectiveAt: THE_MOMENT,
        ...overrides,
    });

/** The world of a booking scheduled to switch, its run included. */
const scheduled = (options = {}) =>
    offering({
        versions: [BOOKED, TAKES_AWAY],
        bookings: [scheduledOf('t1')],
        ...options,
    });

const actionsOf = (world) => world.audited.map((entry) => entry.action);

/** A run four days after the moment, which no run came to in between. */
const LATE = new Date('2026-11-06T00:00:00.000Z');

/** A booking with its switch scheduled that ended on 5 November, after the moment. */
const endedAfterTheMoment = (tenantId) =>
    scheduledOf(tenantId, {
        canceledAt: new Date('2026-10-20T00:00:00.000Z'),
        canceledEffectiveAt: new Date('2026-11-05T00:00:00.000Z'),
    });

// @requirement SC-BUN-059 — A switch taken for the end of a booking's term is made at that moment
describe('a switch whose moment has come', () => {
    test('moves the booking, writes the contract that marks it, clears the schedule and records it', async () => {
        const world = scheduled();

        const run = await world.run.switchDue(ON_TIME);

        assert.deepEqual(run, { switched: 1, failed: 0 });
        const booking = bookingIn(world, 'sb-t1');
        assert.equal(booking.bundleVersionId, TAKES_AWAY.id);
        assert.equal(booking.pendingBundleVersionId, null);
        assert.equal(booking.pendingVersionEffectiveAt, null);
        assert.deepEqual(world.frozen, [
            [
                't1',
                'STANDARD',
                'YEARLY',
                ON_TIME,
                null,
                {
                    addOnSwitch: {
                        subscriptionBundleId: 'sb-t1',
                        fromBundleVersionId: BOOKED.id,
                        bundleVersionId: TAKES_AWAY.id,
                        effectiveAt: THE_MOMENT,
                    },
                },
            ],
        ]);
        assert.deepEqual(world.invalidated, ['t1']);
        assert.deepEqual(world.recorded, ['t1']);
        assert.deepEqual(world.audited, [
            {
                actor: {
                    userId: null,
                    email: 'platform',
                    source: 'job',
                    context: 'add-on-version-switches',
                },
                entity: 'SubscriptionBundle',
                entityId: 'sb-t1',
                action: 'BUNDLE_VERSION_SWITCH',
                changes: {
                    tenantId: 't1',
                    subscriptionId: 'sub-t1',
                    fromBundleVersionId: BOOKED.id,
                    toBundleVersionId: TAKES_AWAY.id,
                    effectiveAt: THE_MOMENT.toISOString(),
                },
            },
        ]);
    });

    test('is not made a moment before', async () => {
        const world = scheduled();

        const run = await world.run.switchDue(new Date(THE_MOMENT.getTime() - 1));

        assert.deepEqual(run, { switched: 0, failed: 0 });
        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, BOOKED.id);
    });

    test('is made by a later run where the one on the day did not happen, marked with its moment', async () => {
        const world = scheduled();
        const late = new Date('2026-11-09T09:00:00.000Z');

        await world.run.switchDue(late);

        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, TAKES_AWAY.id);
        assert.deepEqual(world.frozen[0][3], late);
        assert.deepEqual(world.frozen[0][5].addOnSwitch.effectiveAt, THE_MOMENT);
    });

    test('is made once: the next run finds nothing due', async () => {
        const world = scheduled();
        await world.run.switchDue(ON_TIME);

        const again = await world.run.switchDue(new Date('2026-11-01T00:25:00.000Z'));

        assert.deepEqual(again, { switched: 0, failed: 0 });
        assert.equal(world.frozen.length, 1);
    });

    test('writes the contract to end where the subscription does', async () => {
        const ends = new Date('2027-06-01T00:00:00.000Z');
        const world = scheduled({
            subscriptions: [
                subscriptionOf('t1', {
                    canceledAt: new Date('2026-10-20T00:00:00.000Z'),
                    canceledEffectiveAt: ends,
                }),
            ],
        });

        await world.run.switchDue(ON_TIME);

        assert.deepEqual(world.frozen[0][4], ends);
    });

    test('in a trial moves the booking, and nothing is frozen or charged', async () => {
        const world = scheduled({
            subscriptions: [
                subscriptionOf('t1', {
                    status: 'TRIAL',
                    trialEndsAt: new Date('2026-12-01T00:00:00.000Z'),
                }),
            ],
        });

        const run = await world.run.switchDue(ON_TIME);

        assert.deepEqual(run, { switched: 1, failed: 0 });
        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, TAKES_AWAY.id);
        assert.deepEqual(world.frozen, []);
        assert.deepEqual(world.recorded, []);
    });

    test('carries along a booking a retirement moved meanwhile, from the version it is on', async () => {
        const world = scheduled({
            versions: [BOOKED, TAKES_AWAY, { ...TAKES_AWAY, id: 'bv-1b', version: 1 }],
            bookings: [scheduledOf('t1', { bundleVersionId: 'bv-1b' })],
        });

        await world.run.switchDue(ON_TIME);

        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, TAKES_AWAY.id);
        assert.equal(world.frozen[0][5].addOnSwitch.fromBundleVersionId, 'bv-1b');
    });

    test('is made within the RLS bypass, as the run serves every tenant', async () => {
        const world = scheduled();
        const frames = [];
        const run = new world.run.constructor(
            world.store,
            world.usage,
            { invalidateTenant: () => {} },
            { runWithBypass: async (work) => (frames.push('bypass'), work()) },
        );

        await run.switchDue(ON_TIME);

        assert.deepEqual(frames, ['bypass']);
        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, TAKES_AWAY.id);
    });
});

// @requirement SC-BUN-059 — A switch taken for the end of a booking's term is made at that moment
describe('a switch that never comes', () => {
    test('is cleared where the booking ends by its moment, and the booking stays on its version', async () => {
        const world = scheduled({
            bookings: [
                scheduledOf('t1', {
                    canceledAt: new Date('2026-10-20T00:00:00.000Z'),
                    canceledEffectiveAt: THE_MOMENT,
                }),
            ],
        });

        const run = await world.run.switchDue(ON_TIME);

        assert.deepEqual(run, { switched: 0, failed: 0 });
        const booking = bookingIn(world, 'sb-t1');
        assert.equal(booking.bundleVersionId, BOOKED.id);
        assert.equal(booking.pendingBundleVersionId, null);
        assert.deepEqual(world.frozen, []);
        assert.deepEqual(actionsOf(world), ['BUNDLE_VERSION_SWITCH_LAPSED']);
    });

    test('is cleared where the subscription ends by its moment', async () => {
        const world = scheduled({
            subscriptions: [
                subscriptionOf('t1', {
                    canceledAt: new Date('2026-10-20T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2026-10-31T00:00:00.000Z'),
                }),
            ],
        });

        await world.run.switchDue(ON_TIME);

        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, BOOKED.id);
        assert.equal(bookingIn(world, 'sb-t1').pendingBundleVersionId, null);
        assert.deepEqual(actionsOf(world), ['BUNDLE_VERSION_SWITCH_LAPSED']);
    });

    test('is cleared where the booking ended after its moment, before a run came', async () => {
        const world = scheduled({ bookings: [endedAfterTheMoment('t1')] });

        await world.run.switchDue(LATE);

        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, BOOKED.id);
        assert.equal(bookingIn(world, 'sb-t1').pendingBundleVersionId, null);
        assert.deepEqual(world.frozen, []);
    });

    test('but is made where the booking ends after the run', async () => {
        const world = scheduled({
            bookings: [
                scheduledOf('t1', {
                    canceledAt: new Date('2026-10-20T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2026-11-05T00:00:00.000Z'),
                }),
            ],
        });

        await world.run.switchDue(ON_TIME);

        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, TAKES_AWAY.id);
    });

    test('is only cleared where the booking is on the version taken already', async () => {
        const world = scheduled({
            bookings: [scheduledOf('t1', { bundleVersionId: TAKES_AWAY.id })],
        });

        const run = await world.run.switchDue(ON_TIME);

        assert.deepEqual(run, { switched: 0, failed: 0 });
        assert.equal(bookingIn(world, 'sb-t1').pendingBundleVersionId, null);
        assert.deepEqual(world.frozen, []);
        assert.deepEqual(world.audited, []);
    });
});

// @requirement SC-BUN-059 — A switch taken for the end of a booking's term is made at that moment
describe('a booking that ran past its moment and ended before a run came', () => {
    test('has the journal asked once for the periods it ran on, before its switch is cleared', async () => {
        const world = scheduled({ bookings: [endedAfterTheMoment('t1')] });

        const first = await world.run.switchDue(LATE);
        const second = await world.run.switchDue(new Date('2026-11-06T00:15:00.000Z'));

        assert.deepEqual(world.recorded, ['t1']);
        assert.deepEqual(
            [first, second],
            [
                { switched: 0, failed: 0 },
                { switched: 0, failed: 0 },
            ],
        );
        assert.deepEqual(actionsOf(world), ['BUNDLE_VERSION_SWITCH_LAPSED']);
    });

    test('keeps its switch where the journal could not record them, and the next run asks again', async () => {
        const world = scheduled({ bookings: [endedAfterTheMoment('t1')], journalFailures: 1 });

        const first = await world.run.switchDue(LATE);
        const kept = bookingIn(world, 'sb-t1').pendingBundleVersionId;
        const second = await world.run.switchDue(new Date('2026-11-06T00:15:00.000Z'));

        assert.deepEqual(
            [first, second],
            [
                { switched: 0, failed: 1 },
                { switched: 0, failed: 0 },
            ],
        );
        assert.equal(kept, TAKES_AWAY.id);
        assert.deepEqual(world.recorded, ['t1']);
        assert.equal(bookingIn(world, 'sb-t1').pendingBundleVersionId, null);
        assert.deepEqual(actionsOf(world), ['BUNDLE_VERSION_SWITCH_LAPSED']);
    });

    test('asks nothing where nothing waited: an end by its moment, or a trial', async () => {
        const world = scheduled({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2', { status: 'TRIAL' })],
            bookings: [
                scheduledOf('t1', {
                    canceledAt: new Date('2026-10-20T00:00:00.000Z'),
                    canceledEffectiveAt: THE_MOMENT,
                }),
                endedAfterTheMoment('t2'),
            ],
        });

        await world.run.switchDue(LATE);

        assert.deepEqual(world.recorded, []);
        assert.deepEqual(
            ['sb-t1', 'sb-t2'].map((id) => bookingIn(world, id).pendingBundleVersionId),
            [null, null],
        );
    });

    test('is cleared, and nothing asked, where the tenant is on another subscription now', async () => {
        const original = subscriptionOf('t1');
        const again = {
            ...original,
            subscription: { ...original.subscription, id: 'sub-t1-again' },
        };
        const world = scheduled({
            subscriptions: [again, original],
            bookings: [endedAfterTheMoment('t1')],
        });

        await world.run.switchDue(LATE);

        assert.deepEqual(world.recorded, []);
        assert.equal(bookingIn(world, 'sb-t1').pendingBundleVersionId, null);
        assert.deepEqual(actionsOf(world), ['BUNDLE_VERSION_SWITCH_LAPSED']);
    });
});

// @requirement SC-BUN-059 — A switch taken for the end of a booking's term is made at that moment
describe('a switch the run cannot make', () => {
    test('for want of a party is left as it is, recorded once, and tried again by the next run', async () => {
        const world = scheduled({ noParty: ['t1'] });

        const first = await world.run.switchDue(ON_TIME);
        const second = await world.run.switchDue(new Date('2026-11-01T00:25:00.000Z'));

        assert.deepEqual(
            [first, second],
            [
                { switched: 0, failed: 1 },
                { switched: 0, failed: 1 },
            ],
        );
        const booking = bookingIn(world, 'sb-t1');
        assert.equal(booking.bundleVersionId, BOOKED.id);
        assert.equal(booking.pendingBundleVersionId, TAKES_AWAY.id);
        assert.deepEqual(actionsOf(world), ['BUNDLE_VERSION_SWITCH_FAILED']);
        assert.equal(world.audited[0].changes.reason, 'no-party');
    });

    test('whose contract cannot be written is put back, schedule and all', async () => {
        const world = scheduled({ freezeFails: true });

        const run = await world.run.switchDue(ON_TIME);

        assert.deepEqual(run, { switched: 0, failed: 1 });
        const booking = bookingIn(world, 'sb-t1');
        assert.equal(booking.bundleVersionId, BOOKED.id);
        assert.equal(booking.pendingBundleVersionId, TAKES_AWAY.id);
        assert.deepEqual(world.audited[0].changes, {
            tenantId: 't1',
            subscriptionId: 'sub-t1',
            fromBundleVersionId: BOOKED.id,
            toBundleVersionId: TAKES_AWAY.id,
            effectiveAt: THE_MOMENT.toISOString(),
            reason: 'contract-not-written',
            putBack: true,
        });
        assert.deepEqual(world.recorded, []);
    });

    test('leaves a booking that moved between the read and the write for the next run', async () => {
        const rows = [scheduledOf('t1')];
        const store = bookingStore(rows);
        const move = store.moveToVersion;
        store.moveToVersion = async (id, from, to) => {
            rows[0] = { ...rows[0], bundleVersionId: 'bv-elsewhere' };
            return move(id, from, to);
        };
        const world = scheduled({ store, bookings: rows });

        const run = await world.run.switchDue(ON_TIME);

        assert.deepEqual(run, { switched: 0, failed: 0 });
        assert.equal(bookingIn(world, 'sb-t1').pendingBundleVersionId, TAKES_AWAY.id);
        assert.deepEqual(world.frozen, []);
    });

    test('puts back a booking whose subscription ended between the read and the write', async () => {
        const world = scheduled();
        const read = world.usage.findForTenant.bind(world.usage);
        world.usage.findForTenant = async (tenantId) => ({
            ...(await read(tenantId)),
            canceledAt: new Date('2026-10-01T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2026-11-01T00:05:00.000Z'),
        });

        const run = await world.run.switchDue(ON_TIME);

        assert.deepEqual(run, { switched: 0, failed: 0 });
        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, BOOKED.id);
        assert.deepEqual(world.frozen, []);
    });

    test('does nothing where the store cannot carry a switch, and says so at start-up', async () => {
        const { listScheduledVersionsDue: _due, ...store } = bookingStore([scheduledOf('t1')]);
        const world = scheduled({ store });
        const warned = [];
        world.run.logger.warn = (message) => warned.push(message);

        world.run.onModuleInit();
        const run = await world.run.switchDue(ON_TIME);

        assert.deepEqual(run, { switched: 0, failed: 0 });
        assert.equal(warned.length, 1);
        assert.match(warned[0], /listScheduledVersionsDue/);
    });
});
