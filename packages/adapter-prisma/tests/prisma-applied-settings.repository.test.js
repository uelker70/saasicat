// `PrismaAppliedSettingsRepository` — what it asks the client for.
//
// The database semantics — one row, replaced rather than duplicated; a change
// acknowledged once — are the contract's, and run against PostgreSQL in
// tests/integration/. What this holds is the translation: the row id the
// upsert keys on, the guard on the acknowledgement update, and the filters a
// listing turns into Prisma arguments. A repository that keyed the upsert on a
// fresh uuid would pass its own unit tests and write a second row the CHECK
// then refuses — this is where that shows up without a database.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaAppliedSettingsRepository } from '../dist/index.js';

function fakeClient() {
    const calls = { upsert: [], findUnique: [], create: [], findMany: [], updateMany: [] };
    const state = { applied: null, changes: new Map() };
    const client = {
        calls,
        state,
        appliedSettings: {
            async findUnique(args) {
                calls.findUnique.push(args);
                return state.applied;
            },
            async upsert(args) {
                calls.upsert.push(args);
                state.applied = state.applied
                    ? { ...state.applied, ...args.update }
                    : { ...args.create };
                return state.applied;
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
                calls.updateMany.push(args);
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

// @requirement SC-CFG-028 — There is one record per installation
describe('the one row', () => {
    test('is keyed on the installation id, on create and on update alike', async () => {
        const client = fakeClient();
        const repo = new PrismaAppliedSettingsRepository(client);
        const appliedAt = new Date('2026-09-01T06:00:00.000Z');
        await repo.writeApplied({
            fingerprint: 'sha256-a',
            settings: SETTINGS,
            source: '/f',
            appliedAt,
        });

        const [call] = client.calls.upsert;
        assert.deepEqual(call.where, { id: 'installation' });
        assert.equal(call.create.id, 'installation');
        assert.equal(call.create.fingerprint, 'sha256-a');
        assert.deepEqual(call.update, {
            fingerprint: 'sha256-a',
            settings: SETTINGS,
            source: '/f',
            appliedAt,
        });
        assert.equal('id' in call.update, false, 'the update never rewrites the id');
    });

    test('reads back what was written, and null before anything was', async () => {
        const client = fakeClient();
        const repo = new PrismaAppliedSettingsRepository(client);
        assert.equal(await repo.readApplied(), null);
        const appliedAt = new Date('2026-09-01T06:00:00.000Z');
        await repo.writeApplied({
            fingerprint: 'sha256-a',
            settings: SETTINGS,
            source: '/f',
            appliedAt,
        });
        assert.deepEqual(await repo.readApplied(), {
            fingerprint: 'sha256-a',
            settings: SETTINGS,
            source: '/f',
            appliedAt,
        });
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
    test('a listing is newest first and passes the acknowledgement filter and the limit through', async () => {
        const client = fakeClient();
        const repo = new PrismaAppliedSettingsRepository(client);

        // `id` second: rows noticed in the same millisecond — replicas starting
        // together — would otherwise come back in an order the database picks.
        const ORDER = [{ noticedAt: 'desc' }, { id: 'desc' }];
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
        const change = await repo.recordChange({
            noticedAt: new Date('2026-09-01T06:00:00.000Z'),
            source: '/f',
            previous: SETTINGS,
            current: { ...SETTINGS, vatRate: 20 },
        });
        assert.equal(change.acknowledgedAt, null);

        const first = new Date('2026-09-02T08:00:00.000Z');
        const seen = await repo.acknowledgeChange(change.id, 'web:a@x:1', first);
        assert.deepEqual(client.calls.updateMany.at(-1), {
            where: { id: change.id, acknowledgedAt: null },
            data: { acknowledgedAt: first, acknowledgedBy: 'web:a@x:1' },
        });
        assert.equal(seen.acknowledgedBy, 'web:a@x:1');

        const again = await repo.acknowledgeChange(change.id, 'web:b@x:2', new Date());
        assert.equal(again.acknowledgedBy, 'web:a@x:1', 'the first acknowledgement is the fact');
        assert.equal(await repo.acknowledgeChange('missing', 'web:a@x:1', first), null);
    });
});
