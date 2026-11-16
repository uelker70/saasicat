// `PrismaTenantAccessHoldRepository` — what it asks the client for.
//
// The database semantics — one open reason per tenant, kind and reference
// however many record it at once, a lift that lands once — are the contract's,
// and run against PostgreSQL in tests/integration/. What this holds is the
// translation: that an open reason is `liftedAt: null`, that the insert leaves
// the refusal to the index (`skipDuplicates`) under an id made here, that
// the lift's `WHERE` asks for a reason still open, that a write given a
// transaction runs on it, and that a lock is taken on the row and the reason
// read open only afterwards. A repository that lifted by id alone would pass
// its own unit tests and let two lifts both land.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaTenantAccessHoldRepository } from '../dist/index.js';

const ROW = {
    id: 'h-1',
    tenantId: 't-1',
    kind: 'suspended',
    reference: null,
    note: 'Contract under review',
    since: new Date('2026-11-02T08:30:00.000Z'),
    recordedBy: 'web:ops@example.com:s1',
    liftedAt: null,
    liftedBy: null,
    // A column a later release might add; the read must not hand it on.
    addedLater: 'x',
};

function fakeClient({
    inserted = [ROW],
    lifted = 1,
    read = { ...ROW, liftedAt: ROW.since },
    locked = [{ id: ROW.id }],
} = {}) {
    const calls = [];
    const record = (name, answer) => async (args) => {
        calls.push([name, args]);
        return answer;
    };
    return {
        calls,
        tenantAccessHold: {
            findMany: record('findMany', [ROW]),
            findUnique: record('findUnique', read),
            createManyAndReturn: record('createManyAndReturn', inserted),
            updateMany: record('updateMany', { count: lifted }),
        },
        async $queryRaw(strings, ...values) {
            calls.push(['$queryRaw', { sql: strings.join('?'), values }]);
            return locked;
        },
    };
}

describe('PrismaTenantAccessHoldRepository', () => {
    test("a tenant's open reasons are the ones not lifted, read column by column", async () => {
        const client = fakeClient();
        const [open] = await new PrismaTenantAccessHoldRepository(client).listOpen('t-1');
        const [[name, args]] = client.calls;
        assert.equal(name, 'findMany');
        assert.deepEqual(args.where, { tenantId: 't-1', liftedAt: null });
        assert.equal(args.select.addedLater, undefined);
        assert.equal(open.kind, 'suspended');
        assert.equal('addedLater' in open, false);
    });

    test('many tenants are read in one query, and none asks nothing', async () => {
        const client = fakeClient();
        const repository = new PrismaTenantAccessHoldRepository(client);
        await repository.listOpenFor(['t-1', 't-2']);
        assert.deepEqual(client.calls[0][1].where, {
            tenantId: { in: ['t-1', 't-2'] },
            liftedAt: null,
        });
        assert.deepEqual(await repository.listOpenFor([]), []);
        assert.equal(client.calls.length, 1, 'no query for an empty list');
    });

    test('a reason is recorded under an id made here, the index deciding a second', async () => {
        const client = fakeClient();
        const { id: _id, liftedAt: _l, liftedBy: _b, addedLater: _a, ...hold } = ROW;
        await new PrismaTenantAccessHoldRepository(client).record(hold);
        const [[name, args]] = client.calls;
        assert.equal(name, 'createManyAndReturn');
        assert.equal(args.skipDuplicates, true);
        assert.match(args.data[0].id, /^[0-9a-f-]{36}$/);
        assert.equal(args.data[0].liftedAt, null);
        assert.equal(
            await new PrismaTenantAccessHoldRepository(fakeClient({ inserted: [] })).record(hold),
            null,
            'no row back is the same reason already open',
        );
    });

    test('a lift asks for a reason still open, and one already lifted answers null', async () => {
        const client = fakeClient();
        const at = new Date('2026-11-05T16:45:00.000Z');
        const lifted = await new PrismaTenantAccessHoldRepository(client).lift('h-1', at, 'ops');
        assert.deepEqual(client.calls[0][1], {
            where: { id: 'h-1', liftedAt: null },
            data: { liftedAt: at, liftedBy: 'ops' },
        });
        assert.equal(lifted.id, 'h-1');
        assert.equal(
            await new PrismaTenantAccessHoldRepository(fakeClient({ lifted: 0 })).lift(
                'h-1',
                at,
                'ops',
            ),
            null,
        );
    });

    test('the tenants held back by some kinds are read once each, from open reasons', async () => {
        const client = fakeClient();
        client.tenantAccessHold.findMany = async (args) => {
            client.calls.push(['findMany', args]);
            return [{ tenantId: 't-1' }, { tenantId: 't-2' }];
        };
        const repository = new PrismaTenantAccessHoldRepository(client);
        assert.deepEqual(await repository.listTenantIdsHeldBy(['suspended', 'deleting']), [
            't-1',
            't-2',
        ]);
        assert.deepEqual(client.calls[0][1], {
            where: { kind: { in: ['suspended', 'deleting'] }, liftedAt: null },
            select: { tenantId: true },
            distinct: ['tenantId'],
        });
        assert.deepEqual(await repository.listTenantIdsHeldBy([]), []);
        assert.equal(client.calls.length, 1, 'no query for no kinds');
    });

    test('every reason of a tenant is read, the lifted ones too, oldest first', async () => {
        const client = fakeClient();
        await new PrismaTenantAccessHoldRepository(client).listAllOf('t-1');
        const [[name, args]] = client.calls;
        assert.equal(name, 'findMany');
        assert.deepEqual(args.where, { tenantId: 't-1' });
        assert.deepEqual(args.orderBy, [{ since: 'asc' }, { id: 'asc' }]);
        assert.equal(args.select.addedLater, undefined);
    });

    test('a record and a lift given a transaction write on it, not on the client', async () => {
        const client = fakeClient();
        const tx = fakeClient();
        const repository = new PrismaTenantAccessHoldRepository(client);
        const { id: _id, liftedAt: _l, liftedBy: _b, addedLater: _a, ...hold } = ROW;
        await repository.record(hold, tx);
        await repository.lift('h-1', new Date('2026-11-05T16:45:00.000Z'), 'ops', tx);
        assert.deepEqual(client.calls, []);
        assert.deepEqual(
            tx.calls.map(([name]) => name),
            ['createManyAndReturn', 'updateMany', 'findUnique'],
        );
    });

    test('a lock is taken on the row in the transaction, and the reason read open only after it', async () => {
        const tx = fakeClient({ read: ROW });
        const repository = new PrismaTenantAccessHoldRepository(fakeClient());
        const locked = await repository.lockOpen('h-1', tx);
        const [[lock, { sql, values }], [read, args]] = tx.calls;
        assert.equal(lock, '$queryRaw');
        assert.match(sql, /FOR UPDATE/);
        assert.deepEqual(values, ['h-1']);
        assert.equal(read, 'findUnique');
        assert.deepEqual(args.where, { id: 'h-1' });
        assert.equal(locked.id, 'h-1');

        const waitedForALift = new PrismaTenantAccessHoldRepository(fakeClient());
        assert.equal(
            await waitedForALift.lockOpen('h-1', fakeClient()),
            null,
            'a reason lifted while the lock was waited for was read open',
        );
        const none = fakeClient({ locked: [] });
        assert.equal(await repository.lockOpen('h-9', none), null);
        assert.deepEqual(
            none.calls.map(([name]) => name),
            ['$queryRaw'],
            'no row locked is no reason, without a read',
        );
    });

    test('the actors are replaced row by row, by id, and nothing else is written', async () => {
        const client = fakeClient();
        const tx = fakeClient();
        await new PrismaTenantAccessHoldRepository(client).replaceActors(
            [
                { id: 'h-1', recordedBy: 'operator', liftedBy: 'operator' },
                { id: 'h-2', recordedBy: 'run', liftedBy: null },
            ],
            tx,
        );
        assert.deepEqual(client.calls, []);
        assert.deepEqual(
            tx.calls.map(([, args]) => args),
            [
                { where: { id: 'h-1' }, data: { recordedBy: 'operator', liftedBy: 'operator' } },
                { where: { id: 'h-2' }, data: { recordedBy: 'run', liftedBy: null } },
            ],
        );
    });

    test("a tenant's notes are emptied in one write, on the rows that have one, and nothing else", async () => {
        const client = fakeClient();
        const tx = fakeClient();
        await new PrismaTenantAccessHoldRepository(client).forgetNotes('t-1', tx);
        assert.deepEqual(client.calls, []);
        assert.deepEqual(tx.calls, [
            [
                'updateMany',
                { where: { tenantId: 't-1', note: { not: null } }, data: { note: null } },
            ],
        ]);
    });

    test('a row with a kind the platform does not know is refused', async () => {
        const client = fakeClient();
        client.tenantAccessHold.findMany = async () => [{ ...ROW, kind: 'paused' }];
        await assert.rejects(
            new PrismaTenantAccessHoldRepository(client).listOpen('t-1'),
            /kind 'paused'/,
        );
    });
});
