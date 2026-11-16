// `PrismaTenantDeletionRepository` — what it asks the client for.
//
// The database semantics — one record per tenant however many runs begin it at
// once, one run holding a claim, what a store counted recorded once — are the
// contract's, and run against PostgreSQL in tests/integration/. What this holds
// is the translation: that a beginning leaves a second to the unique key
// (`skipDuplicates`) and writes its stores and kept lines only where it wrote
// the record, all in one transaction; that a claim, a renewal and a release
// name in their `WHERE` the state they expect; that the counts of a store are
// written only by the call that marked it counted; and that the commercial
// record counts 0 for a model the schema does not adopt, and is not asked of
// it. A repository that wrote the counts unconditionally would pass its own
// unit tests and overwrite what a store held before it erased.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaTenantDeletionRepository } from '../dist/index.js';

const STARTED = new Date('2027-02-01T03:15:00.123Z');
const OFFERED = new Date('2027-01-01T00:05:00.456Z');
const NEW_RECORD = {
    tenantId: 't-1',
    subscriberId: 'subscriber-1',
    subscriptionId: 'sub-1',
    subscriptionEndId: 'end-1',
    deletesOn: '2027-01-31',
    exportOfferedFrom: OFFERED,
    exportBlockedBySuspension: false,
    keep: [{ category: 'receipts', count: 12, labels: { en: 'Receipts' } }],
    startedAt: STARTED,
    stores: [
        { store: 'files', position: 1 },
        { store: 'notes-data', position: 0 },
    ],
};
const ROW = {
    id: 'd-1',
    tenantId: 't-1',
    subscriberId: 'subscriber-1',
    subscriptionId: 'sub-1',
    subscriptionEndId: 'end-1',
    deletesOn: new Date('2027-01-31T00:00:00.000Z'),
    exportOfferedFrom: OFFERED,
    exportBlockedBySuspension: false,
    commercialBefore: null,
    commercialAfter: null,
    startedAt: STARTED,
    claimedAt: null,
    attempts: 0,
    lastFailure: null,
    halt: null,
    closedAt: null,
    stores: [{ store: 'notes-data', position: 0, countedAt: null, erasedAt: null }],
    counts: [],
};

/** A client recording every call; `$transaction` hands its callback the client itself. */
function fakeClient({ inserted = [ROW], updated = 1, row = ROW } = {}) {
    const calls = [];
    const record = (name, answer) => async (args) => {
        calls.push([name, args]);
        return answer;
    };
    const counting = (name) => ({ count: record(`${name}.count`, 7) });
    const client = {
        calls,
        subscriberTenantDeletion: {
            createManyAndReturn: record('deletion.createManyAndReturn', inserted),
            findMany: record('deletion.findMany', [row]),
            findUnique: record('deletion.findUnique', row),
            updateMany: record('deletion.updateMany', { count: updated }),
        },
        subscriberTenantDeletionStore: {
            createMany: record('store.createMany', { count: 2 }),
            updateMany: record('store.updateMany', { count: updated }),
        },
        subscriberTenantDeletionCount: {
            createMany: record('count.createMany', { count: 1 }),
        },
        subscriber: counting('subscriber'),
        subscriptionContract: counting('subscriptionContract'),
        subscriberLedgerEntry: counting('subscriberLedgerEntry'),
        subscriptionInvoice: counting('subscriptionInvoice'),
        subscriberPayment: counting('subscriberPayment'),
        subscriberCredit: counting('subscriberCredit'),
        async $transaction(fn) {
            calls.push(['$transaction']);
            return fn(client);
        },
    };
    return client;
}

const names = (client) => client.calls.map(([name]) => name);

describe('PrismaTenantDeletionRepository', () => {
    test('a beginning writes the record, its stores and its kept lines in one transaction of its own', async () => {
        const client = fakeClient();
        const begun = await new PrismaTenantDeletionRepository(client).begin(NEW_RECORD);
        assert.deepEqual(names(client), [
            '$transaction',
            'deletion.createManyAndReturn',
            'store.createMany',
            'count.createMany',
            'deletion.findUnique',
        ]);
        const [, [, inserted], [, stores], [, counts]] = client.calls;
        assert.equal(inserted.skipDuplicates, true);
        const [written] = inserted.data;
        assert.match(written.id, /^[0-9a-f-]{36}$/);
        assert.deepEqual(written.deletesOn, new Date('2027-01-31T00:00:00.000Z'));
        assert.equal('keep' in written || 'stores' in written, false);
        assert.deepEqual(
            stores.data.map(({ deletionId, store, position }) => [deletionId, store, position]),
            [
                [written.id, 'files', 1],
                [written.id, 'notes-data', 0],
            ],
        );
        const [kept] = counts.data;
        assert.deepEqual(
            { ...kept, id: undefined },
            {
                id: undefined,
                deletionId: written.id,
                kind: 'kept',
                store: null,
                category: 'receipts',
                count: 12,
                labels: { en: 'Receipts' },
            },
        );
        assert.equal(begun.id, 'd-1');
        assert.equal(begun.deletesOn, '2027-01-31');
    });

    test('a tenant begun already writes nothing more and answers null', async () => {
        const client = fakeClient({ inserted: [] });
        assert.equal(await new PrismaTenantDeletionRepository(client).begin(NEW_RECORD), null);
        assert.deepEqual(names(client), ['$transaction', 'deletion.createManyAndReturn']);
    });

    test("a beginning given the caller's transaction writes on it and opens none", async () => {
        const client = fakeClient();
        const tx = fakeClient();
        await new PrismaTenantDeletionRepository(client).begin({ ...NEW_RECORD, keep: [] }, tx);
        assert.deepEqual(client.calls, []);
        assert.deepEqual(
            names(tx),
            ['deletion.createManyAndReturn', 'store.createMany', 'deletion.findUnique'],
            'nothing kept writes no kept line',
        );
    });

    test('a claim names the open record and the lease, and one that takes no row reads nothing', async () => {
        const now = new Date('2027-02-01T03:20:00.000Z');
        const staleBefore = new Date('2027-02-01T03:05:00.000Z');
        const client = fakeClient();
        const repository = new PrismaTenantDeletionRepository(client);
        assert.equal((await repository.claim('d-1', now, staleBefore)).id, 'd-1');
        assert.deepEqual(client.calls[0][1], {
            where: {
                id: 'd-1',
                closedAt: null,
                OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }],
            },
            data: { claimedAt: now },
        });
        const none = fakeClient({ updated: 0 });
        assert.equal(
            await new PrismaTenantDeletionRepository(none).claim('d-1', now, staleBefore),
            null,
        );
        assert.deepEqual(names(none), ['deletion.updateMany']);
    });

    test('a renewal and a release name the claim they hold', async () => {
        const claimedAt = new Date('2027-02-01T03:20:00.000Z');
        const now = new Date('2027-02-01T03:25:00.000Z');
        const client = fakeClient();
        const repository = new PrismaTenantDeletionRepository(client);
        assert.equal(await repository.renew('d-1', claimedAt, now), true);
        await repository.release('d-1', claimedAt);
        const [[, renewed], [, released]] = client.calls;
        assert.deepEqual(renewed, {
            where: { id: 'd-1', closedAt: null, claimedAt },
            data: { claimedAt: now },
        });
        assert.deepEqual(released, {
            where: { id: 'd-1', closedAt: null, claimedAt },
            data: { claimedAt: null },
        });
        assert.equal(
            await new PrismaTenantDeletionRepository(fakeClient({ updated: 0 })).renew(
                'd-1',
                claimedAt,
                now,
            ),
            false,
        );
    });

    test("a store's counts are written only by the call that marked it counted", async () => {
        const at = new Date('2027-02-01T03:16:00.000Z');
        const counts = [{ category: 'notes', count: 3 }];
        const client = fakeClient();
        await new PrismaTenantDeletionRepository(client).recordCounts('d-1', 'files', counts, at);
        assert.deepEqual(names(client), ['$transaction', 'store.updateMany', 'count.createMany']);
        const [, [, marked], [, written]] = client.calls;
        assert.deepEqual(marked, {
            where: { deletionId: 'd-1', store: 'files', countedAt: null },
            data: { countedAt: at },
        });
        assert.deepEqual(
            written.data.map(({ id: _id, ...count }) => count),
            [
                {
                    deletionId: 'd-1',
                    kind: 'erased',
                    store: 'files',
                    category: 'notes',
                    count: 3,
                    // Left out rather than `null`, which Prisma writes as JSON
                    // `null` and the table's check refuses for an erased count.
                    labels: undefined,
                },
            ],
        );

        const counted = fakeClient({ updated: 0 });
        await new PrismaTenantDeletionRepository(counted).recordCounts('d-1', 'files', counts, at);
        assert.deepEqual(names(counted), ['$transaction', 'store.updateMany']);
    });

    test('a confirmation is written where none is yet', async () => {
        const at = new Date('2027-02-01T03:17:00.000Z');
        const client = fakeClient();
        await new PrismaTenantDeletionRepository(client).recordErased('d-1', 'files', at);
        assert.deepEqual(client.calls[0][1], {
            where: { deletionId: 'd-1', store: 'files', erasedAt: null },
            data: { erasedAt: at },
        });
    });

    test('a failure counts its attempt in the statement that records it, its moment as text', async () => {
        const at = new Date('2027-02-01T03:18:00.000Z');
        const client = fakeClient();
        await new PrismaTenantDeletionRepository(client).recordFailure(
            'd-1',
            { step: 'erase', store: 'files', code: 'ETIMEDOUT', at },
            null,
        );
        assert.deepEqual(client.calls[0][1], {
            where: { id: 'd-1' },
            data: {
                lastFailure: {
                    step: 'erase',
                    store: 'files',
                    code: 'ETIMEDOUT',
                    at: at.toISOString(),
                },
                attempts: { increment: 1 },
                halt: null,
            },
        });
    });

    test('the commercial record is written to the column it was counted for', async () => {
        const counts = {
            subscriber: 1,
            contracts: 2,
            charges: 3,
            invoices: 1,
            payments: 1,
            credits: 0,
        };
        const client = fakeClient();
        const repository = new PrismaTenantDeletionRepository(client);
        await repository.recordCommercial('d-1', 'before', counts);
        await repository.recordCommercial('d-1', 'after', counts);
        assert.deepEqual(
            client.calls.map(([, args]) => args),
            [
                { where: { id: 'd-1' }, data: { commercialBefore: counts } },
                { where: { id: 'd-1' }, data: { commercialAfter: counts } },
            ],
        );
    });

    test('a close names the open record, on the transaction given', async () => {
        const at = new Date('2027-02-01T03:19:00.000Z');
        const client = fakeClient();
        const tx = fakeClient({ updated: 0 });
        const repository = new PrismaTenantDeletionRepository(client);
        assert.equal(await repository.close('d-1', at, tx), false);
        assert.deepEqual(client.calls, []);
        assert.deepEqual(tx.calls[0][1], {
            where: { id: 'd-1', closedAt: null },
            data: { closedAt: at },
        });
    });

    test('the records are read by tenant, or by subscriber the most recently begun first', async () => {
        const client = fakeClient();
        const repository = new PrismaTenantDeletionRepository(client);
        assert.deepEqual(await repository.findForTenants([]), []);
        assert.deepEqual(client.calls, [], 'no query for no tenants');
        await repository.findForTenants(['t-1']);
        await repository.findForSubscriber('subscriber-1');
        const [[, byTenant], [, bySubscriber]] = client.calls;
        assert.deepEqual(byTenant.where, { tenantId: { in: ['t-1'] } });
        assert.deepEqual(bySubscriber.where, { subscriberId: 'subscriber-1' });
        assert.deepEqual(bySubscriber.orderBy, [{ startedAt: 'desc' }, { id: 'desc' }]);
        assert.equal(byTenant.select.createdAt, undefined, 'a column the record has no part for');
    });

    test('the commercial record counts each part of one subscriber', async () => {
        const client = fakeClient();
        const counted = await new PrismaTenantDeletionRepository(client).countCommercialRecord(
            'subscriber-1',
        );
        assert.deepEqual(counted, {
            subscriber: 7,
            contracts: 7,
            charges: 7,
            invoices: 7,
            payments: 7,
            credits: 7,
        });
        const [[, subscriber], ...parts] = client.calls;
        assert.deepEqual(subscriber.where, { id: 'subscriber-1' });
        for (const [, args] of parts)
            assert.deepEqual(args.where, { subscriberId: 'subscriber-1' });
    });

    test('a model the schema does not adopt counts 0 and is not asked', async () => {
        const client = fakeClient();
        const counted = await new PrismaTenantDeletionRepository(client, [
            'SubscriptionInvoice',
            'SubscriberCredit',
        ]).countCommercialRecord('subscriber-1');
        assert.equal(counted.invoices, 0);
        assert.equal(counted.credits, 0);
        assert.equal(counted.charges, 7);
        assert.equal(names(client).includes('subscriptionInvoice.count'), false);
        assert.equal(names(client).includes('subscriberCredit.count'), false);
    });

    test('a model the client lacks and nobody said is left out is an error, not a 0', async () => {
        const client = fakeClient();
        delete client.subscriberPayment;
        await assert.rejects(
            new PrismaTenantDeletionRepository(client).countCommercialRecord('subscriber-1'),
            /SubscriberPayment.*notAdopted/,
        );
    });
});
