// @requirement SC-SUB-022 — A subscriber is told once of each newer version offered to them, when it is offered

// A subscription keeps its version, and a newer one is an offer beside the
// plan. The subscriber hears of it once, in the application's words: when the
// offer appears — not when the version is published — and never again for the
// same version. What a run sends, what it leaves, and what it records.

import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';

import {
    VersionNoticeCron,
    VersionNoticeService,
    VersionOfferService,
} from '../dist/billing/index.js';
import { BOUND, NOW, V2, subscription } from './helpers/version-offers.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

afterEach(() => mock.restoreAll());

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const LATER = new Date(NOW.getTime() + 15 * 60_000);
/** Version 2, 50 vehicles more: an improvement over the version bound. */
const IMPROVED = V2({ quotas: { users: 5, vehicles: 150 } });

/** A subscription of tenant `tenantId`, bound to version 1 unless the test says otherwise. */
function subscriptionOf(tenantId, overrides = {}) {
    return { tenantId, subscription: subscription({ id: `sub-${tenantId}`, ...overrides }) };
}

/**
 * A run over `subscriptions` of the Standard plan, whose version on sale is
 * `onSale(asOf)`. Every part the run reads is kept in memory, so a test reads
 * back what was sent and what was recorded.
 */
function runOver({
    subscriptions = [subscriptionOf('t1')],
    onSale = () => IMPROVED,
    rows = [BOUND, IMPROVED],
    notices = noticeRecord(),
    port = sendingPort(),
    bypass = null,
} = {}) {
    const usage = {
        findForTenant: async (tenantId) =>
            subscriptions.find((entry) => entry.tenantId === tenantId)?.subscription ?? null,
        listBoundToEarlierVersions: async (planKey, version) =>
            subscriptions.filter(
                ({ subscription }) =>
                    subscription.plan === planKey && subscription.planVersion.version < version,
            ),
    };
    const plans = {
        list: async () => [{ planKey: 'STANDARD' }],
        findVersionById: async (id) => rows.find((row) => row.id === id) ?? null,
        findActivePlanVersion: async (planKey, asOf) =>
            planKey === 'STANDARD' ? onSale(asOf) : null,
    };
    const offers = new VersionOfferService(usage, plans, null);
    const service = new VersionNoticeService(usage, plans, notices, port, offers, bypass);
    return { service, notices, port, usage, plans };
}

describe('a newer version offered to a subscriber', () => {
    // @requirement SC-SUB-023 — Every notice to a subscriber is recorded: once, with when and to whom it went
    test('is told with the offer, and the record keeps to whom and how', async () => {
        const { service, notices, port } = runOver();

        assert.deepEqual(await service.sendDue(NOW), { told: 1, failed: 0 });

        assert.equal(port.sent.length, 1);
        const [notice] = port.sent;
        assert.equal(notice.kind, 'version-offered');
        assert.equal(notice.tenantId, 't1');
        assert.equal(notice.subscriptionId, 'sub-t1');
        assert.equal(notice.offer.bound.planVersionId, 'pv-1');
        assert.equal(notice.offer.offered.planVersionId, 'pv-2');
        assert.equal(notice.offer.class, 'improvement');
        const [kept] = await notices.listForSubscription('sub-t1');
        assert.equal(kept.subject, 'pv-2');
        assert.deepEqual(kept.content, notice);
        assert.deepEqual(kept.delivery, { recipients: ['admin@example.com'], channel: 'email' });
        assert.ok(kept.deliveredAt);
    });

    test('is not told again by the next run', async () => {
        const { service, port } = runOver();
        await service.sendDue(NOW);

        assert.deepEqual(await service.sendDue(LATER), { told: 0, failed: 0 });
        assert.equal(port.sent.length, 1);
    });

    test('is told of each newer version it is offered, once each', async () => {
        const v3 = V2({ id: 'pv-3', version: 3, quotas: { users: 6, vehicles: 150 } });
        let onSale = IMPROVED;
        const { service, port } = runOver({
            onSale: () => onSale,
            rows: [BOUND, IMPROVED, v3],
        });
        await service.sendDue(NOW);
        onSale = v3;
        await service.sendDue(LATER);
        await service.sendDue(new Date(LATER.getTime() + 15 * 60_000));

        assert.deepEqual(
            port.sent.map((notice) => notice.offer.offered.planVersionId),
            ['pv-2', 'pv-3'],
        );
    });

    test('whose window has not opened is told once it opens, not when it is published', async () => {
        const opens = LATER;
        const { service, port } = runOver({ onSale: (asOf) => (asOf < opens ? BOUND : IMPROVED) });

        assert.deepEqual(await service.sendDue(NOW), { told: 0, failed: 0 });
        assert.equal(port.sent.length, 0);
        assert.deepEqual(await service.sendDue(opens), { told: 1, failed: 0 });
    });

    test('is not told while a change is still to land, and is told once it has', async () => {
        const entry = subscriptionOf('t1', {
            pendingPlan: 'STANDARD',
            pendingBillingCycle: 'YEARLY',
        });
        const { service, port } = runOver({ subscriptions: [entry] });

        await service.sendDue(NOW);
        assert.equal(port.sent.length, 0, 'offered nothing, so told nothing');

        entry.subscription.pendingPlan = null;
        entry.subscription.pendingBillingCycle = null;
        await service.sendDue(LATER);
        assert.equal(port.sent.length, 1);
    });

    test('is asked for only among subscriptions on older versions, so one already on it hears nothing', async () => {
        const entry = subscriptionOf('t1', {
            planVersion: { id: 'pv-2', planId: 'STANDARD', version: 2 },
        });
        const { service, port, usage } = runOver({ subscriptions: [entry] });
        const asked = [];
        const list = usage.listBoundToEarlierVersions;
        usage.listBoundToEarlierVersions = (planKey, version) => {
            asked.push([planKey, version]);
            return list(planKey, version);
        };

        assert.deepEqual(await service.sendDue(NOW), { told: 0, failed: 0 });
        assert.deepEqual(asked, [['STANDARD', 2]]);
        assert.equal(port.sent.length, 0);
    });

    test('is told to every subscription it is offered to, each with its own tenant', async () => {
        const { service, port } = runOver({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2')],
        });

        assert.deepEqual(await service.sendDue(NOW), { told: 2, failed: 0 });
        assert.deepEqual(
            port.sent.map((notice) => [notice.tenantId, notice.subscriptionId]),
            [
                ['t1', 'sub-t1'],
                ['t2', 'sub-t2'],
            ],
        );
    });
});

describe('a notice the application could not send', () => {
    test('is tried again by the next run, and then kept as sent', async () => {
        let failing = true;
        const port = sendingPort(() => {
            if (failing) throw new Error('mail server unreachable');
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const { service, notices } = runOver({ port });
        const logged = mock.method(Logger.prototype, 'error', () => {});

        assert.deepEqual(await service.sendDue(NOW), { told: 0, failed: 1 });
        assert.match(
            logged.mock.calls[0].arguments[0],
            /sub-t1 was not sent; the next run tries again/,
        );
        const [released] = await notices.listForSubscription('sub-t1');
        assert.equal(released.claimedAt, null, 'let go for the next run');
        assert.equal(released.deliveredAt, null);

        failing = false;
        assert.deepEqual(await service.sendDue(LATER), { told: 1, failed: 0 });
        assert.equal(port.sent.length, 2);
    });

    test('that the application throws on before it answers fails like any other, and the run goes on', async () => {
        mock.method(Logger.prototype, 'error', () => {});
        const sent = [];
        const port = {
            deliver(notice) {
                sent.push(notice.tenantId);
                if (notice.tenantId === 't1') throw new Error('no administrator found');
                return Promise.resolve({ recipients: ['admin@example.com'], channel: 'email' });
            },
        };
        const { service, notices } = runOver({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2')],
            port,
        });

        assert.deepEqual(await service.sendDue(NOW), { told: 1, failed: 1 });
        assert.deepEqual(sent, ['t1', 't2'], 'the run went on to the next subscription');
        assert.equal(
            (await notices.listForSubscription('sub-t1'))[0].claimedAt,
            null,
            'let go for the next run',
        );
    });

    // @requirement SC-SUB-023 — Every notice to a subscriber is recorded: once, with when and to whom it went
    test('told to nobody is kept as sent to no one, and not tried again', async () => {
        const port = sendingPort({ recipients: [], channel: 'email' });
        const { service, notices } = runOver({ port });

        assert.deepEqual(await service.sendDue(NOW), { told: 1, failed: 0 });
        assert.deepEqual((await notices.listForSubscription('sub-t1'))[0].delivery, {
            recipients: [],
            channel: 'email',
        });
        await service.sendDue(LATER);
        assert.equal(port.sent.length, 1);
    });

    // @requirement SC-SUB-023 — Every notice to a subscriber is recorded: once, with when and to whom it went
    test('sent but not recorded counts as sent, and is not sent again while its claim holds', async () => {
        const notices = noticeRecord();
        notices.confirm = async () => {
            throw new Error('connection reset');
        };
        const { service, port } = runOver({ notices });
        const logged = mock.method(Logger.prototype, 'error', () => {});

        assert.deepEqual(await service.sendDue(NOW), { told: 1, failed: 0 });
        assert.match(logged.mock.calls[0].arguments[0], /was sent, but recording it failed/);
        await service.sendDue(new Date(NOW.getTime() + 60_000));
        assert.equal(port.sent.length, 1);
    });

    // @requirement SC-SUB-023 — Every notice to a subscriber is recorded: once, with when and to whom it went
    test('is claimed at the moment it is taken, not when the run began', async () => {
        const claims = [];
        const notices = noticeRecord();
        const claim = notices.claim;
        notices.claim = (key, content, takenAt, staleBefore) => {
            claims.push({ takenAt, staleBefore });
            return claim(key, content, takenAt, staleBefore);
        };
        const port = sendingPort(async () => {
            await pause(40);
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const { service } = runOver({
            subscriptions: [subscriptionOf('t1'), subscriptionOf('t2')],
            notices,
            port,
        });

        await service.sendDue(NOW);
        assert.notEqual(claims[0].takenAt.getTime(), NOW.getTime());
        assert.ok(
            claims[1].takenAt - claims[0].takenAt >= 30,
            'the second claim is stamped after the first was sent, so a long run keeps its lease',
        );
        assert.equal(claims[1].takenAt - claims[1].staleBefore, 15 * 60_000);
    });

    // @requirement SC-SUB-023 — Every notice to a subscriber is recorded: once, with when and to whom it went
    test('that the application answers only after the timeout stays held, and a late success is kept as sent', async () => {
        mock.method(Logger.prototype, 'warn', () => {});
        const port = sendingPort(async () => {
            await pause(40);
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const { service, notices } = runOver({ port });
        service.deliveryTimeoutMs = 10;

        assert.deepEqual(await service.sendDue(NOW), { told: 0, failed: 1 });
        const [waiting] = await notices.listForSubscription('sub-t1');
        assert.ok(waiting.claimedAt, 'not let go while the answer is awaited');
        await service.sendDue(LATER);
        assert.equal(port.sent.length, 1, 'no second run sends it meanwhile');

        await pause(60);
        const [kept] = await notices.listForSubscription('sub-t1');
        assert.ok(kept.deliveredAt, 'the late answer is recorded as sent');
        await service.sendDue(new Date(LATER.getTime() + 15 * 60_000));
        assert.equal(port.sent.length, 1);
    });

    test('that fails only after the timeout is let go for the next run', async () => {
        mock.method(Logger.prototype, 'warn', () => {});
        mock.method(Logger.prototype, 'error', () => {});
        let failing = true;
        const port = sendingPort(async () => {
            await pause(40);
            if (failing) throw new Error('mail server unreachable');
            return { recipients: ['admin@example.com'], channel: 'email' };
        });
        const { service, notices } = runOver({ port });
        service.deliveryTimeoutMs = 10;

        await service.sendDue(NOW);
        await pause(60);
        assert.equal((await notices.listForSubscription('sub-t1'))[0].claimedAt, null);

        failing = false;
        service.deliveryTimeoutMs = 1_000;
        assert.deepEqual(await service.sendDue(LATER), { told: 1, failed: 0 });
        assert.equal(port.sent.length, 2);
    });

    // @requirement SC-SUB-023 — Every notice to a subscriber is recorded: once, with when and to whom it went
    test('held by another run is left to it', async () => {
        const notices = noticeRecord();
        await notices.claim(
            { tenantId: 't1', subscriptionId: 'sub-t1', kind: 'version-offered', subject: 'pv-2' },
            {},
            NOW,
            new Date(0),
        );
        const { service, port } = runOver({ notices });

        assert.deepEqual(await service.sendDue(NOW), { told: 0, failed: 0 });
        assert.equal(port.sent.length, 0);
    });
});

test('a run reads and writes across tenants inside the RLS bypass', async () => {
    let inside = false;
    const bypass = {
        runWithBypass: async (work) => {
            inside = true;
            try {
                return await work();
            } finally {
                inside = false;
            }
        },
    };
    const seen = [];
    const port = sendingPort(() => {
        seen.push(inside);
        return { recipients: ['admin@example.com'], channel: 'email' };
    });
    const { service } = runOver({ bypass, port });

    await service.sendDue(NOW);
    assert.deepEqual(seen, [true]);
});

describe('turning version notices on', () => {
    test('is refused over a usage port that cannot list subscriptions across tenants', () => {
        const { service, usage } = runOver();
        delete usage.listBoundToEarlierVersions;
        assert.throws(() => service.onModuleInit(), /listBoundToEarlierVersions/);
    });

    test('is refused over a plan repository that cannot read a version', () => {
        const { service, plans } = runOver();
        delete plans.findVersionById;
        assert.throws(() => service.onModuleInit(), /findVersionById/);
    });

    test('starts over ports that have both', () => {
        const { service } = runOver();
        assert.doesNotThrow(() => service.onModuleInit());
    });
});

describe('the run every quarter of an hour', () => {
    /** A service whose runs stay open until the test finishes them, recording each call. */
    function pausedService() {
        const calls = [];
        const open = [];
        return {
            calls,
            finish: () => open.splice(0).forEach((resolve) => resolve({ told: 0, failed: 0 })),
            sendDue: (now) => {
                calls.push(now);
                return new Promise((resolve) => open.push(resolve));
            },
        };
    }
    const aTick = () => new Promise((resolve) => setImmediate(resolve));

    test('waits while the application is locked for maintenance', async () => {
        const service = pausedService();
        const run = new VersionNoticeCron(service, { isLocked: async () => true }).sendDueNotices();
        await aTick();

        assert.equal(service.calls.length, 0);
        service.finish();
        await run;
    });

    test('lets a run pass while the one before it is still sending', async () => {
        const service = pausedService();
        const cron = new VersionNoticeCron(service, null);

        const runs = [cron.sendDueNotices(), cron.sendDueNotices()];
        await aTick();
        assert.equal(service.calls.length, 1);
        service.finish();
        await Promise.all(runs);

        const next = cron.sendDueNotices();
        await aTick();
        assert.equal(service.calls.length, 2, 'a run after the first has finished goes ahead');
        service.finish();
        await next;
    });
});
