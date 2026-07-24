import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    AsyncLocalRlsBypassAdapter,
    PrismaAuditAdapter,
    PrismaAuditQueryAdapter,
    PrismaMfaAdapter,
    PrismaPlanCatalogImportSink,
    PrismaPlanCatalogReadSink,
    PrismaPlanVersionRepository,
    PrismaPromoCodeRepository,
    PrismaPromoCodeRedemptionRepository,
    PrismaSubscriptionRepository,
    PrismaSuperAdminBootstrapAdapter,
    PrismaTransactionRunner,
    prismaPersistence,
} from '../dist/index.js';

// Fake PrismaLike — structural sub-interface that the adapters expect.
// Mapping/wiring is verified here; real database semantics (locks, atomic
// updates, rollback) are covered by tests-integration/ via
// @saasicat/persistence-testing.

function recordingRaw(calls) {
    return (strings, ...values) => {
        calls.push({ sql: strings.join('?').replace(/\s+/g, ' ').trim(), values });
    };
}

function fakePrisma() {
    const calls = {
        queryRaw: [],
        executeRaw: [],
        subscriptionFindUnique: [],
        subscriptionCount: [],
        planVersionFindFirst: [],
        planVersionUpdateMany: [],
        planVersionCreate: [],
        auditLogFindMany: [],
        promoCodeUpdateMany: [],
    };
    const state = {
        mfa: new Map(),
        users: new Map(),
        auditLogs: [],
        subscriptionsByTenant: new Map(),
        subscriptionsById: new Map(),
        planVersionsById: new Map(),
        planVersionFindFirstResult: null,
        plans: [],
        featureEntries: [],
        planVersions: [],
        promoCodesById: new Map(),
        redemptionsBySubscription: new Map(),
        executeRawResult: 0,
        auditLogFindManyResult: [],
    };
    const prisma = {
        calls,
        state,
        $transaction(fn) {
            return fn(prisma);
        },
        async $queryRaw(strings, ...values) {
            recordingRaw(calls.queryRaw)(strings, ...values);
            return [];
        },
        async $executeRaw(strings, ...values) {
            recordingRaw(calls.executeRaw)(strings, ...values);
            return state.executeRawResult;
        },
        subscription: {
            async findUnique({ where }) {
                calls.subscriptionFindUnique.push(where);
                if (where.tenantId) return state.subscriptionsByTenant.get(where.tenantId) ?? null;
                return state.subscriptionsById.get(where.id) ?? null;
            },
            async findMany() {
                return [...state.subscriptionsByTenant.values()];
            },
            async count(args) {
                calls.subscriptionCount.push(args);
                return 7;
            },
        },
        planVersion: {
            async findUnique({ where }) {
                return state.planVersionsById.get(where.id) ?? null;
            },
            async findFirst(args) {
                calls.planVersionFindFirst.push(args);
                return state.planVersionFindFirstResult;
            },
            async findMany() {
                return state.planVersions;
            },
            async create({ data }) {
                calls.planVersionCreate.push(data);
                return { id: 'pv-new', ...data };
            },
            async updateMany(args) {
                calls.planVersionUpdateMany.push(args);
                return { count: 1 };
            },
        },
        plan: {
            async findFirst({ where }) {
                return (
                    state.plans.find(
                        (p) => p.projectKey === where.projectKey && p.planKey === where.planKey,
                    ) ?? null
                );
            },
            async findMany() {
                return state.plans;
            },
            async create({ data }) {
                const row = {
                    id: 'plan-' + (state.plans.length + 1),
                    description: null,
                    icon: null,
                    sortOrder: 0,
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                    deletedAt: null,
                    ...data,
                };
                state.plans.push(row);
                return row;
            },
        },
        featureCatalogEntry: {
            async findFirst({ where }) {
                return (
                    state.featureEntries.find(
                        (f) =>
                            f.projectKey === where.projectKey && f.featureKey === where.featureKey,
                    ) ?? null
                );
            },
            async findMany() {
                return state.featureEntries;
            },
            async create({ data }) {
                const row = { id: 'feat-' + (state.featureEntries.length + 1), ...data };
                state.featureEntries.push(row);
                return row;
            },
        },
        promoCode: {
            async findUnique({ where }) {
                if (where.code) {
                    return (
                        [...state.promoCodesById.values()].find((c) => c.code === where.code) ??
                        null
                    );
                }
                return state.promoCodesById.get(where.id) ?? null;
            },
            async findMany() {
                return [...state.promoCodesById.values()];
            },
            async create({ data }) {
                const row = {
                    id: 'promo-1',
                    redemptionsCount: 0,
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                    deletedAt: null,
                    ...data,
                };
                state.promoCodesById.set(row.id, row);
                return row;
            },
            async update({ where, data }) {
                const row = { ...state.promoCodesById.get(where.id), ...data };
                state.promoCodesById.set(where.id, row);
                return row;
            },
            async updateMany(args) {
                calls.promoCodeUpdateMany.push(args);
                return { count: 3 };
            },
        },
        promoCodeRedemption: {
            async findUnique({ where }) {
                return state.redemptionsBySubscription.get(where.subscriptionId) ?? null;
            },
            async findMany() {
                return [...state.redemptionsBySubscription.values()];
            },
            async create({ data }) {
                if (state.redemptionsBySubscription.has(data.subscriptionId)) {
                    throw new Error('Unique constraint failed on subscriptionId');
                }
                const row = {
                    id: 'red-1',
                    status: 'ACTIVE',
                    redeemedAt: new Date(0),
                    reversedAt: null,
                    ...data,
                };
                state.redemptionsBySubscription.set(data.subscriptionId, row);
                return row;
            },
            async update({ where, data }) {
                const row = [...state.redemptionsBySubscription.values()].find(
                    (r) => r.id === where.id,
                );
                const next = { ...row, ...data };
                state.redemptionsBySubscription.set(next.subscriptionId, next);
                return next;
            },
            async count() {
                return state.redemptionsBySubscription.size;
            },
            async updateMany() {
                return { count: 0 };
            },
        },
        promoCodeValidationLog: {
            async create() {
                return {};
            },
            async count() {
                return 0;
            },
        },
        auditLog: {
            async create({ data }) {
                state.auditLogs.push(data);
                return data;
            },
            async findMany(args) {
                calls.auditLogFindMany.push(args);
                return state.auditLogFindManyResult;
            },
            async count() {
                return state.auditLogs.length;
            },
        },
        superAdminMfa: {
            async findUnique({ where }) {
                return state.mfa.get(where.userId) ?? null;
            },
            async upsert({ where, create, update }) {
                const existing = state.mfa.get(where.userId);
                if (existing) state.mfa.set(where.userId, { ...existing, ...update });
                else state.mfa.set(where.userId, { ...create, userId: where.userId });
                return state.mfa.get(where.userId);
            },
        },
        superAdminUser: {
            async findUnique({ where }) {
                return state.users.get(where.email) ?? null;
            },
            async count() {
                return [...state.users.values()].filter((u) => u.isActive).length;
            },
            async create({ data }) {
                const row = {
                    id: 'usr-' + (state.users.size + 1),
                    platformRole: 'SUPER_ADMIN',
                    isActive: true,
                    firstName: null,
                    lastName: null,
                    lastLoginAt: null,
                    deletedAt: null,
                    createdAt: new Date(0),
                    updatedAt: new Date(0),
                    ...data,
                };
                state.users.set(data.email, row);
                return row;
            },
        },
    };
    return prisma;
}

const planVersionRow = (overrides = {}) => ({
    id: 'pv-1',
    planId: 'STARTER',
    version: 1,
    baseVersionId: null,
    features: ['CORE'],
    quotas: { users: 5 },
    monthlyNet: { toString: () => '9.90' },
    yearlyNet: { toString: () => '99.00' },
    marketed: true,
    publishedAt: new Date(0),
    supersededAt: null,
    publishedChanges: null,
    changeNote: 'v1',
    nonRegressive: true,
    createdByUserId: null,
    publishedByUserId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
});

const subscriptionRow = (overrides = {}) => ({
    id: 'sub-1',
    tenantId: 't1',
    plan: 'STARTER',
    billingCycle: 'YEARLY',
    status: 'ACTIVE',
    isPilot: false,
    trialEntitlementPlan: null,
    pendingPlan: null,
    pendingEffectiveAt: null,
    customLimits: null,
    planVersionId: 'pv-1',
    pendingPlanVersionId: null,
    startedAt: null,
    ...overrides,
});

describe('PrismaMfaAdapter', () => {
    test('secret roundtrip incl. enabledAt handling', async () => {
        const p = fakePrisma();
        const a = new PrismaMfaAdapter(p);
        assert.equal(await a.getSecret('u1'), null);
        assert.equal(await a.isEnabled('u1'), false);
        await a.setSecret('u1', 'B32X');
        assert.equal(await a.getSecret('u1'), 'B32X');
        assert.equal(await a.isEnabled('u1'), true);
        await a.setSecret('u1', null);
        assert.equal(p.state.mfa.get('u1').secret, null);
        assert.equal(p.state.mfa.get('u1').enabledAt, null);
    });
});

describe('PrismaAuditAdapter', () => {
    test('write maps actor to userId + actorTag on audit_logs', async () => {
        const p = fakePrisma();
        const a = new PrismaAuditAdapter(p);
        await a.write({
            actor: { userId: 'u1', email: 'x@y.z', source: 'cli', context: 'host' },
            entity: 'Tenant',
            entityId: 't1',
            action: 'TENANT_SUSPEND',
            changes: { reason: 'demo' },
        });
        assert.equal(p.state.auditLogs.length, 1);
        const row = p.state.auditLogs[0];
        assert.equal(row.tenantId, null);
        assert.equal(row.userId, 'u1');
        assert.equal(row.actorTag, 'cli:x@y.z:host');
        assert.deepEqual(row.changes, { reason: 'demo' });
    });

    test('write without changes defaults to {}', async () => {
        const p = fakePrisma();
        const a = new PrismaAuditAdapter(p);
        await a.write({
            actor: { userId: 'u1', email: 'x@y.z', source: 'web', context: 'sess' },
            entity: 'Plan',
            entityId: 'p1',
            action: 'PLAN_PUBLISH',
        });
        assert.deepEqual(p.state.auditLogs[0].changes, {});
        assert.equal(p.state.auditLogs[0].actorTag, 'web:x@y.z:sess');
    });
});

describe('PrismaAuditQueryAdapter', () => {
    test('maps wildcard actorTag, pagination and row → AuditEntry', async () => {
        const p = fakePrisma();
        p.state.auditLogFindManyResult = [
            {
                id: 'a1',
                tenantId: null,
                userId: 'u1',
                entity: 'Tenant',
                entityId: 't1',
                action: 'TENANT_SUSPEND',
                changes: { reason: 'x' },
                actorTag: 'cli:ops@example.com:host1',
                ipAddress: null,
                userAgent: null,
                createdAt: new Date('2026-01-02T03:04:05.000Z'),
            },
        ];
        const a = new PrismaAuditQueryAdapter(p);
        const entries = await a.list({ actorTag: 'cli:*', page: 2, pageSize: 10 });

        const args = p.calls.auditLogFindMany[0];
        assert.deepEqual(args.where.actorTag, { startsWith: 'cli:' });
        assert.equal(args.skip, 10);
        assert.equal(args.take, 10);
        assert.equal(entries[0].userEmail, 'ops@example.com');
        assert.equal(entries[0].createdAt, '2026-01-02T03:04:05.000Z');
    });
});

describe('AsyncLocalRlsBypassAdapter', () => {
    test('isBypassActive only inside runWithBypass', async () => {
        const a = new AsyncLocalRlsBypassAdapter();
        assert.equal(a.isBypassActive(), false);
        const result = await a.runWithBypass(async () => {
            assert.equal(a.isBypassActive(), true);
            return 42;
        });
        assert.equal(result, 42);
        assert.equal(a.isBypassActive(), false);
    });
});

describe('PrismaTransactionRunner', () => {
    test('run passes the interactive tx client through as context', async () => {
        const p = fakePrisma();
        const runner = new PrismaTransactionRunner(p);
        const seen = await runner.run(async (tx) => tx);
        assert.equal(seen, p, 'fake $transaction passes itself as tx');
    });
});

describe('PrismaSubscriptionRepository', () => {
    test('findByTenantId maps row + plan version to SubscriptionRecord', async () => {
        const p = fakePrisma();
        p.state.subscriptionsByTenant.set('t1', subscriptionRow());
        p.state.planVersionsById.set('pv-1', planVersionRow());
        const repo = new PrismaSubscriptionRepository(p);

        const record = await repo.findByTenantId('t1');
        assert.equal(record.planVersionId, 'pv-1');
        assert.deepEqual(record.planVersion, {
            planId: 'STARTER',
            quotas: { users: 5 },
            features: ['CORE'],
        });
        assert.equal(await repo.findByTenantId('other'), null);
    });

    test('findByTenantIdLocked takes the FOR UPDATE lock inside the tx', async () => {
        const p = fakePrisma();
        p.state.subscriptionsByTenant.set('t1', subscriptionRow());
        p.state.planVersionsById.set('pv-1', planVersionRow());
        const repo = new PrismaSubscriptionRepository(p);

        const record = await repo.findByTenantIdLocked('t1', p);
        assert.equal(record.tenantId, 't1');
        assert.equal(p.calls.queryRaw.length, 1);
        assert.match(p.calls.queryRaw[0].sql, /FOR UPDATE/);
        assert.deepEqual(p.calls.queryRaw[0].values, ['t1']);
    });

    test('countByPlanVersionId uses a single OR count', async () => {
        const p = fakePrisma();
        const repo = new PrismaSubscriptionRepository(p);
        assert.equal(await repo.countByPlanVersionId('pv-9'), 7);
        assert.deepEqual(p.calls.subscriptionCount[0].where, {
            OR: [{ planVersionId: 'pv-9' }, { pendingPlanVersionId: 'pv-9' }],
        });
    });

    test('countActiveByPlanKey aggregates by authoritative PlanVersion identity', async () => {
        const p = fakePrisma();
        p.state.plans.push(
            { id: 'plan-starter', projectKey: 'app', planKey: 'STARTER' },
            { id: 'plan-pro', projectKey: 'app', planKey: 'PRO' },
        );
        p.state.planVersions.push(
            planVersionRow({ id: 'pv-1', planId: 'STARTER' }),
            planVersionRow({ id: 'pv-pro', planId: 'PRO' }),
        );
        p.state.subscriptionsByTenant.set('t1', subscriptionRow({ plan: 'DRIFTED' }));
        p.state.subscriptionsByTenant.set('t2', subscriptionRow({ id: 'sub-2', tenantId: 't2' }));
        p.state.subscriptionsByTenant.set(
            't3',
            subscriptionRow({
                id: 'sub-3',
                tenantId: 't3',
                plan: 'ALSO_DRIFTED',
                planVersionId: 'pv-pro',
            }),
        );
        const repo = new PrismaSubscriptionRepository(p);
        assert.deepEqual(await repo.countActiveByPlanKey('app'), { STARTER: 2, PRO: 1 });
    });
});

describe('PrismaPlanVersionRepository', () => {
    test('findLatestLive filters live versions and maps the record', async () => {
        const p = fakePrisma();
        p.state.planVersionFindFirstResult = planVersionRow({ version: 2, quotas: { users: 9 } });
        const repo = new PrismaPlanVersionRepository(p);

        const record = await repo.findLatestLive('STARTER');
        assert.deepEqual(record, { planId: 'STARTER', quotas: { users: 9 }, features: ['CORE'] });
        const args = p.calls.planVersionFindFirst[0];
        assert.deepEqual(args.where, {
            planId: 'STARTER',
            publishedAt: { not: null },
            supersededAt: null,
        });
        assert.deepEqual(args.orderBy, { version: 'desc' });
        assert.equal(repo.findActive, undefined, 'no validFrom columns → no findActive');
    });
});

describe('PrismaPromoCodeRepository', () => {
    test('claimSlot issues the atomic guarded UPDATE', async () => {
        const p = fakePrisma();
        p.state.executeRawResult = 1;
        const repo = new PrismaPromoCodeRepository(p);
        assert.equal(await repo.claimSlot('promo-1'), true);
        const call = p.calls.executeRaw[0];
        assert.match(call.sql, /"redemptionsCount" \+ 1/);
        assert.match(call.sql, /"redemptionsCount" < "maxRedemptions"/);
        assert.match(call.sql, /status = 'ACTIVE'/);
        p.state.executeRawResult = 0;
        assert.equal(await repo.claimSlot('promo-1'), false);
    });

    test('releaseSlot floors at 0 and reactivates EXHAUSTED', async () => {
        const p = fakePrisma();
        const repo = new PrismaPromoCodeRepository(p);
        await repo.releaseSlot('promo-1');
        assert.match(p.calls.executeRaw[0].sql, /GREATEST\("redemptionsCount" - 1, 0\)/);
        assert.match(p.calls.executeRaw[0].sql, /CASE WHEN status = 'EXHAUSTED' THEN 'ACTIVE'/);
    });

    test('create normalizes the code and serializes decimals', async () => {
        const p = fakePrisma();
        const repo = new PrismaPromoCodeRepository(p);
        const record = await repo.create({
            code: '  sommer25 ',
            valueType: 'PERCENT',
            value: 25,
            durationType: 'ONCE',
            createdById: 'admin-1',
        });
        assert.equal(record.code, 'SOMMER25');
        assert.equal(record.value, '25.00');
        assert.equal(record.firstTimeCustomersOnly, true);
    });

    test('findByCode hides soft-deleted codes', async () => {
        const p = fakePrisma();
        p.state.promoCodesById.set('promo-1', {
            id: 'promo-1',
            code: 'GONE',
            valueType: 'PERCENT',
            value: '10.00',
            durationType: 'ONCE',
            durationValue: null,
            validFrom: null,
            validUntil: null,
            maxRedemptions: null,
            redemptionsCount: 0,
            appliesToPlans: [],
            appliesToBilling: null,
            firstTimeCustomersOnly: true,
            minimumPlanAmountGross: null,
            allowZeroInvoice: false,
            status: 'ACTIVE',
            description: null,
            campaignTag: null,
            revenueDeductionAccount: null,
            createdById: 'admin-1',
            createdAt: new Date(0),
            updatedAt: new Date(0),
            deletedAt: new Date(0),
        });
        const repo = new PrismaPromoCodeRepository(p);
        assert.equal(await repo.findByCode('gone'), null);
    });

    test('expireDueCodes targets ACTIVE/PAUSED with validUntil < now', async () => {
        const p = fakePrisma();
        const repo = new PrismaPromoCodeRepository(p);
        const now = new Date('2026-07-01T00:00:00Z');
        assert.equal(await repo.expireDueCodes(now), 3);
        assert.deepEqual(p.calls.promoCodeUpdateMany[0], {
            where: { status: { in: ['ACTIVE', 'PAUSED'] }, validUntil: { lt: now } },
            data: { status: 'EXPIRED' },
        });
    });
});

describe('PrismaPromoCodeRedemptionRepository', () => {
    test('create maps defaults and double redemption rejects', async () => {
        const p = fakePrisma();
        const repo = new PrismaPromoCodeRedemptionRepository(p);
        const data = {
            promoCodeId: 'promo-1',
            subscriptionId: 'sub-1',
            tenantId: 't1',
            appliedValueType: 'PERCENT',
            appliedValue: '10.00',
            appliedDurationType: 'ONCE',
            appliedDurationValue: null,
            startsAt: new Date(0),
            endsAt: null,
        };
        const record = await repo.create(data);
        assert.equal(record.status, 'ACTIVE');
        await assert.rejects(repo.create(data), /Unique/);
        assert.equal((await repo.findBySubscription('sub-1')).id, 'red-1');
    });
});

describe('PrismaSuperAdminBootstrapAdapter', () => {
    const hasher = { hash: async (plain) => `hashed:${plain}`, verify: async () => true };

    test('createSuperAdmin hashes the password and lowercases the email', async () => {
        const p = fakePrisma();
        const a = new PrismaSuperAdminBootstrapAdapter(p, hasher);
        const dto = await a.createSuperAdmin({ email: ' Admin@Example.COM ', password: 'pw' });
        assert.equal(dto.email, 'admin@example.com');
        assert.equal(dto.platformRole, 'SUPER_ADMIN');
        assert.equal(p.state.users.get('admin@example.com').passwordHash, 'hashed:pw');
        assert.equal(await a.countSuperAdmins(), 1);
    });

    test('duplicate email throws PlatformUserExistsError', async () => {
        const p = fakePrisma();
        const a = new PrismaSuperAdminBootstrapAdapter(p, hasher);
        await a.createSuperAdmin({ email: 'a@b.c', password: 'pw' });
        await assert.rejects(a.createSuperAdmin({ email: 'a@b.c', password: 'pw2' }), (err) => {
            assert.equal(err.code, 'USER_ALREADY_EXISTS');
            return true;
        });
    });
});

describe('PrismaPlanCatalogImportSink', () => {
    test('upsertPlanVersion is idempotent and supersedes older live versions on publish', async () => {
        const p = fakePrisma();
        const sink = new PrismaPlanCatalogImportSink(p);
        const input = {
            planKey: 'STARTER',
            version: 2,
            features: ['CORE'],
            quotas: { users: 5 },
            monthlyNet: '9.90',
            yearlyNet: '99.00',
            marketed: true,
            publish: true,
            changeNote: 'import',
        };

        const first = await sink.upsertPlanVersion(input);
        assert.equal(first.created, true);
        assert.deepEqual(p.calls.planVersionUpdateMany[0].where, {
            planId: 'STARTER',
            publishedAt: { not: null },
            supersededAt: null,
            version: { lt: 2 },
        });
        assert.ok(p.calls.planVersionCreate[0].publishedAt instanceof Date);

        p.state.planVersionFindFirstResult = planVersionRow({ version: 2 });
        const second = await sink.upsertPlanVersion(input);
        assert.deepEqual(second, { created: false, skipReason: 'exists' });
    });
});

describe('PrismaPlanCatalogReadSink', () => {
    test('loadSnapshot maps rows to wire formats with ISO dates and defaults', async () => {
        const p = fakePrisma();
        p.state.plans.push({
            id: 'plan-1',
            projectKey: 'app',
            planKey: 'STARTER',
            label: 'Starter',
            description: null,
            icon: null,
            sortOrder: 0,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
            deletedAt: null,
        });
        p.state.planVersions.push(planVersionRow());
        p.state.featureEntries.push({
            id: 'feat-1',
            projectKey: 'app',
            featureKey: 'CORE',
            label: 'Core',
            description: null,
            marketingLabel: null,
            marketingDescription: null,
            icon: null,
            tier: null,
            discoveryStatus: 'approved',
            requires: [],
            replaces: [],
            successorKey: null,
            approvedAt: null,
            approvedBy: null,
            approvedSignature: null,
            plannedOnly: false,
            core: true,
            i18n: {},
            sortOrder: 0,
            createdAt: new Date('2026-01-01T00:00:00Z'),
            updatedAt: new Date('2026-01-01T00:00:00Z'),
            deletedAt: null,
        });
        const sink = new PrismaPlanCatalogReadSink(p);

        const snapshot = await sink.loadSnapshot('app');
        assert.equal(snapshot.plans[0].createdAt, '2026-01-01T00:00:00.000Z');
        assert.equal(snapshot.livePlanVersions[0].monthlyNet, '9.90');
        assert.equal(snapshot.livePlanVersions[0].validFrom, null);
        assert.equal(snapshot.featureEntries[0].core, true);
    });
});

describe('prismaPersistence()', () => {
    test('token client → factory specs injecting the token', async () => {
        const token = Symbol('PRISMA');
        const bundle = prismaPersistence({ client: token });

        assert.deepEqual(bundle.capabilities, {
            transactions: true,
            pessimisticLocking: true,
            rowLevelSecurity: false,
            advisoryLocks: false,
        });
        assert.equal(typeof bundle.core.mfa.useFactory, 'function');
        assert.deepEqual(bundle.core.mfa.inject, [token]);
        const built = bundle.core.mfa.useFactory(fakePrisma());
        assert.ok(built instanceof PrismaMfaAdapter);
        assert.equal(
            bundle.core.superAdminProvisioning,
            undefined,
            'no provisioning without passwordHasher',
        );
        assert.ok(bundle.entitlement.subscriptionRepository.useFactory);
        assert.ok(bundle.promo.promoCodeRepository.useFactory);
    });

    test('instance client → ready instances; hasher instance enables provisioning', async () => {
        const p = fakePrisma();
        const hasher = { hash: async () => 'h', verify: async () => true };
        const bundle = prismaPersistence({
            client: p,
            passwordHasher: hasher,
            rlsIntegration: true,
        });

        assert.ok(bundle.core.audit instanceof PrismaAuditAdapter);
        assert.ok(bundle.core.superAdminProvisioning instanceof PrismaSuperAdminBootstrapAdapter);
        assert.equal(bundle.capabilities.rowLevelSecurity, true);
        assert.ok(bundle.core.transactionRunner instanceof PrismaTransactionRunner);
    });

    test('token client + hasher token → provisioning factory injecting both', () => {
        const clientToken = Symbol('PRISMA');
        const hasherToken = Symbol('HASHER');
        const bundle = prismaPersistence({ client: clientToken, passwordHasher: hasherToken });
        assert.deepEqual(bundle.core.superAdminProvisioning.inject, [clientToken, hasherToken]);
    });
});
