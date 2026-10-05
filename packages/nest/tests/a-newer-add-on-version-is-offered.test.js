// A newer version of a booked add-on, offered beside the booking: what kind of
// offer it is, when a switch would take effect, and where none is made.
//
// Every case is t1's monthly booking of Reports v1 (9.90 a month, 99 a year,
// 10 reports) beside a yearly Standard plan, its period ending on 1 November;
// v2 is on sale from 1 October. It is 15 October.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { subscriptionOf } from './helpers/add-on-retirement-fixtures.js';
import {
    BOOKED,
    IMPROVEMENT,
    MORE_FOR_MORE,
    NOW,
    TAKES_AWAY,
    bookedOf,
    bookingStore,
    offerOf,
    offeredVersion,
    offering,
} from './helpers/add-on-offer-fixtures.js';

const PERIOD_END = '2026-11-01T00:00:00.000Z';

// @requirement SC-BUN-057 — A newer version of a booked add-on is offered beside the booking
describe('an offer beside a booking', () => {
    test('shows both versions side by side, priced beside the plan in each rhythm', async () => {
        const offer = await offerOf(offering());

        assert.deepEqual(
            {
                subscriptionBundleId: offer.subscriptionBundleId,
                planKey: offer.planKey,
                billingCycle: offer.billingCycle,
                bound: [offer.bound.bundleVersionId, offer.bound.version],
                offered: [offer.offered.bundleVersionId, offer.offered.version],
                prices: [offer.offered.monthlyNet, offer.offered.yearlyNet],
                quotas: [offer.bound.quotas, offer.offered.quotas],
            },
            {
                subscriptionBundleId: 'sb-t1',
                planKey: 'STANDARD',
                billingCycle: 'MONTHLY',
                bound: [BOOKED.id, 1],
                offered: [IMPROVEMENT.id, 2],
                prices: [9.9, 99],
                quotas: [{ reports: 10 }, { reports: 20 }],
            },
        );
    });

    test('that improves takes effect at once', async () => {
        const offer = await offerOf(offering());

        assert.equal(offer.class, 'improvement');
        assert.equal(offer.takesEffectAt, NOW.toISOString());
    });

    test('that costs more for more takes effect at once', async () => {
        const offer = await offerOf(offering({ versions: [BOOKED, MORE_FOR_MORE] }));

        assert.equal(offer.class, 'more-for-more');
        assert.equal(offer.takesEffectAt, NOW.toISOString());
    });

    test('that takes something away takes effect at the end of the booking’s period', async () => {
        const offer = await offerOf(offering({ versions: [BOOKED, TAKES_AWAY] }));

        assert.equal(offer.class, 'takes-something-away');
        assert.equal(offer.takesEffectAt, PERIOD_END);
    });

    test('that takes something away waits for a minimum term that outlasts the period', async () => {
        const offer = await offerOf(
            offering({
                versions: [BOOKED, TAKES_AWAY],
                bookings: [
                    bookedOf('t1', { minimumTermEndsAt: new Date('2026-12-15T00:00:00.000Z') }),
                ],
            }),
        );

        assert.equal(offer.takesEffectAt, '2026-12-15T00:00:00.000Z');
    });

    test('that takes something away from a booking billed with the plan waits for the plan’s term', async () => {
        const offer = await offerOf(
            offering({
                versions: [BOOKED, TAKES_AWAY],
                bookings: [
                    bookedOf('t1', {
                        billingCycle: null,
                        currentPeriodStart: null,
                        currentPeriodEnd: null,
                    }),
                ],
            }),
        );

        assert.equal(offer.takesEffectAt, '2027-01-01T00:00:00.000Z');
    });

    test('that takes something away in a trial waits for the trial to end', async () => {
        const offer = await offerOf(
            offering({
                versions: [BOOKED, TAKES_AWAY],
                subscriptions: [
                    subscriptionOf('t1', {
                        status: 'TRIAL',
                        trialEndsAt: new Date('2026-11-20T00:00:00.000Z'),
                        currentPeriodEnd: null,
                    }),
                ],
                bookings: [bookedOf('t1', { currentPeriodStart: null, currentPeriodEnd: null })],
            }),
        );

        assert.equal(offer.takesEffectAt, '2026-11-20T00:00:00.000Z');
    });

    test('is made to a booking whose cancellation has not landed', async () => {
        const offer = await offerOf(
            offering({
                bookings: [
                    bookedOf('t1', {
                        canceledAt: new Date('2026-10-10T00:00:00.000Z'),
                        canceledEffectiveAt: new Date(PERIOD_END),
                    }),
                ],
            }),
        );

        assert.equal(offer?.class, 'improvement');
    });

    test('is made beside a retirement of the version booked, onto a newer version of the same plan', async () => {
        const offer = await offerOf(
            offering({
                ahead: [
                    {
                        planKey: 'STANDARD',
                        billingCycle: 'YEARLY',
                        from: new Date('2027-01-01T00:00:00.000Z'),
                        by: 'retirement',
                    },
                ],
            }),
        );

        assert.equal(offer?.class, 'improvement');
    });
});

// @requirement SC-BUN-057 — A newer version of a booked add-on is offered beside the booking
describe('the kind of offer is judged in the rhythm the booking is billed in', () => {
    const dearerByTheYear = offeredVersion({ yearlyNet: '129.00', quotas: { reports: 20 } });

    test('a monthly booking is offered an improvement where only the yearly price rose', async () => {
        const offer = await offerOf(offering({ versions: [BOOKED, dearerByTheYear] }));

        assert.equal(offer.class, 'improvement');
    });

    test('a yearly booking is offered more for more by the same version', async () => {
        const offer = await offerOf(
            offering({
                versions: [BOOKED, dearerByTheYear],
                bookings: [bookedOf('t1', { billingCycle: 'YEARLY' })],
            }),
        );

        assert.equal(offer.class, 'more-for-more');
        assert.equal(offer.billingCycle, 'YEARLY');
    });

    test('a booking without a rhythm of its own is judged in the plan’s', async () => {
        const offer = await offerOf(
            offering({
                versions: [BOOKED, dearerByTheYear],
                bookings: [bookedOf('t1', { billingCycle: null })],
            }),
        );

        assert.equal(offer.class, 'more-for-more');
        assert.equal(offer.billingCycle, 'YEARLY');
    });

    test('the price is the one for the subscription’s plan, an override included', async () => {
        const dearerExceptBesidePro = offeredVersion({
            monthlyNet: '12.90',
            quotas: { reports: 20 },
            pricingOverrides: [{ planId: 'PRO', monthlyNet: '9.90', yearlyNet: '99.00' }],
        });
        const world = offering({
            versions: [BOOKED, dearerExceptBesidePro],
            subscriptions: [subscriptionOf('t1', { plan: 'PRO' })],
        });

        const offer = await offerOf(world);

        assert.equal(offer.class, 'improvement');
        assert.equal(offer.offered.monthlyNet, 9.9);
    });

    test('a version the same in the booking’s rhythm and in what it grants is no offer', async () => {
        const sameButYearly = offeredVersion({ yearlyNet: '129.00' });

        assert.equal(await offerOf(offering({ versions: [BOOKED, sameButYearly] })), null);
    });
});

// @requirement SC-BUN-057 — A newer version of a booked add-on is offered beside the booking
describe('no offer', () => {
    test('while the booking is on the version on sale', async () => {
        const world = offering({ bookings: [bookedOf('t1', { bundleVersionId: IMPROVEMENT.id })] });

        assert.equal(await offerOf(world), null);
    });

    test('for a version whose window has not opened', async () => {
        const later = offeredVersion({
            validFrom: '2026-11-01T00:00:00.000Z',
            quotas: { reports: 20 },
        });
        const stillOnSale = { ...BOOKED, validUntil: '2026-10-31T00:00:00.000Z' };

        assert.equal(await offerOf(offering({ versions: [stillOnSale, later] })), null);
    });

    test('for an add-on that has been deleted', async () => {
        assert.equal(await offerOf(offering({ deleted: ['b-reports'] })), null);
    });

    test('for a version that cannot run beside the plan', async () => {
        const proOnly = offeredVersion({
            quotas: { reports: 20 },
            compatibility: { planIds: ['PRO'] },
        });

        assert.equal(await offerOf(offering({ versions: [BOOKED, proOnly] })), null);
    });

    test('for a version without a price in the booking’s rhythm beside the plan', async () => {
        const yearlyOnly = offeredVersion({ monthlyNet: null, quotas: { reports: 20 } });

        assert.equal(await offerOf(offering({ versions: [BOOKED, yearlyOnly] })), null);
    });

    test('once the subscription’s cancellation has landed', async () => {
        const world = offering({
            subscriptions: [
                subscriptionOf('t1', {
                    canceledAt: new Date('2026-09-01T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2026-10-01T00:00:00.000Z'),
                }),
            ],
        });

        assert.equal(await offerOf(world), null);
    });

    test('once the booking’s cancellation has landed', async () => {
        const world = offering({
            bookings: [
                bookedOf('t1', {
                    canceledAt: new Date('2026-09-01T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2026-10-01T00:00:00.000Z'),
                }),
            ],
        });

        assert.equal(await offerOf(world), null);
    });

    test('while a switch is scheduled for the booking', async () => {
        const world = offering({
            bookings: [
                bookedOf('t1', {
                    pendingBundleVersionId: IMPROVEMENT.id,
                    pendingVersionEffectiveAt: new Date(PERIOD_END),
                }),
            ],
        });

        assert.equal(await offerOf(world), null);
    });

    test('while a change to another plan is scheduled', async () => {
        const ahead = [
            { planKey: 'PRO', billingCycle: 'YEARLY', from: new Date(PERIOD_END), by: 'change' },
        ];

        assert.equal(await offerOf(offering({ ahead })), null);
    });

    test('while a change of rhythm is scheduled', async () => {
        const ahead = [
            {
                planKey: 'STANDARD',
                billingCycle: 'MONTHLY',
                from: new Date('2027-01-01T00:00:00.000Z'),
                by: 'change',
            },
        ];

        assert.equal(await offerOf(offering({ ahead })), null);
    });

    test('while a retirement told moves the subscription to another plan', async () => {
        const ahead = [
            {
                planKey: 'PRO',
                billingCycle: 'YEARLY',
                from: new Date('2027-01-01T00:00:00.000Z'),
                by: 'retirement',
            },
        ];

        assert.equal(await offerOf(offering({ ahead })), null);
    });

    test('for an add-on kept for special contracts', async () => {
        assert.equal(await offerOf(offering({ blocked: { bundleKeys: ['REPORTS'] } })), null);
    });

    test('where the store cannot move a booking', async () => {
        const { moveToVersion: _move, ...store } = bookingStore([bookedOf('t1')]);

        assert.equal(await offerOf(offering({ store })), null);
    });

    test('to a booking of another subscription', async () => {
        const world = offering();
        const sub = await world.usage.findForTenant('t1');

        const offer = await world.offers.offerFor(
            { ...sub, id: 'sub-someone-else' },
            world.store.rows[0],
            NOW,
        );

        assert.equal(offer, null);
    });

    test('where the version booked cannot be read', async () => {
        const world = offering({ bookings: [bookedOf('t1', { bundleVersionId: 'bv-gone' })] });

        assert.equal(await offerOf(world), null);
    });
});

// @requirement SC-BUN-057 — A newer version of a booked add-on is offered beside the booking
describe('a switch that takes something away is offered only where it would happen', () => {
    const takesAway = (options = {}) => offering({ versions: [BOOKED, TAKES_AWAY], ...options });

    test('not to a booking whose cancellation lands by then', async () => {
        const world = takesAway({
            bookings: [
                bookedOf('t1', {
                    canceledAt: new Date('2026-10-10T00:00:00.000Z'),
                    canceledEffectiveAt: new Date(PERIOD_END),
                }),
            ],
        });

        assert.equal(await offerOf(world), null);
    });

    test('nor where the subscription ends by then', async () => {
        const world = takesAway({
            subscriptions: [
                subscriptionOf('t1', {
                    canceledAt: new Date('2026-10-10T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2026-10-31T00:00:00.000Z'),
                }),
            ],
        });

        assert.equal(await offerOf(world), null);
    });

    test('but where the subscription ends after it', async () => {
        const world = takesAway({
            subscriptions: [
                subscriptionOf('t1', {
                    canceledAt: new Date('2026-10-10T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
                }),
            ],
        });

        assert.equal((await offerOf(world))?.takesEffectAt, PERIOD_END);
    });

    test('nor where the version’s last day of sale is the day before', async () => {
        const closing = { ...TAKES_AWAY, validUntil: '2026-10-31T00:00:00.000Z' };

        assert.equal(await offerOf(takesAway({ versions: [BOOKED, closing] })), null);
    });

    test('but where it is sold on the day it would take effect', async () => {
        const closing = { ...TAKES_AWAY, validUntil: '2026-11-01T00:00:00.000Z' };

        assert.equal(
            (await offerOf(takesAway({ versions: [BOOKED, closing] })))?.class,
            'takes-something-away',
        );
    });

    test('nor where nothing runs the quarter-hourly steps that make it', async () => {
        assert.equal(await offerOf(takesAway({ withRun: false })), null);
    });

    test('nor where the store cannot schedule it', async () => {
        const { scheduleVersion: _schedule, ...store } = bookingStore([bookedOf('t1')]);

        assert.equal(await offerOf(takesAway({ store })), null);
    });

    test('while an improvement is offered all the same', async () => {
        assert.equal((await offerOf(offering({ withRun: false })))?.class, 'improvement');
    });
});
