import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    AsyncLocalRlsBypassAdapter,
    PrismaAuditAdapter,
    PrismaMfaAdapter,
} from '../dist/index.js';

// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P4.
// Fake-PrismaLike — strukturelles Sub-Interface, das die Adapter erwarten.

function fakePrisma() {
    const calls = { upsert: [], create: [], findUniqueMfa: [], findUniqueUser: [] };
    const state = { mfa: new Map(), users: new Map(), audit: [] };
    return {
        calls,
        state,
        superAdminMfa: {
            async findUnique({ where }) {
                calls.findUniqueMfa.push(where);
                return state.mfa.get(where.userId) ?? null;
            },
            async upsert({ where, create, update }) {
                calls.upsert.push({ where, create, update });
                const existing = state.mfa.get(where.userId);
                if (existing) state.mfa.set(where.userId, { ...existing, ...update });
                else state.mfa.set(where.userId, { ...create, userId: where.userId });
                return state.mfa.get(where.userId);
            },
        },
        auditEntry: {
            async create({ data }) {
                calls.create.push(data);
                state.audit.push(data);
                return { id: 'audit-' + state.audit.length, ...data };
            },
        },
        superAdminUser: {
            async findUnique({ where }) {
                calls.findUniqueUser.push(where);
                return state.users.get(where.email) ?? null;
            },
            async create({ data }) {
                const row = {
                    id: 'usr-' + (state.users.size + 1),
                    email: data.email,
                    platformRole: data.platformRole ?? 'SUPER_ADMIN',
                    isActive: data.isActive ?? true,
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                };
                state.users.set(data.email, row);
                return row;
            },
        },
    };
}

describe('PrismaMfaAdapter', () => {
    test('getSecret liefert null wenn kein Eintrag', async () => {
        const p = fakePrisma();
        const a = new PrismaMfaAdapter(p);
        assert.equal(await a.getSecret('u1'), null);
    });

    test('setSecret legt Eintrag mit enabledAt an', async () => {
        const p = fakePrisma();
        const a = new PrismaMfaAdapter(p);
        await a.setSecret('u1', 'B32X');
        assert.equal(p.state.mfa.get('u1').secret, 'B32X');
        assert.ok(p.state.mfa.get('u1').enabledAt instanceof Date);
    });

    test('setSecret(null) entfernt Secret + enabledAt', async () => {
        const p = fakePrisma();
        p.state.mfa.set('u1', { userId: 'u1', secret: 'X', enabledAt: new Date() });
        const a = new PrismaMfaAdapter(p);
        await a.setSecret('u1', null);
        assert.equal(p.state.mfa.get('u1').secret, null);
        assert.equal(p.state.mfa.get('u1').enabledAt, null);
    });

    test('isEnabled = true nur wenn secret + enabledAt gesetzt', async () => {
        const p = fakePrisma();
        const a = new PrismaMfaAdapter(p);
        assert.equal(await a.isEnabled('u1'), false);
        p.state.mfa.set('u1', { userId: 'u1', secret: null, enabledAt: null });
        assert.equal(await a.isEnabled('u1'), false);
        p.state.mfa.set('u1', { userId: 'u1', secret: 'X', enabledAt: new Date() });
        assert.equal(await a.isEnabled('u1'), true);
    });
});

describe('PrismaAuditAdapter', () => {
    test('write speichert mit CLI-Source-Mapping', async () => {
        const p = fakePrisma();
        const a = new PrismaAuditAdapter(p);
        await a.write({
            actor: { userId: 'u1', email: 'x@y.z', source: 'cli', context: 'host' },
            entity: 'Tenant',
            entityId: 't1',
            action: 'SUSPEND',
            changes: { reason: 'demo' },
        });
        assert.equal(p.state.audit.length, 1);
        assert.equal(p.state.audit[0].actorRole, 'CLI');
        assert.deepEqual(p.state.audit[0].changes, { reason: 'demo' });
    });

    test('write ohne changes default {}', async () => {
        const p = fakePrisma();
        const a = new PrismaAuditAdapter(p);
        await a.write({
            actor: { userId: 'u1', email: 'x@y.z', source: 'web', context: 'sess' },
            entity: 'Plan',
            entityId: 'p1',
            action: 'PUBLISH',
        });
        assert.deepEqual(p.state.audit[0].changes, {});
        assert.equal(p.state.audit[0].actorRole, 'SUPER_ADMIN');
    });
});

describe('AsyncLocalRlsBypassAdapter', () => {
    test('isBypassActive = false ausserhalb runWithBypass', () => {
        const a = new AsyncLocalRlsBypassAdapter();
        assert.equal(a.isBypassActive(), false);
    });

    test('isBypassActive = true innerhalb runWithBypass', async () => {
        const a = new AsyncLocalRlsBypassAdapter();
        const result = await a.runWithBypass(async () => {
            assert.equal(a.isBypassActive(), true);
            return 42;
        });
        assert.equal(result, 42);
        assert.equal(a.isBypassActive(), false);
    });

    test('nested runWithBypass bleibt true im inneren Callback', async () => {
        const a = new AsyncLocalRlsBypassAdapter();
        await a.runWithBypass(async () => {
            await a.runWithBypass(async () => {
                assert.equal(a.isBypassActive(), true);
            });
            assert.equal(a.isBypassActive(), true);
        });
    });
});
