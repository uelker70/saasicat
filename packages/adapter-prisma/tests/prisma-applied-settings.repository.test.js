// `PrismaAppliedSettingsRepository` — what it asks the client for.
//
// The database semantics — one row, replaced only by a writer that read its
// current fingerprint; a change landing with the record it supersedes; a
// change acknowledged once — are the contract's, and run against PostgreSQL in
// tests/integration/. What this holds is the translation: the row id and the
// fingerprint the guarded writes key on, the transaction the change is written
// in, the guard on the acknowledgement update, and the filters a listing turns
// into Prisma arguments. A repository that keyed the insert on a fresh uuid, or
// that updated without the fingerprint in its WHERE, would pass its own unit
// tests and let every replica of a deployment record the same change — this is
// where that shows up without a database.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaAppliedSettingsRepository } from '../dist/index.js';

function fakeClient() {
    const calls = {
        createMany: [],
        updateMany: [],
        findUnique: [],
        create: [],
        findMany: [],
        acknowledge: [],
        transactions: 0,
    };
    const state = { applied: null, changes: new Map() };
    const client = {
        calls,
        state,
        async $transaction(fn) {
            calls.transactions += 1;
            return fn(client);
        },
        appliedSettings: {
            async findUnique(args) {
                calls.findUnique.push(args);
                return state.applied;
            },
            async createMany(args) {
                calls.createMany.push(args);
                if (state.applied) return { count: 0 };
                state.applied = { ...args.data[0] };
                return { count: 1 };
            },
            async updateMany(args) {
                calls.updateMany.push(args);
                if (!state.applied || state.applied.fingerprint !== args.where.fingerprint) {
                    return { count: 0 };
                }
                Object.assign(state.applied, args.data);
                return { count: 1 };
            },
        },
        settingsChange: {
            async create(args) {
                calls.create.push(args);
                const row = {
                    id: `change-${calls.create.length}`,
                    acknowledgedAt: null,
                    acknowledgedBy: null,
                    ...args.data,
                };
                state.changes.set(row.id, row);
                return row;
            },
            async findMany(args) {
                calls.findMany.push(args);
                return [...state.changes.values()];
            },
            async findUnique(args) {
                return state.changes.get(args.where.id) ?? null;
            },
            async updateMany(args) {
                calls.acknowledge.push(args);
                const row = state.changes.get(args.where.id);
                if (!row || row.acknowledgedAt !== null) return { count: 0 };
                Object.assign(row, args.data);
                return { count: 1 };
            },
        },
    };
    return client;
}

const SETTINGS = { currency: 'EUR', vatRate: 19, tenantBilling: { x: [1, 2] } };
const record = (fingerprint, settings = SETTINGS) => ({
    fingerprint,
    settings,
    source: '/f',
    appliedAt: new Date('2026-09-01T06:00:00.000Z'),
});
const changeTo = (settings) => ({
    noticedAt: new Date('2026-09-01T06:00:00.000Z'),
    source: '/f',
    previous: SETTINGS,
    current: settings,
});

// @requirement SC-CFG-028 — There is one record per installation
describe('the one row', () => {
    test('the first record is an insert keyed on the installation id that skips a duplicate', async () => {
        const client = fakeClient();
        const repo = new PrismaAppliedSettingsRepository(client);
        assert.equal(await repo.writeApplied(record('sha256-a'), null), true);

        const [call] = client.calls.createMany;
        assert.deepEqual(call, {
            data: [{ id: 'installation', ...record('sha256-a') }],
            skipDuplicates: true,
        });
        assert.deepEqual(client.calls.updateMany, [], 'no record expected, so nothing to update');
    });

    test('a replacement is one update keyed on the id and the fingerprint that was read', async () => {
        const client = fakeClient();
        const repo = new PrismaAppliedSettingsRepository(client);
        await repo.writeApplied(record('sha256-a'), null);

        assert.equal(await repo.writeApplied(record('sha256-b'), 'sha256-a'), true);
        const [call] = client.calls.updateMany;
        assert.deepEqual(call.where, { id: 'installation', fingerprint: 'sha256-a' });
        assert.deepEqual(call.data, record('sha256-b'));
        assert.equal('id' in call.data, false, 'the update never rewrites the id');
    });

    test('a guard the row no longer matches answers false, and the row stands', async () => {
        const client = fakeClient();
        const repo = new PrismaAppliedSettingsRepository(client);
        await repo.writeApplied(record('sha256-a'), null);

        assert.equal(await repo.writeApplied(record('sha256-b'), null), false);
        assert.equal(await repo.writeApplied(record('sha256-c'), 'sha256-stale'), false);
        assert.equal((await repo.readApplied()).fingerprint, 'sha256-a');
    });

    test('reads back what was written, and null before anything was', async () => {
        const client = fakeClient();
        const repo = new PrismaAppliedSettingsRepository(client);
        assert.equal(await repo.readApplied(), null);
        await repo.writeApplied(record('sha256-a'), null);
        assert.deepEqual(await repo.readApplied(), record('sha256-a'));
        assert.deepEqual(client.calls.findUnique.at(-1), { where: { id: 'installation' } });
    });

    test('a JSON column that is not an object reads as no settings, not as a crash', async () => {
        const client = fakeClient();
        client.state.applied = {
            fingerprint: 'x',
            settings: 'garbage',
            source: '/f',
            appliedAt: new Date(),
        };
        const repo = new PrismaAppliedSettingsRepository(client);
        assert.deepEqual((await repo.readApplied()).settings, {});
    });
});

describe('the changes', () => {
    test('a change is written inside one transaction with the record it supersedes', async () => {
        const client = fakeClient();
        const repo = new PrismaAppliedSettingsRepository(client);
        await repo.writeApplied(record('sha256-a'), null);
        const next = { ...SETTINGS, vatRate: 20 };

        const change = await repo.recordChange(
            changeTo(next),
            record('sha256-b', next),
            'sha256-a',
        );

        assert.equal(client.calls.transactions, 1);
        assert.equal(change.acknowledgedAt, null);
        assert.deepEqual(client.calls.create.at(-1).data, changeTo(next));
        assert.equal((await repo.readApplied()).fingerprint, 'sha256-b');
    });

    test('a change whose record has moved on writes nothing and answers null', async () => {
        const client = fakeClient();
        const repo = new PrismaAppliedSettingsRepository(client);
        await repo.writeApplied(record('sha256-a'), null);
        const next = { ...SETTINGS, vatRate: 20 };

        const refused = await repo.recordChange(
            changeTo(next),
            record('sha256-b', next),
            'sha256-stale',
        );

        assert.equal(refused, null);
        assert.deepEqual(client.calls.create, [], 'no change row without the record');
        assert.equal((await repo.readApplied()).fingerprint, 'sha256-a');
    });

    // @requirement SC-CFG-033 — The changes are listed in the order the record went through them
    test('a listing is by the recorded order and passes the acknowledgement filter and the limit through', async () => {
        const client = fakeClient();
        const repo = new PrismaAppliedSettingsRepository(client);

        // `seq`, not `noticedAt`: the database numbers each change at its
        // write, and a start's clock may say an earlier moment than a move
        // that landed before it.
        const ORDER = [{ seq: 'desc' }];
        await repo.listChanges();
        assert.deepEqual(client.calls.findMany.at(-1), { where: undefined, orderBy: ORDER });

        await repo.listChanges({ acknowledged: false, limit: 5 });
        assert.deepEqual(client.calls.findMany.at(-1), {
            where: { acknowledgedAt: null },
            orderBy: ORDER,
            take: 5,
        });

        await repo.listChanges({ acknowledged: true });
        assert.deepEqual(client.calls.findMany.at(-1).where, { acknowledgedAt: { not: null } });
    });

    test('an acknowledgement is one guarded update, so the first one stands', async () => {
        const client = fakeClient();
        const repo = new PrismaAppliedSettingsRepository(client);
        await repo.writeApplied(record('sha256-a'), null);
        const next = { ...SETTINGS, vatRate: 20 };
        const change = await repo.recordChange(
            changeTo(next),
            record('sha256-b', next),
            'sha256-a',
        );

        const first = new Date('2026-09-02T08:00:00.000Z');
        const seen = await repo.acknowledgeChange(change.id, 'web:a@x:1', first);
        assert.deepEqual(client.calls.acknowledge.at(-1), {
            where: { id: change.id, acknowledgedAt: null },
            data: { acknowledgedAt: first, acknowledgedBy: 'web:a@x:1' },
        });
        assert.equal(seen.acknowledgedBy, 'web:a@x:1');

        const again = await repo.acknowledgeChange(change.id, 'web:b@x:2', new Date());
        assert.equal(again.acknowledgedBy, 'web:a@x:1', 'the first acknowledgement is the fact');
        assert.equal(await repo.acknowledgeChange('missing', 'web:a@x:1', first), null);
    });
});
