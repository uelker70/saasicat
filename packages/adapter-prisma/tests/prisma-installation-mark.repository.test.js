// `PrismaInstallationMarkRepository` — what it asks the client for.
//
// The database semantics — a mark written where none stands and never over
// one that does, however many operators mark at once, and a replacement that
// lands only while the identifier read still stands — are the contract's, and
// run against PostgreSQL in tests/integration/. What this holds is the
// translation: that the one row is found by its fixed id, that the insert
// leaves the refusal to the primary key (`skipDuplicates`) and answers what
// stands after it, and that the identifier and the operation the caller read
// are in the update's `WHERE`. A repository that replaced by id alone would
// pass its own unit tests and let a replacement land on a mark somebody
// changed a moment earlier.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaInstallationMarkRepository } from '../dist/index.js';

const MARKED_AT = new Date('2026-11-15T09:30:00.123Z');
const PROD = {
    identifier: 'prod',
    testOperation: false,
    markedAt: MARKED_AT,
    markedBy: 'cli:ops@example.com:host',
};
const ROW = {
    id: 'installation',
    ...PROD,
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
        installationMark: {
            findUnique: record('findUnique', row),
            createMany: record('createMany', { count: 0 }),
            updateMany: record('updateMany', { count: updated }),
        },
    };
}

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide
describe('PrismaInstallationMarkRepository', () => {
    test('the mark is the one row under its fixed id, read column by column', async () => {
        const client = fakeClient();
        const mark = await new PrismaInstallationMarkRepository(client).find();
        const [[name, args]] = client.calls;
        assert.equal(name, 'findUnique');
        assert.deepEqual(args.where, { id: 'installation' });
        assert.equal(args.select.addedLater, undefined);
        assert.deepEqual(mark, PROD);
    });

    test('no row is no mark', async () => {
        const client = fakeClient({ row: null });
        assert.equal(await new PrismaInstallationMarkRepository(client).find(), null);
    });

    test('marking leaves the refusal to the primary key, and answers what stands after it', async () => {
        const client = fakeClient();
        const staging = {
            identifier: 'staging',
            testOperation: true,
            markedAt: MARKED_AT,
            markedBy: 'cli:dev@x:y',
        };
        const answered = await new PrismaInstallationMarkRepository(client).markIfUnmarked(staging);
        const [[name, args], [readName]] = client.calls;
        assert.equal(name, 'createMany');
        assert.equal(args.skipDuplicates, true);
        assert.deepEqual(args.data, [{ id: 'installation', ...staging }]);
        assert.equal(readName, 'findUnique');
        // The insert met a row: what stood before is the answer, not the input.
        assert.deepEqual(answered, PROD);
    });

    test('a row gone after the insert is an error, not a mark that was never written', async () => {
        const client = fakeClient({ row: null });
        await assert.rejects(
            new PrismaInstallationMarkRepository(client).markIfUnmarked(PROD),
            /installation_marks/,
        );
    });

    test('a replacement is guarded on the identifier and the operation the caller read', async () => {
        const client = fakeClient();
        const staging = {
            identifier: 'staging',
            testOperation: true,
            markedAt: MARKED_AT,
            markedBy: 'cli:ops@x:y',
        };
        const replaced = await new PrismaInstallationMarkRepository(client).replace(
            { identifier: 'prod', testOperation: false },
            staging,
        );
        const [[name, args]] = client.calls;
        assert.equal(name, 'updateMany');
        assert.deepEqual(args.where, {
            id: 'installation',
            identifier: 'prod',
            testOperation: false,
        });
        assert.deepEqual(args.data, staging);
        assert.deepEqual(replaced, staging);
    });

    test('a replacement that matched nothing answers null and reads nothing back', async () => {
        const client = fakeClient({ updated: 0 });
        const replaced = await new PrismaInstallationMarkRepository(client).replace(PROD, PROD);
        assert.equal(replaced, null);
        assert.deepEqual(
            client.calls.map(([name]) => name),
            ['updateMany'],
        );
    });
});
