// A subscriber is told once of each newer version of a booked add-on offered
// beside the booking: when the offer appears, recorded once per booking and
// version.
//
// Every case is a monthly booking of Reports v1 beside a yearly Standard plan,
// with v2 — the same price, twenty reports — on sale from 1 October. It is
// 15 October.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { BundleVersionNoticeService } from '../dist/billing/index.js';
import { subscriptionOf } from './helpers/add-on-retirement-fixtures.js';
import {
    BOOKED,
    IMPROVEMENT,
    NOW,
    bookedOf,
    bookingStore,
    offeredVersion,
    offering,
} from './helpers/add-on-offer-fixtures.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

const LATER = new Date('2026-10-15T09:15:00.000Z');

/** The notice run over an offer world, its record and port kept in memory. */
function telling({
    notices = noticeRecord(),
    port = sendingPort(),
    rlsBypass = null,
    ...options
} = {}) {
    const world = offering(options);
    const service = new BundleVersionNoticeService(
        world.store,
        world.usage,
        world.catalogue,
        notices,
        port,
        world.offers,
        rlsBypass,
    );
    return { ...world, service, notices, port };
}

const delivered = (notices) =>
    [...notices.rows.values()]
        .filter((row) => row.deliveredAt)
        .map((row) => [row.subscriptionId, row.kind, row.subject]);

// @requirement SC-BUN-060 — A subscriber is told once of each newer add-on version offered to a booking
describe('a newer add-on version offered to a booking', () => {
    test('is told with the offer, and the record keeps to whom and how', async () => {
        const { service, notices, port } = telling();

        const run = await service.sendDue(NOW);

        assert.deepEqual(run, { told: 1, failed: 0 });
        const [notice] = port.sent;
        assert.deepEqual(
            {
                kind: notice.kind,
                tenantId: notice.tenantId,
                subscriptionId: notice.subscriptionId,
                subscriptionBundleId: notice.subscriptionBundleId,
                offered: notice.offer.offered.bundleVersionId,
                class: notice.offer.class,
            },
            {
                kind: 'bundle-version-offered',
                tenantId: 't1',
                subscriptionId: 'sub-t1',
                subscriptionBundleId: 'sb-t1',
                offered: IMPROVEMENT.id,
                class: 'improvement',
            },
        );
        assert.deepEqual(delivered(notices), [
            ['sub-t1', 'bundle-version-offered', IMPROVEMENT.id],
        ]);
        assert.deepEqual([...notices.rows.values()][0].delivery, {
            recipients: ['admin@example.com'],
            channel: 'email',
        });
    });

    test('is not told again by the next run', async () => {
        const { service, port } = telling();
        await service.sendDue(NOW);

        const again = await service.sendDue(LATER);

        assert.deepEqual(again, { told: 0, failed: 0 });
        assert.equal(port.sent.length, 1);
    });

    test('is told of each newer version it is offered, once each', async () => {
        const v3 = offeredVersion({
            id: 'bv-3',
            version: 3,
            validFrom: '2026-10-20T00:00:00.000Z',
            quotas: { reports: 30 },
        });
        const v2 = { ...IMPROVEMENT, validUntil: '2026-10-19T00:00:00.000Z' };
        const { service, notices } = telling({ versions: [BOOKED, v2, v3] });

        await service.sendDue(NOW);
        await service.sendDue(new Date('2026-10-20T09:00:00.000Z'));

        assert.deepEqual(delivered(notices), [
            ['sub-t1', 'bundle-version-offered', IMPROVEMENT.id],
            ['sub-t1', 'bundle-version-offered', 'bv-3'],
        ]);
    });

    test('whose window has not opened is told once it opens, not when it is published', async () => {
        const later = offeredVersion({
            validFrom: '2026-11-01T00:00:00.000Z',
            quotas: { reports: 20 },
        });
        const stillOnSale = { ...BOOKED, validUntil: '2026-10-31T00:00:00.000Z' };
        const { service, port } = telling({ versions: [stillOnSale, later] });

        await service.sendDue(NOW);
        const before = port.sent.length;
        await service.sendDue(new Date('2026-11-01T09:00:00.000Z'));

        assert.equal(before, 0);
        assert.equal(port.sent.length, 1);
    });

    test('is not told while the booking could not take it, and is told once it could', async () => {
        const ahead = [
            {
                planKey: 'PRO',
                billingCycle: 'YEARLY',
                from: new Date('2026-11-01T00:00:00.000Z'),
                by: 'change',
            },
        ];
        const { service, port } = telling({ ahead });

        await service.sendDue(NOW);
        const whileChanging = port.sent.length;
        ahead.length = 0;
        await service.sendDue(LATER);

        assert.equal(whileChanging, 0);
        assert.equal(port.sent.length, 1);
    });

    test('is asked for only among bookings on older versions of the add-on', async () => {
        const { service, port } = telling({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2')],
            bookings: [bookedOf('t1'), bookedOf('t2', { bundleVersionId: IMPROVEMENT.id })],
        });

        await service.sendDue(NOW);

        assert.deepEqual(
            port.sent.map((notice) => notice.subscriptionBundleId),
            ['sb-t1'],
        );
    });

    test('is told to every booking it is offered to, each with its own tenant', async () => {
        const { service, port } = telling({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2')],
            bookings: [bookedOf('t1'), bookedOf('t2')],
        });

        await service.sendDue(NOW);

        assert.deepEqual(
            port.sent.map((notice) => [notice.tenantId, notice.subscriptionBundleId]).sort(),
            [
                ['t1', 'sb-t1'],
                ['t2', 'sb-t2'],
            ],
        );
    });

    test('is not told to a booking that has ended', async () => {
        const { service, port } = telling({
            bookings: [
                bookedOf('t1', {
                    canceledAt: new Date('2026-09-01T00:00:00.000Z'),
                    canceledEffectiveAt: new Date('2026-10-01T00:00:00.000Z'),
                }),
            ],
        });

        await service.sendDue(NOW);

        assert.deepEqual(port.sent, []);
    });

    test('that the application could not send is tried again by the next run', async () => {
        let attempts = 0;
        const port = sendingPort(() => {
            attempts += 1;
            if (attempts === 1) throw new Error('the mail server is down');
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const { service, notices } = telling({ port });

        const first = await service.sendDue(NOW);
        const second = await service.sendDue(LATER);

        assert.deepEqual(
            [first, second],
            [
                { told: 0, failed: 1 },
                { told: 1, failed: 0 },
            ],
        );
        assert.equal(delivered(notices).length, 1);
    });

    test('is read and written across tenants inside the RLS bypass', async () => {
        const frames = [];
        const { service } = telling({
            rlsBypass: { runWithBypass: async (work) => (frames.push('bypass'), work()) },
        });

        await service.sendDue(NOW);

        assert.deepEqual(frames, ['bypass']);
    });
});

// @requirement SC-BUN-060 — A subscriber is told once of each newer add-on version offered to a booking
describe('turning add-on version notices on', () => {
    test('is refused over a booking store that cannot list a version’s bookings', () => {
        const { listOfVersion: _list, ...store } = bookingStore([bookedOf('t1')]);
        const { service } = telling({ store });

        assert.throws(() => service.onModuleInit(), /listOfVersion/);
    });

    test('is refused over a usage port that cannot read subscriptions by id', () => {
        const { service, usage } = telling();
        delete usage.listByIds;

        assert.throws(() => service.onModuleInit(), /listByIds/);
    });

    test('starts over ports that have both', () => {
        const { service } = telling();

        assert.doesNotThrow(() => service.onModuleInit());
    });
});
