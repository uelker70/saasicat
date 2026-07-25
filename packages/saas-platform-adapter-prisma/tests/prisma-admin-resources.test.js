import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaAdminResourcesAdapter } from '../dist/index.js';

test('PrismaAdminResourcesAdapter serves every standard Admin resource', async () => {
    const calls = {
        tenants: [],
        tenantUpdates: [],
        subscriptionUpdates: [],
        users: [],
        subscriptions: [],
        audit: [],
    };
    const tenant = {
        id: 'tenant-1',
        slug: 'acme',
        name: 'Acme',
        isActive: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        subscription: {
            plan: 'PRO',
            status: 'ACTIVE',
            billingCycle: 'MONTHLY',
            isPilot: false,
            trialEndsAt: null,
            pilotEndsAt: null,
        },
        users: [
            {
                id: 'user-1',
                email: 'owner@acme.example',
                createdAt: new Date('2026-01-02T00:00:00.000Z'),
            },
        ],
        _count: { notes: 3, users: 1 },
    };
    const prisma = {
        tenant: {
            async findMany(args) {
                calls.tenants.push(args);
                return [tenant];
            },
            async findUnique() {
                return tenant;
            },
            async update(args) {
                calls.tenantUpdates.push(args);
                return { ...tenant, ...args.data };
            },
        },
        user: {
            async findMany(args) {
                calls.users.push(args);
                return [
                    {
                        id: 'user-1',
                        email: 'owner@acme.example',
                        createdAt: new Date('2026-01-02T00:00:00.000Z'),
                        tenant: { slug: 'acme' },
                    },
                ];
            },
        },
        subscription: {
            async updateMany(args) {
                calls.subscriptionUpdates.push(args);
                return { count: 1 };
            },
            async findMany(args) {
                calls.subscriptions.push(args);
                return [
                    {
                        id: 'subscription-1',
                        tenant: { slug: 'acme', name: 'Acme' },
                        plan: 'PRO',
                        status: 'ACTIVE',
                        billingCycle: 'MONTHLY',
                        currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
                        planVersion: { monthlyNet: '29.00' },
                    },
                ];
            },
        },
        auditLog: {
            async findMany(args) {
                calls.audit.push(args);
                return [
                    {
                        id: 'audit-1',
                        tenantId: null,
                        userId: 'admin-1',
                        entity: 'Tenant',
                        entityId: 'tenant-1',
                        action: 'TENANT_SUSPEND',
                        changes: {},
                        actorTag: 'web:admin@example.com:session-1',
                        ipAddress: null,
                        userAgent: null,
                        createdAt: new Date('2026-01-03T00:00:00.000Z'),
                    },
                ];
            },
        },
    };
    const adapter = new PrismaAdminResourcesAdapter(prisma, {
        tenantMetrics: ['notes', 'users'],
    });

    const tenants = await adapter.listTenants({
        status: 'ACTIVE',
        plan: 'PRO',
        search: 'acme',
    });
    assert.deepEqual(tenants, [
        {
            id: 'tenant-1',
            slug: 'acme',
            name: 'Acme',
            isActive: true,
            deletedAt: null,
            plan: 'PRO',
            status: 'ACTIVE',
            createdAt: '2026-01-01T00:00:00.000Z',
            notes: 3,
            users: 1,
        },
    ]);
    assert.deepEqual(calls.tenants[0].include._count.select, { notes: true, users: true });
    assert.equal(calls.tenants[0].where.isActive, true);

    const detail = await adapter.getTenantDetail('acme');
    assert.equal(detail.counts.notes, 3);
    assert.equal(detail.users[0].email, 'owner@acme.example');

    const suspended = await adapter.setTenantActive('acme', false, 'PAST_DUE');
    assert.deepEqual(suspended, {
        ok: true,
        id: 'tenant-1',
        slug: 'acme',
        isActive: false,
        status: 'PAST_DUE',
    });
    assert.deepEqual(calls.tenantUpdates[0], {
        where: { id: 'tenant-1' },
        data: { isActive: false },
    });
    assert.deepEqual(calls.subscriptionUpdates[0], {
        where: { tenantId: 'tenant-1' },
        data: { status: 'PAST_DUE' },
    });

    const users = await adapter.listUsers({ q: 'owner', tenant: 'acme' });
    assert.equal(users[0].role, 'MEMBER');
    assert.equal(users[0].isActive, true);
    assert.equal(calls.users[0].where.tenant.slug, 'acme');

    const subscriptions = await adapter.listSubscriptions();
    assert.equal(subscriptions[0].monthlyNet, '29.00');
    assert.equal(subscriptions[0].periodEndsAt, '2026-02-01T00:00:00.000Z');

    const audit = await adapter.listAudit({
        actor: 'ADMIN',
        since: 'not-a-date',
        limit: 500,
    });
    assert.equal(audit[0].userEmail, 'admin@example.com');
    assert.deepEqual(calls.audit[0].where.actorTag, {
        contains: 'ADMIN',
        mode: 'insensitive',
    });
    assert.equal(calls.audit[0].where.createdAt, undefined);
    assert.equal(calls.audit[0].take, 200);
});
