// Taking a newer add-on version offered beside a booking: at once, or for the
// end of the booking's term, and what is refused.
//
// Every case is t1's monthly booking of Reports v1 (9.90 a month, 10 reports)
// beside a yearly Standard plan, its period ending on 1 November; v2 is on
// sale from 1 October. It is 15 October.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';

import {
    SubscriptionBundlesService,
    SwitchSubscriptionBundleDto,
    TenantAdminGuard,
    buildTenantSubscriptionBundlesController,
} from '../dist/billing/index.js';
import { rejection, subscriptionOf } from './helpers/add-on-retirement-fixtures.js';
import {
    BOOKED,
    IMPROVEMENT,
    MORE_FOR_MORE,
    NOW,
    TAKES_AWAY,
    bookedOf,
    bookingIn,
    bookingStore,
    offering,
} from './helpers/add-on-offer-fixtures.js';

const PERIOD_END = new Date('2026-11-01T00:00:00.000Z');

/** The refusal `promise` answers with: its status, code, params and offer. */
async function refusedWith(promise) {
    const error = await rejection(promise);
    const { code, params, offer } = error.getResponse();
    return { status: error.getStatus(), code, params, offer };
}

/** The booking as it stands, without its version and the moment it was last written. */
const kept = ({ bundleVersionId: _version, updatedAt: _written, ...rest }) => rest;

// @requirement SC-BUN-058 — A newer add-on version is taken by naming it, the way its kind says
describe('an improvement and more for more are taken at once', () => {
    test('an improvement moves the booking and writes the contract that marks its new line', async () => {
        const world = offering();
        const before = bookingIn(world, 'sb-t1');

        const result = await world.switches.take('t1', 'sb-t1', IMPROVEMENT.id, NOW);

        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, IMPROVEMENT.id);
        assert.deepEqual(kept(bookingIn(world, 'sb-t1')), kept(before), 'period, terms and rhythm');
        assert.deepEqual(result, {
            class: 'improvement',
            subscriptionBundleId: 'sb-t1',
            fromBundleVersionId: BOOKED.id,
            bundleVersionId: IMPROVEMENT.id,
            immediate: true,
            takesEffectAt: NOW.toISOString(),
        });
        assert.deepEqual(world.frozen, [
            [
                't1',
                'STANDARD',
                'YEARLY',
                NOW,
                null,
                {
                    addOnSwitch: {
                        subscriptionBundleId: 'sb-t1',
                        fromBundleVersionId: BOOKED.id,
                        bundleVersionId: IMPROVEMENT.id,
                        effectiveAt: NOW,
                    },
                },
            ],
        ]);
        assert.deepEqual(world.invalidated, ['t1']);
        assert.deepEqual(world.recorded, ['t1'], 'the account brought up to date');
    });

    test('more for more is taken the same way', async () => {
        const world = offering({ versions: [BOOKED, MORE_FOR_MORE] });

        const result = await world.switches.take('t1', 'sb-t1', MORE_FOR_MORE.id, NOW);

        assert.equal(result.class, 'more-for-more');
        assert.equal(result.immediate, true);
        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, MORE_FOR_MORE.id);
        assert.equal(world.frozen.length, 1);
    });

    test('asks the party about the contract it writes, before the booking moves', async () => {
        const world = offering();

        await world.switches.take('t1', 'sb-t1', IMPROVEMENT.id, NOW);

        assert.deepEqual(world.asked, [
            { tenantId: 't1', intended: { effectiveFrom: NOW, cycle: 'YEARLY', endsAt: null } },
        ]);
        assert.deepEqual(world.askedWhileOn, [BOOKED.id]);
    });

    test('a booking cancelled for later switches, and its cancellation stands', async () => {
        const world = offering({
            bookings: [
                bookedOf('t1', {
                    canceledAt: new Date('2026-10-10T00:00:00.000Z'),
                    canceledEffectiveAt: PERIOD_END,
                }),
            ],
        });

        await world.switches.take('t1', 'sb-t1', IMPROVEMENT.id, NOW);

        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, IMPROVEMENT.id);
        assert.deepEqual(bookingIn(world, 'sb-t1').canceledEffectiveAt, PERIOD_END);
    });

    test('writes the contract to end where the subscription does', async () => {
        const ends = new Date('2027-06-01T00:00:00.000Z');
        const world = offering({
            subscriptions: [
                subscriptionOf('t1', {
                    canceledAt: new Date('2026-10-01T00:00:00.000Z'),
                    canceledEffectiveAt: ends,
                }),
            ],
        });

        await world.switches.take('t1', 'sb-t1', IMPROVEMENT.id, NOW);

        assert.deepEqual(world.frozen[0][4], ends);
    });

    test('in a trial the booking moves, and nothing is frozen or charged', async () => {
        const world = offering({
            subscriptions: [
                subscriptionOf('t1', {
                    status: 'TRIAL',
                    trialEndsAt: new Date('2026-11-20T00:00:00.000Z'),
                }),
            ],
        });

        const result = await world.switches.take('t1', 'sb-t1', IMPROVEMENT.id, NOW);

        assert.equal(result.immediate, true);
        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, IMPROVEMENT.id);
        assert.deepEqual(world.frozen, []);
        assert.deepEqual(world.recorded, []);
        assert.deepEqual(world.asked, [{ tenantId: 't1', intended: null }], 'the party alone');
    });
});

// @requirement SC-BUN-058 — A newer add-on version is taken by naming it, the way its kind says
describe('one that takes something away is scheduled for the end of the booking’s term', () => {
    test('scheduled for the end of its period, and the booking stays on its version', async () => {
        const world = offering({ versions: [BOOKED, TAKES_AWAY] });

        const result = await world.switches.take('t1', 'sb-t1', TAKES_AWAY.id, NOW);

        assert.deepEqual(result, {
            class: 'takes-something-away',
            subscriptionBundleId: 'sb-t1',
            fromBundleVersionId: BOOKED.id,
            bundleVersionId: TAKES_AWAY.id,
            immediate: false,
            takesEffectAt: PERIOD_END.toISOString(),
        });
        const booking = bookingIn(world, 'sb-t1');
        assert.equal(booking.bundleVersionId, BOOKED.id);
        assert.equal(booking.pendingBundleVersionId, TAKES_AWAY.id);
        assert.deepEqual(booking.pendingVersionEffectiveAt, PERIOD_END);
        assert.deepEqual(world.frozen, [], 'nothing is written until then');
        assert.deepEqual(world.recorded, []);
    });

    test('the booking list names the version scheduled, and its moment', async () => {
        const world = offering({ versions: [BOOKED, TAKES_AWAY] });
        await world.switches.take('t1', 'sb-t1', TAKES_AWAY.id, NOW);

        const [listed] = await new SubscriptionBundlesService(
            world.store,
            world.catalogue,
        ).listForSubscription('sub-t1', 'STANDARD', 'YEARLY');

        assert.deepEqual(
            [listed.bundleVersionId, listed.pendingVersion, listed.pendingVersionEffectiveAt],
            [BOOKED.id, 2, PERIOD_END],
        );
    });

    test('asks the party about the contract that runs from then', async () => {
        const world = offering({ versions: [BOOKED, TAKES_AWAY] });

        await world.switches.take('t1', 'sb-t1', TAKES_AWAY.id, NOW);

        assert.deepEqual(world.asked, [
            {
                tenantId: 't1',
                intended: { effectiveFrom: PERIOD_END, cycle: 'YEARLY', endsAt: null },
            },
        ]);
    });
});

// @requirement SC-BUN-058 — A newer add-on version is taken by naming it, the way its kind says
describe('the switch goes ahead only while the version shown is still the offer', () => {
    test('another version named is refused, carrying the offer as it stands', async () => {
        const world = offering();

        const refused = await refusedWith(world.switches.take('t1', 'sb-t1', 'bv-3', NOW));

        assert.equal(refused.status, 409);
        assert.equal(refused.code, 'BUNDLE_VERSION_OFFER_CHANGED');
        assert.deepEqual(refused.params, { bundleVersionId: 'bv-3' });
        assert.equal(refused.offer.offered.bundleVersionId, IMPROVEMENT.id);
        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, BOOKED.id);
    });

    test('no offer at all is refused the same way, carrying none', async () => {
        const world = offering({ bookings: [bookedOf('t1', { bundleVersionId: IMPROVEMENT.id })] });

        const refused = await refusedWith(world.switches.take('t1', 'sb-t1', IMPROVEMENT.id, NOW));

        assert.equal(refused.code, 'BUNDLE_VERSION_OFFER_CHANGED');
        assert.equal(refused.offer, null);
    });

    test('a booking that moved before the switch was written is answered with the offer as it stands', async () => {
        const rows = [bookedOf('t1')];
        const store = bookingStore(rows);
        const move = store.moveToVersion;
        // Another request takes the same offer between this one's read and its write.
        store.moveToVersion = async (id, from, to) => {
            await move(id, from, to);
            return move(id, from, to);
        };
        const world = offering({ store, bookings: rows });

        const refused = await refusedWith(world.switches.take('t1', 'sb-t1', IMPROVEMENT.id, NOW));

        assert.equal(refused.code, 'BUNDLE_VERSION_OFFER_CHANGED');
        assert.equal(refused.offer, null, 'it is on the version offered now');
        assert.deepEqual(world.frozen, []);
    });

    test('a switch scheduled meanwhile is answered the same way', async () => {
        const rows = [bookedOf('t1')];
        const store = bookingStore(rows);
        const schedule = store.scheduleVersion;
        store.scheduleVersion = async (id, change) => {
            await schedule(id, change);
            return schedule(id, change);
        };
        const world = offering({ versions: [BOOKED, TAKES_AWAY], store, bookings: rows });

        const refused = await refusedWith(world.switches.take('t1', 'sb-t1', TAKES_AWAY.id, NOW));

        assert.equal(refused.code, 'BUNDLE_VERSION_OFFER_CHANGED');
        assert.equal(refused.offer, null);
    });

    test('a booking of another subscription reads as not found', async () => {
        const world = offering({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2')],
            bookings: [bookedOf('t1'), bookedOf('t2')],
        });

        const refused = await refusedWith(world.switches.take('t1', 'sb-t2', IMPROVEMENT.id, NOW));

        assert.equal(refused.status, 404);
        assert.equal(refused.code, 'SUBSCRIPTION_BUNDLE_NOT_FOUND');
        assert.equal(bookingIn(world, 'sb-t2').bundleVersionId, BOOKED.id);
    });

    test('a tenant with no subscription is told so', async () => {
        const world = offering({ subscriptions: [] });

        const refused = await refusedWith(world.switches.take('t1', 'sb-t1', IMPROVEMENT.id, NOW));

        assert.equal(refused.code, 'SUBSCRIPTION_NOT_FOUND');
    });

    test('a tenant the contract freeze cannot name is refused before anything moves', async () => {
        const world = offering({ noParty: ['t1'] });

        await rejection(world.switches.take('t1', 'sb-t1', IMPROVEMENT.id, NOW));

        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, BOOKED.id);
        assert.deepEqual(world.frozen, []);
    });
});

// @requirement SC-BUN-058 — A newer add-on version is taken by naming it, the way its kind says
describe('a switch whose contract cannot stand', () => {
    test('is put back and refused where the contract cannot be written', async () => {
        const world = offering({ freezeFails: true });

        const error = await rejection(world.switches.take('t1', 'sb-t1', IMPROVEMENT.id, NOW));

        assert.match(error.message, /the contract store is down/);
        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, BOOKED.id);
        assert.deepEqual(world.recorded, [], 'nothing charged');
    });

    test('is put back and refused where the subscription changed between the claim and the contract', async () => {
        const world = offering();
        const read = world.usage.findForTenant.bind(world.usage);
        let reads = 0;
        world.usage.findForTenant = async (tenantId) => {
            reads += 1;
            const sub = await read(tenantId);
            // A cancellation declared after the switch read the subscription.
            return reads === 1
                ? sub
                : { ...sub, canceledAt: NOW, canceledEffectiveAt: new Date('2027-01-01') };
        };

        const refused = await refusedWith(world.switches.take('t1', 'sb-t1', IMPROVEMENT.id, NOW));

        assert.equal(refused.code, 'SUBSCRIPTION_CHANGED');
        assert.equal(bookingIn(world, 'sb-t1').bundleVersionId, BOOKED.id);
        assert.deepEqual(world.frozen, []);
    });
});

/** The tenant's add-on route over a switch service and an audit log, as the controller is built. */
function routeOver(versionSwitches, audited = []) {
    const Ctrl = buildTenantSubscriptionBundlesController();
    const ctrl = new Ctrl(
        { listForSubscription: async () => [] },
        {},
        { findForTenant: async () => subscriptionOf('t1').subscription },
        () => 't1',
        null,
        null,
        { of: async () => [] },
        null,
        {
            switchNow: async () => ({
                subscriptionBundleId: 'sb-t1',
                fromBundleVersionId: BOOKED.id,
                bundleVersionId: IMPROVEMENT.id,
                heldUntilDay: '2027-01-31',
            }),
        },
        null,
        versionSwitches,
        { log: async (entry) => audited.push(entry) },
    );
    return { ctrl, Ctrl };
}

const REQ = { user: { tenantId: 't1', sub: 'user-1', email: 'admin@t1.example' }, headers: {} };

// @requirement SC-BUN-058 — A newer add-on version is taken by naming it, the way its kind says
describe('POST billing/subscription-bundles/:id/version-offer/accept', () => {
    test('asks for the tenant administrator', () => {
        const { Ctrl } = routeOver(null);

        assert.ok(
            (Reflect.getMetadata('__guards__', Ctrl.prototype.acceptVersionOffer) ?? []).includes(
                TenantAdminGuard,
            ),
        );
    });

    test('names the version shown, and nothing else is needed', async () => {
        const pipe = new ValidationPipe({ whitelist: true, transform: true });
        const metadata = { type: 'body', metatype: SwitchSubscriptionBundleDto };

        const shown = '0b5d6f6e-6c43-4f0e-9a51-7d0f3c2a1e44';

        const valid = await pipe.transform({ bundleVersionId: shown }, metadata);

        assert.equal(valid.bundleVersionId, shown);
        for (const body of [
            {},
            { bundleVersionId: '' },
            { bundleVersionId: 7 },
            { bundleVersionId: 'v2' },
        ]) {
            await assert.rejects(pipe.transform(body, metadata));
        }
    });

    test('switches the caller’s own tenant and records who did it', async () => {
        const taken = [];
        const audited = [];
        const { ctrl } = routeOver(
            {
                take: async (...args) => (
                    taken.push(args),
                    {
                        class: 'takes-something-away',
                        subscriptionBundleId: 'sb-t1',
                        fromBundleVersionId: BOOKED.id,
                        bundleVersionId: TAKES_AWAY.id,
                        immediate: false,
                        takesEffectAt: '2026-11-01T00:00:00.000Z',
                    }
                ),
            },
            audited,
        );

        await ctrl.acceptVersionOffer(REQ, 'sb-t1', { bundleVersionId: TAKES_AWAY.id });

        assert.deepEqual(taken, [['t1', 'sb-t1', TAKES_AWAY.id]]);
        assert.deepEqual(audited, [
            {
                actor: {
                    userId: 'user-1',
                    email: 'admin@t1.example',
                    source: 'web',
                    context: 'tenant-self-service',
                },
                entity: 'SubscriptionBundle',
                entityId: 'sb-t1',
                action: 'SCHEDULE_ADD_ON_VERSION_SWITCH',
                changes: {
                    tenantId: 't1',
                    subscriptionBundleId: 'sb-t1',
                    offerClass: 'takes-something-away',
                    fromBundleVersionId: BOOKED.id,
                    toBundleVersionId: TAKES_AWAY.id,
                    takesEffectAt: '2026-11-01T00:00:00.000Z',
                },
            },
        ]);
    });

    test('a switch at once is recorded as one', async () => {
        const audited = [];
        const { ctrl } = routeOver(
            {
                take: async () => ({
                    class: 'improvement',
                    subscriptionBundleId: 'sb-t1',
                    fromBundleVersionId: BOOKED.id,
                    bundleVersionId: IMPROVEMENT.id,
                    immediate: true,
                    takesEffectAt: NOW.toISOString(),
                }),
            },
            audited,
        );

        await ctrl.acceptVersionOffer(REQ, 'sb-t1', { bundleVersionId: IMPROVEMENT.id });

        assert.deepEqual(
            audited.map((entry) => entry.action),
            ['SWITCH_ADD_ON_VERSION'],
        );
    });

    test('has no offer to take where tenant billing does not read the bookings', async () => {
        const { ctrl } = routeOver(null);

        const refused = await refusedWith(
            ctrl.acceptVersionOffer(REQ, 'sb-t1', { bundleVersionId: IMPROVEMENT.id }),
        );

        assert.equal(refused.code, 'BUNDLE_VERSION_OFFER_CHANGED');
        assert.equal(refused.offer, null);
    });

    test('a request that names no user is refused before anything is taken', async () => {
        const taken = [];
        const { ctrl } = routeOver({ take: async (...args) => taken.push(args) });

        const refused = await refusedWith(
            ctrl.acceptVersionOffer({ user: { tenantId: 't1' } }, 'sb-t1', {
                bundleVersionId: IMPROVEMENT.id,
            }),
        );

        assert.equal(refused.code, 'TENANT_CONTEXT_MISSING');
        assert.deepEqual(taken, []);
    });
});

// @requirement SC-BUN-054 — A booking may switch to the replacement before its date, at no more than it paid
describe('the early switch to a retirement’s replacement is recorded too', () => {
    test('with who took it, the versions and the last day the price is held', async () => {
        const audited = [];
        const { ctrl } = routeOver(null, audited);

        await ctrl.switchToReplacement(REQ, 'sb-t1', { bundleVersionId: IMPROVEMENT.id });

        assert.deepEqual(
            audited.map(({ action, changes }) => [action, changes]),
            [
                [
                    'SWITCH_ADD_ON_TO_RETIREMENT_REPLACEMENT',
                    {
                        tenantId: 't1',
                        subscriptionBundleId: 'sb-t1',
                        fromBundleVersionId: BOOKED.id,
                        toBundleVersionId: IMPROVEMENT.id,
                        heldUntilDay: '2027-01-31',
                    },
                ],
            ],
        );
    });
});
