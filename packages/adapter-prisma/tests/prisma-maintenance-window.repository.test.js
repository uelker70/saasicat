// `PrismaMaintenanceWindowRepository` — what it asks the client for.
//
// The database semantics — one open window however many are opened at once, a
// move that lands only at the stage the caller read — are the contract's, and
// run against PostgreSQL in tests/integration/. What this holds is the
// translation: that an open window is `endedAt: null`, that the insert leaves
// the refusal to the index (`skipDuplicates`) under an id made here, and that
// the stage the caller read is in the update's `WHERE`. A repository that
// updated by id alone would pass its own unit tests and let a lock and an
// unlock issued together both land.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaMaintenanceWindowRepository } from '../dist/index.js';

const ROW = {
    id: 'w-1',
    startsAt: new Date('2026-10-02T20:00:00.000Z'),
    endsAt: new Date('2026-10-02T21:00:00.000Z'),
    message: 'Upgrade',
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    createdBy: 'web:ops@example.com:s1',
    lockedAt: null,
    lockedBy: null,
    endedAt: null,
    endedBy: null,
    // A column a later release might add; the read must not hand it on.
    addedLater: 'x',
};

function fakeClient({ inserted = [ROW], updated = 1 } = {}) {
    const calls = [];
    const record = (name, answer) => async (args) => {
        calls.push([name, args]);
        return answer;
    };
    return {
        calls,
        maintenanceWindow: {
            findFirst: record('findFirst', ROW),
            findMany: record('findMany', [ROW]),
            findUnique: record('findUnique', { ...ROW, lockedAt: ROW.startsAt }),
            createManyAndReturn: record('createManyAndReturn', inserted),
            updateMany: record('updateMany', { count: updated }),
        },
    };
}

describe('PrismaMaintenanceWindowRepository', () => {
    test('the open window is the one that has not ended, read column by column', async () => {
        const client = fakeClient();
        const open = await new PrismaMaintenanceWindowRepository(client).findOpen();
        const [[name, args]] = client.calls;
        assert.equal(name, 'findFirst');
        assert.deepEqual(args.where, { endedAt: null });
        assert.equal(args.select.addedLater, undefined);
        assert.equal(open.id, 'w-1');
        assert.equal('addedLater' in open, false);
    });

    test('recent windows are the newest first, up to the limit', async () => {
        const client = fakeClient();
        await new PrismaMaintenanceWindowRepository(client).listRecent(7);
        const [[, args]] = client.calls;
        assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
        assert.equal(args.take, 7);
    });

    test('opening leaves the refusal to the index, under an id of its own', async () => {
        const client = fakeClient();
        const { id: _id, endedAt: _e, endedBy: _b, addedLater: _a, ...window } = ROW;
        await new PrismaMaintenanceWindowRepository(client).open(window);
        const [[name, args]] = client.calls;
        assert.equal(name, 'createManyAndReturn');
        assert.equal(args.skipDuplicates, true);
        assert.match(args.data[0].id, /^[0-9a-f-]{36}$/);
        assert.equal(args.data[0].endedAt, null);

        const refused = fakeClient({ inserted: [] });
        assert.equal(await new PrismaMaintenanceWindowRepository(refused).open(window), null);
    });

    test('a move is guarded on the window being open and at the stage the caller read', async () => {
        const client = fakeClient();
        const repository = new PrismaMaintenanceWindowRepository(client);
        await repository.update('w-1', 'announced', { lockedAt: ROW.startsAt });
        await repository.update('w-1', 'locked', { endedAt: ROW.endsAt });
        const wheres = client.calls
            .filter(([name]) => name === 'updateMany')
            .map(([, args]) => args.where);
        assert.deepEqual(wheres, [
            { id: 'w-1', endedAt: null, lockedAt: null },
            { id: 'w-1', endedAt: null, lockedAt: { not: null } },
        ]);
    });

    test('a move that matched nothing answers null and reads nothing back', async () => {
        const client = fakeClient({ updated: 0 });
        const moved = await new PrismaMaintenanceWindowRepository(client).update(
            'w-1',
            'announced',
            { message: 'x' },
        );
        assert.equal(moved, null);
        assert.deepEqual(
            client.calls.map(([name]) => name),
            ['updateMany'],
        );
    });
});
