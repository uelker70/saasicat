// `PrismaSubscriptionNoticeRepository` — what it asks the client for.
//
// The database semantics — one notice per subscription, kind and subject
// however many runs claim it, a confirmation that lands only under the claim
// that took it — are the contract's, and run against PostgreSQL in
// tests/integration/. What this holds is the translation: that the insert
// leaves a duplicate to the unique key (`skipDuplicates`), that a claim is one
// guarded update naming the delivery and the lease in its `WHERE`, that a
// confirmation and a release name the claim they hold, and that a read hands on
// the columns it asked for and checks what it reads.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaSubscriptionNoticeRepository } from '../dist/index.js';

const NOW = new Date('2026-10-15T09:00:00.000Z');
const STALE_BEFORE = new Date('2026-10-15T08:45:00.000Z');
const KEY = {
    tenantId: 't1',
    subscriptionId: 'sub-1',
    kind: 'version-offered',
    subject: 'pv-2',
};

const ROW = {
    id: 'n-1',
    ...KEY,
    content: { kind: 'version-offered' },
    createdAt: NOW,
    claimedAt: NOW,
    deliveredAt: null,
    recipients: null,
    channel: null,
    // A column a later release might add; the read must not hand it on.
    addedLater: 'x',
};

function fakeClient({ row = ROW, updated = 1 } = {}) {
    const calls = [];
    const record = (name, answer) => async (args) => {
        calls.push([name, args]);
        return answer;
    };
    return {
        calls,
        subscriptionNotice: {
            createMany: record('createMany', { count: 1 }),
            updateMany: record('updateMany', { count: updated }),
            findFirst: record('findFirst', row),
            findMany: record('findMany', [row]),
        },
    };
}

describe('PrismaSubscriptionNoticeRepository', () => {
    test('a claim records the notice where it is new, then takes it in one guarded update', async () => {
        const client = fakeClient();
        const claimed = await new PrismaSubscriptionNoticeRepository(client).claim(
            KEY,
            { kind: 'version-offered' },
            NOW,
            STALE_BEFORE,
        );
        const [[insert, inserted], [update, updated], [read, readArgs]] = client.calls;
        assert.equal(insert, 'createMany');
        assert.equal(inserted.skipDuplicates, true);
        assert.match(inserted.data[0].id, /^[0-9a-f-]{36}$/);
        assert.equal(inserted.data[0].createdAt, NOW);
        assert.equal(update, 'updateMany');
        assert.deepEqual(updated.where, {
            ...KEY,
            deliveredAt: null,
            OR: [{ claimedAt: null }, { claimedAt: { lt: STALE_BEFORE } }],
        });
        assert.deepEqual(updated.data, { claimedAt: NOW, content: { kind: 'version-offered' } });
        assert.equal(read, 'findFirst');
        assert.equal(readArgs.select.addedLater, undefined);
        assert.equal(claimed.id, 'n-1');
        assert.equal('addedLater' in claimed, false);
    });

    test('a claim that takes no row answers null without reading', async () => {
        const client = fakeClient({ updated: 0 });
        const repository = new PrismaSubscriptionNoticeRepository(client);
        assert.equal(await repository.claim(KEY, {}, NOW, STALE_BEFORE), null);
        assert.deepEqual(
            client.calls.map(([name]) => name),
            ['createMany', 'updateMany'],
        );
    });

    test('a confirmation and a release name the claim they hold', async () => {
        const client = fakeClient();
        const repository = new PrismaSubscriptionNoticeRepository(client);
        const delivery = { recipients: ['admin@example.com'], channel: 'email' };
        assert.equal(await repository.confirm('n-1', NOW, delivery, NOW), true);
        await repository.release('n-1', NOW);
        const [[, confirmed], [, released]] = client.calls;
        assert.deepEqual(confirmed.where, { id: 'n-1', claimedAt: NOW, deliveredAt: null });
        assert.deepEqual(confirmed.data, {
            deliveredAt: NOW,
            recipients: ['admin@example.com'],
            channel: 'email',
        });
        assert.deepEqual(released.where, confirmed.where);
        assert.deepEqual(released.data, { claimedAt: null });
    });

    test('a confirmation that finds the claim gone answers false', async () => {
        const client = fakeClient({ updated: 0 });
        const delivery = { recipients: [], channel: 'email' };
        assert.equal(
            await new PrismaSubscriptionNoticeRepository(client).confirm('n-1', NOW, delivery, NOW),
            false,
        );
    });

    test('what was delivered is read as sent, and a delivery nobody can read stops the read', async () => {
        const delivered = {
            ...ROW,
            deliveredAt: NOW,
            recipients: ['admin@example.com'],
            channel: 'email',
        };
        const client = fakeClient({ row: delivered });
        const repository = new PrismaSubscriptionNoticeRepository(client);
        const [notice] = await repository.listForSubscription('sub-1');
        assert.deepEqual(notice.delivery, { recipients: ['admin@example.com'], channel: 'email' });
        const [[, args]] = client.calls;
        assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);

        const broken = new PrismaSubscriptionNoticeRepository(
            fakeClient({ row: { ...delivered, recipients: 'admin@example.com' } }),
        );
        await assert.rejects(
            () => broken.listForSubscription('sub-1'),
            /subscription_notices row 'n-1'/,
        );
    });

    test('the subscriptions told of a subject are the delivered ones', async () => {
        const client = fakeClient();
        const ids = await new PrismaSubscriptionNoticeRepository(
            client,
        ).listDeliveredSubscriptionIds('version-offered', 'pv-2');
        const [[, args]] = client.calls;
        assert.deepEqual(args.where, {
            kind: 'version-offered',
            subject: 'pv-2',
            deliveredAt: { not: null },
        });
        assert.deepEqual(ids, ['sub-1']);
    });
});
