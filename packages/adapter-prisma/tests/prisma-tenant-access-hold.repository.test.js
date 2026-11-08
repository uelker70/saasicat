// `PrismaTenantAccessHoldRepository` — what it asks the client for.
//
// The database semantics — one open reason per tenant, kind and reference
// however many record it at once, a lift that lands once — are the contract's,
// and run against PostgreSQL in tests/integration/. What this holds is the
// translation: that an open reason is `liftedAt: null`, that the insert leaves
// the refusal to the index (`skipDuplicates`) under an id made here, and that
// the lift's `WHERE` asks for a reason still open. A repository that lifted by
// id alone would pass its own unit tests and let two lifts both land.

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

function fakeClient({ inserted = [ROW], lifted = 1 } = {}) {
    const calls = [];
    const record = (name, answer) => async (args) => {
        calls.push([name, args]);
        return answer;
    };
    return {
        calls,
        tenantAccessHold: {
            findMany: record('findMany', [ROW]),
            findUnique: record('findUnique', { ...ROW, liftedAt: ROW.since }),
            createManyAndReturn: record('createManyAndReturn', inserted),
            updateMany: record('updateMany', { count: lifted }),
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

    test('a row with a kind the platform does not know is refused', async () => {
        const client = fakeClient();
        client.tenantAccessHold.findMany = async () => [{ ...ROW, kind: 'paused' }];
        await assert.rejects(
            new PrismaTenantAccessHoldRepository(client).listOpen('t-1'),
            /kind 'paused'/,
        );
    });
});
