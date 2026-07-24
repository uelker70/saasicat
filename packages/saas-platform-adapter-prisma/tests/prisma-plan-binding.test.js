import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
    PrismaPlanCatalogImportSink,
    PrismaPlanCatalogReadSink,
    PrismaPlanRepository,
    PrismaPlanVersionRepository,
    PrismaSubscriptionRepository,
    createPrismaPlanBindingResolver,
    prismaPersistence,
    resolvePrismaSchemaOptions,
} from '../dist/index.js';

const APP_SCHEMA = {
    planBinding: { mode: 'normalized-plan-id', projectKey: 'app' },
    delegates: {
        catalogPlanVersion: 'catalogPlanVersion',
        entitlementPlanVersion: 'entitlementPlanVersion',
    },
    planVersionFields: {
        catalog: { validityWindows: true, endsAt: true },
        entitlement: { validityWindows: true, endsAt: true },
    },
};

describe('Prisma plan binding options', () => {
    test('the omitted schema preserves every 0.6 plan default', async () => {
        const schema = resolvePrismaSchemaOptions();
        assert.deepEqual(schema.planBinding, { mode: 'legacy-plan-key' });
        assert.deepEqual(schema.delegates, {
            catalogPlanVersion: 'planVersion',
            entitlementPlanVersion: 'planVersion',
        });
        assert.deepEqual(schema.planVersionFields, {
            catalog: { validityWindows: false, endsAt: false },
            entitlement: { validityWindows: false, endsAt: false },
        });
        assert.deepEqual(schema.tenantSubscription, {
            delegate: 'subscription',
            subscriptionBundleDelegate: false,
            synchronizePlanVersion: false,
            atomicOnboardingSelection: false,
            activeVersionSelection: 'latest-live',
            withEndsAt: false,
        });

        const resolver = createPrismaPlanBindingResolver();
        assert.equal(await resolver.toStoragePlanId({}, 'BASIC'), 'BASIC');
        assert.equal(await resolver.toPlanKey({}, 'BASIC'), 'BASIC');
    });

    test('normalized mode requires projectKey and resolves both directions', async () => {
        assert.throws(
            () => createPrismaPlanBindingResolver({ mode: 'normalized-plan-id' }),
            /requires a non-empty projectKey/,
        );
        const client = fakePrisma();
        const resolver = createPrismaPlanBindingResolver(APP_SCHEMA.planBinding);

        assert.equal(await resolver.toStoragePlanId(client, 'BASIC'), 'plan-basic');
        assert.equal(await resolver.toPlanKey(client, 'plan-basic'), 'BASIC');
        await assert.rejects(
            resolver.toPlanKey(client, 'plan-other'),
            /not found in project 'app'/,
        );
    });
});

describe('normalized plan identity across Prisma adapters', () => {
    test('catalog read uses the catalog delegate and exposes semantic planKey', async () => {
        const client = fakePrisma();
        client.catalogPlanVersion.rows.push(
            versionRow({
                id: 'catalog-v1',
                planId: 'plan-basic',
                validFrom: new Date('2026-07-01T00:00:00.000Z'),
                validUntil: new Date('2026-07-31T00:00:00.000Z'),
                endsAt: new Date('2026-08-01T12:00:00.000Z'),
            }),
        );
        const snapshot = await new PrismaPlanCatalogReadSink(client, APP_SCHEMA).loadSnapshot(
            'app',
        );

        assert.deepEqual(client.catalogPlanVersion.calls.findMany[0].where.planId, {
            in: ['plan-basic'],
        });
        assert.equal(client.planVersion.calls.findMany.length, 0);
        assert.equal(snapshot.livePlanVersions[0].planId, 'BASIC');
        assert.equal(snapshot.livePlanVersions[0].validFrom, '2026-07-01T00:00:00.000Z');
        assert.equal(snapshot.livePlanVersions[0].validUntil, '2026-07-31T00:00:00.000Z');
        assert.equal(snapshot.livePlanVersions[0].endsAt, '2026-08-01T12:00:00.000Z');
    });

    test('catalog import resolves planKey to UUID and writes only the catalog delegate', async () => {
        const client = fakePrisma();
        const sink = new PrismaPlanCatalogImportSink(client, APP_SCHEMA);
        await sink.upsertPlanVersion({
            planKey: 'BASIC',
            version: 2,
            features: ['CORE'],
            quotas: { users: 10 },
            monthlyNet: '19.00',
            yearlyNet: '190.00',
            marketed: true,
            publish: true,
            changeNote: 'normalized import',
        });

        assert.equal(client.catalogPlanVersion.calls.create[0].data.planId, 'plan-basic');
        assert.equal(client.planVersion.calls.create.length, 0);
        assert.equal(client.catalogPlanVersion.calls.updateMany[0].where.planId, 'plan-basic');
    });

    test('entitlement and subscription adapters use their delegate and map UUID back', async () => {
        const client = fakePrisma();
        client.entitlementPlanVersion.rows.push(
            versionRow({
                id: 'entitlement-v1',
                planId: 'plan-basic',
                quotas: { users: 25 },
            }),
        );
        client.subscription.rows.push(
            subscriptionRow({ plan: 'DRIFTED', planVersionId: 'entitlement-v1' }),
        );

        const versions = new PrismaPlanVersionRepository(client, APP_SCHEMA);
        assert.deepEqual(await versions.findLatestLive('BASIC'), {
            planId: 'BASIC',
            quotas: { users: 25 },
            features: ['CORE'],
        });
        assert.equal(client.entitlementPlanVersion.calls.findFirst[0].where.planId, 'plan-basic');
        assert.equal(client.planVersion.calls.findFirst.length, 0);

        const subscriptions = new PrismaSubscriptionRepository(client, APP_SCHEMA);
        const subscription = await subscriptions.findByTenantId('tenant-1');
        assert.equal(subscription.plan, 'BASIC');
        assert.equal(subscription.planVersion.planId, 'BASIC');
    });

    test('active subscription counts use authoritative PlanVersions and stay project-scoped', async () => {
        const client = fakePrisma();
        client.entitlementPlanVersion.rows.push(
            versionRow({ id: 'app-v1', planId: 'plan-basic' }),
            versionRow({ id: 'other-v1', planId: 'plan-other' }),
        );
        client.subscription.rows.push(
            subscriptionRow({
                id: 'app-active',
                tenantId: 'tenant-app-active',
                plan: 'DRIFTED',
                planVersionId: 'app-v1',
            }),
            subscriptionRow({
                id: 'app-trial',
                tenantId: 'tenant-app-trial',
                plan: 'ALSO_DRIFTED',
                status: 'TRIAL',
                planVersionId: 'app-v1',
            }),
            subscriptionRow({
                id: 'other-active',
                tenantId: 'tenant-other',
                plan: 'BASIC',
                planVersionId: 'other-v1',
            }),
            subscriptionRow({
                id: 'app-canceled',
                tenantId: 'tenant-app-canceled',
                status: 'CANCELED',
                planVersionId: 'app-v1',
            }),
        );

        const repository = new PrismaSubscriptionRepository(client, APP_SCHEMA);
        assert.deepEqual(await repository.countActiveByPlanKey('app'), { BASIC: 2 });
        assert.deepEqual(client.plan.calls.findMany.at(-1).where, {
            projectKey: 'app',
            id: { in: ['plan-basic', 'plan-other'] },
        });
    });

    test('all subscription operations honor tenantSubscription.delegate, including tx reads', async () => {
        const client = fakePrisma();
        client.membership = subscriptionDelegate();
        client.entitlementPlanVersion.rows.push(
            versionRow({ id: 'entitlement-v1', planId: 'plan-basic' }),
        );
        client.membership.rows.push(
            subscriptionRow({
                plan: 'DRIFTED',
                planVersionId: 'entitlement-v1',
                pendingPlanVersionId: 'entitlement-v2',
            }),
        );
        const repository = new PrismaSubscriptionRepository(client, {
            ...APP_SCHEMA,
            tenantSubscription: { delegate: 'membership' },
        });

        assert.equal((await repository.findByTenantId('tenant-1')).plan, 'BASIC');
        assert.equal((await repository.findByTenantIdLocked('tenant-1', client)).plan, 'BASIC');
        assert.equal(await repository.countByPlanVersionId('entitlement-v2'), 1);
        assert.deepEqual(await repository.countActiveByPlanKey('app'), { BASIC: 1 });

        assert.equal(client.membership.calls.findUnique.length, 2);
        assert.equal(client.membership.calls.count.length, 1);
        assert.equal(client.membership.calls.findMany.length, 1);
        assert.equal(client.subscription.calls.findUnique.length, 0);
        assert.equal(client.subscription.calls.count.length, 0);
        assert.equal(client.subscription.calls.findMany.length, 0);
    });

    test('bundle booking count is opt-in and uses active cancellation semantics', async () => {
        const client = fakePrisma();
        const legacy = new PrismaSubscriptionRepository(client, APP_SCHEMA);
        assert.equal(legacy.countByBundleVersionId, undefined);

        const repository = new PrismaSubscriptionRepository(client, {
            ...APP_SCHEMA,
            tenantSubscription: {
                subscriptionBundleDelegate: 'subscriptionBundle',
            },
        });
        assert.equal(await repository.countByBundleVersionId('bundle-version-1'), 2);
        const where = client.subscriptionBundle.calls.count[0].where;
        assert.equal(where.bundleVersionId, 'bundle-version-1');
        assert.deepEqual(where.OR[0], { canceledAt: null });
        assert.ok(where.OR[1].canceledEffectiveAt.gt instanceof Date);
    });

    test('findActive is opt-in, day-inclusive and can include endsAt', async () => {
        const client = fakePrisma();
        client.entitlementPlanVersion.rows.push(
            versionRow({
                id: 'entitlement-v1',
                planId: 'plan-basic',
                validFrom: new Date('2026-07-01T00:00:00.000Z'),
                validUntil: new Date('2026-07-24T00:00:00.000Z'),
                endsAt: new Date('2026-07-25T00:00:00.000Z'),
            }),
        );
        const repo = new PrismaPlanVersionRepository(client, APP_SCHEMA);
        const asOf = new Date('2026-07-24T18:30:00.000Z');

        const active = await repo.findActive('BASIC', asOf);
        assert.equal(active.planId, 'BASIC');
        const where = client.entitlementPlanVersion.calls.findFirst[0].where;
        assert.equal(where.planId, 'plan-basic');
        assert.deepEqual(where.AND[1], {
            OR: [
                { validUntil: null },
                { validUntil: { gte: new Date('2026-07-24T00:00:00.000Z') } },
            ],
        });
        assert.deepEqual(where.AND[2], {
            OR: [{ endsAt: null }, { endsAt: { gt: asOf } }],
        });

        const legacy = new PrismaPlanVersionRepository(client);
        assert.equal(legacy.findActive, undefined);
    });

    test('active lookups prefer a dated version over a legacy NULL validFrom', async () => {
        const client = fakePrisma();
        const legacy = versionRow({
            id: 'legacy-null-start',
            planId: 'plan-basic',
            version: 99,
            quotas: { users: 1 },
            validFrom: null,
        });
        const dated = versionRow({
            id: 'dated-active',
            planId: 'plan-basic',
            version: 2,
            quotas: { users: 20 },
            validFrom: new Date('2026-07-01T00:00:00.000Z'),
        });
        client.entitlementPlanVersion.rows.push(legacy, dated);
        client.catalogPlanVersion.rows.push({ ...legacy }, { ...dated });
        const asOf = new Date('2026-07-24T12:00:00.000Z');
        const expectedOrder = [{ validFrom: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }];

        const entitlement = await new PrismaPlanVersionRepository(client, APP_SCHEMA).findActive(
            'BASIC',
            asOf,
        );
        assert.deepEqual(entitlement?.quotas, { users: 20 });
        assert.deepEqual(
            client.entitlementPlanVersion.calls.findFirst.at(-1).orderBy,
            expectedOrder,
        );

        const catalog = await new PrismaPlanRepository(client, APP_SCHEMA).findActivePlanVersion(
            'BASIC',
            asOf,
        );
        assert.equal(catalog?.id, 'dated-active');
        assert.deepEqual(client.catalogPlanVersion.calls.findFirst.at(-1).orderBy, expectedOrder);
    });
});

describe('PrismaPlanRepository normalized lifecycle', () => {
    test('draft fields, active lookup, atomic publish, succession and termination round-trip', async () => {
        const client = fakePrisma();
        client.catalogPlanVersion.rows.push(
            versionRow({
                id: 'catalog-v1',
                planId: 'plan-basic',
                version: 1,
                validFrom: new Date('2026-01-01T00:00:00.000Z'),
            }),
        );
        const repo = new PrismaPlanRepository(client, APP_SCHEMA);
        const draft = await repo.createPlanVersionDraft({
            planId: 'BASIC',
            features: ['CORE'],
            quotas: { users: 20 },
            monthlyNet: '29.00',
            yearlyNet: '290.00',
            changeNote: 'v2',
            validFrom: '2026-08-01T00:00:00.000Z',
            validUntil: null,
        });

        assert.equal(draft.planId, 'BASIC');
        assert.equal(client.catalogPlanVersion.calls.create[0].data.planId, 'plan-basic');
        assert.ok(client.catalogPlanVersion.calls.create[0].data.validFrom instanceof Date);

        const active = await repo.findActivePlanVersion(
            'BASIC',
            new Date('2026-07-24T18:00:00.000Z'),
        );
        assert.equal(active.planId, 'BASIC');

        const published = await repo.publishPlanVersionDraft(draft.id, {
            publishedByUserId: 'admin-1',
            publishedChanges: [],
            nonRegressive: true,
            validFrom: new Date('2026-08-01T00:00:00.000Z'),
            validUntil: null,
        });
        assert.equal(client.transactionCalls, 1);
        assert.equal(published.planId, 'BASIC');
        const predecessor = client.catalogPlanVersion.rows.find((row) => row.id === 'catalog-v1');
        assert.equal(predecessor.validUntil.toISOString(), '2026-07-31T00:00:00.000Z');

        const terminated = await repo.terminate(draft.id, new Date('2026-12-31T23:00:00.000Z'));
        assert.equal(terminated.planId, 'BASIC');
        assert.equal(terminated.endsAt, '2026-12-31T23:00:00.000Z');
    });

    test('legacy constructor keeps planKey storage and drops unsupported fields', async () => {
        const client = fakePrisma();
        const repo = new PrismaPlanRepository(client);
        const draft = await repo.createPlanVersionDraft({
            planId: 'BASIC',
            features: [],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
            validFrom: '2026-08-01T00:00:00.000Z',
        });

        const data = client.planVersion.calls.create[0].data;
        assert.equal(data.planId, 'BASIC');
        assert.equal('validFrom' in data, false);
        assert.equal(draft.validFrom, null);
        await assert.rejects(repo.findActivePlanVersion('BASIC'), /requires/);
        await assert.rejects(repo.terminate(draft.id, new Date()), /requires/);
    });

    test('latest live lookup excludes a version whose explicit endsAt elapsed', async () => {
        const client = fakePrisma();
        client.catalogPlanVersion.rows.push(
            versionRow({
                id: 'ended-version',
                planId: 'plan-basic',
                endsAt: new Date('2000-01-01T00:00:00.000Z'),
            }),
        );
        const repo = new PrismaPlanRepository(client, APP_SCHEMA);

        assert.equal(await repo.findLatestLivePlanVersion('BASIC'), null);
        assert.deepEqual(client.catalogPlanVersion.calls.findFirst.at(-1).where.OR[0], {
            endsAt: null,
        });
    });

    test('legacy onlyPublished fails closed for plan keys shared by projects', async () => {
        const client = fakePrisma();
        client.planVersion.rows.push(versionRow({ planId: 'BASIC' }));
        const repo = new PrismaPlanRepository(client);

        assert.deepEqual(await repo.list({ projectKey: 'app', onlyPublished: true }), []);
        assert.deepEqual(client.planVersion.calls.findMany[0].where.planId, { in: [] });
    });
});

describe('prismaPersistence schema forwarding', () => {
    test('token factories receive normalized schema options', async () => {
        const token = Symbol('PRISMA');
        const bundle = prismaPersistence({ client: token, schema: APP_SCHEMA });
        const client = fakePrisma();
        client.entitlementPlanVersion.rows.push(
            versionRow({ id: 'entitlement-v1', planId: 'plan-basic' }),
        );

        const repo = bundle.entitlement.planVersionRepository.useFactory(client);
        const result = await repo.findLatestLive('BASIC');
        assert.equal(result.planId, 'BASIC');
        assert.equal(client.entitlementPlanVersion.calls.findFirst.length, 1);
    });
});

function fakePrisma() {
    const plans = [planRow(), planRow({ id: 'plan-other', projectKey: 'other', planKey: 'BASIC' })];
    const client = {
        transactionCalls: 0,
        plan: {
            rows: plans,
            calls: { findMany: [] },
            async findFirst({ where }) {
                return plans.find((row) => matches(row, where)) ?? null;
            },
            async findUnique({ where }) {
                return plans.find((row) => matches(row, where)) ?? null;
            },
            async findMany(args = {}) {
                this.calls.findMany.push(args);
                return plans.filter((row) => matches(row, args.where));
            },
            async create({ data }) {
                const row = planRow({ id: `plan-${plans.length + 1}`, ...data });
                plans.push(row);
                return row;
            },
            async update({ where, data }) {
                return updateRow(plans, where, data);
            },
            async deleteMany({ where }) {
                const before = plans.length;
                removeRows(plans, where);
                return { count: before - plans.length };
            },
        },
        planVersion: versionDelegate(),
        catalogPlanVersion: versionDelegate(),
        entitlementPlanVersion: versionDelegate(),
        subscription: subscriptionDelegate(),
        subscriptionBundle: {
            calls: { count: [] },
            async count(args) {
                this.calls.count.push(args);
                return 2;
            },
        },
        featureCatalogEntry: {
            async findMany() {
                return [];
            },
            async findFirst() {
                return null;
            },
            async create({ data }) {
                return data;
            },
        },
        async $queryRaw() {
            return [];
        },
        async $transaction(fn) {
            client.transactionCalls++;
            return fn(client);
        },
    };
    return client;
}

function versionDelegate(initialRows = []) {
    const rows = [...initialRows];
    const calls = {
        findFirst: [],
        findMany: [],
        findUnique: [],
        create: [],
        update: [],
        updateMany: [],
        deleteMany: [],
    };
    return {
        rows,
        calls,
        async findFirst(args = {}) {
            calls.findFirst.push(args);
            const found = rows.filter((row) => matches(row, args.where));
            sortRows(found, args.orderBy);
            return found[0] ?? null;
        },
        async findMany(args = {}) {
            calls.findMany.push(args);
            const found = rows.filter((row) => matches(row, args.where));
            sortRows(found, args.orderBy);
            return found;
        },
        async findUnique(args) {
            calls.findUnique.push(args);
            return rows.find((row) => matches(row, args.where)) ?? null;
        },
        async create(args) {
            calls.create.push(args);
            const row = versionRow({
                id: `version-${rows.length + 1}`,
                ...args.data,
            });
            rows.push(row);
            return row;
        },
        async update(args) {
            calls.update.push(args);
            return updateRow(rows, args.where, args.data);
        },
        async updateMany(args) {
            calls.updateMany.push(args);
            let count = 0;
            for (const row of rows) {
                if (matches(row, args.where)) {
                    Object.assign(row, args.data);
                    count++;
                }
            }
            return { count };
        },
        async deleteMany(args) {
            calls.deleteMany.push(args);
            const before = rows.length;
            removeRows(rows, args.where);
            return { count: before - rows.length };
        },
    };
}

function subscriptionDelegate() {
    const rows = [];
    const calls = { findUnique: [], findMany: [], count: [] };
    return {
        rows,
        calls,
        async findUnique(args) {
            calls.findUnique.push(args);
            const { where } = args;
            return rows.find((row) => matches(row, where)) ?? null;
        },
        async findMany(args = {}) {
            calls.findMany.push(args);
            return rows.filter((row) => matches(row, args.where));
        },
        async count(args = {}) {
            calls.count.push(args);
            return rows.filter((row) => matches(row, args.where)).length;
        },
    };
}

function planRow(overrides = {}) {
    return {
        id: 'plan-basic',
        projectKey: 'app',
        planKey: 'BASIC',
        label: 'Basic',
        description: null,
        icon: null,
        sortOrder: 0,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
        ...overrides,
    };
}

function versionRow(overrides = {}) {
    return {
        id: 'version-1',
        planId: 'BASIC',
        version: 1,
        baseVersionId: null,
        features: ['CORE'],
        quotas: { users: 5 },
        monthlyNet: '9.00',
        yearlyNet: '90.00',
        marketed: true,
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        supersededAt: null,
        publishedChanges: null,
        changeNote: 'v1',
        nonRegressive: true,
        createdByUserId: null,
        publishedByUserId: null,
        validFrom: null,
        validUntil: null,
        endsAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
    };
}

function subscriptionRow(overrides = {}) {
    return {
        id: 'subscription-1',
        tenantId: 'tenant-1',
        plan: 'BASIC',
        billingCycle: 'YEARLY',
        status: 'ACTIVE',
        isPilot: false,
        trialEntitlementPlan: null,
        pendingPlan: null,
        pendingEffectiveAt: null,
        customLimits: null,
        planVersionId: 'version-1',
        pendingPlanVersionId: null,
        startedAt: null,
        ...overrides,
    };
}

function matches(row, where = {}) {
    if (!where) return true;
    return Object.entries(where).every(([field, expected]) => {
        if (field === 'AND') return expected.every((clause) => matches(row, clause));
        if (field === 'OR') return expected.some((clause) => matches(row, clause));
        const actual = row[field];
        if (
            expected !== null &&
            typeof expected === 'object' &&
            !Array.isArray(expected) &&
            !(expected instanceof Date)
        ) {
            if ('in' in expected) return expected.in.includes(actual);
            if ('not' in expected) return actual !== expected.not;
            if ('lt' in expected) return actual < expected.lt;
            if ('lte' in expected) return actual === null || actual <= expected.lte;
            if ('gte' in expected) return actual === null || actual >= expected.gte;
            if ('gt' in expected) return actual === null || actual > expected.gt;
        }
        return actual === expected;
    });
}

function sortRows(rows, orderBy) {
    if (!orderBy) return;
    const rules = Array.isArray(orderBy) ? orderBy : [orderBy];
    rows.sort((left, right) => {
        for (const rule of rules) {
            const [field, order] = Object.entries(rule)[0];
            const direction = typeof order === 'string' ? order : order.sort;
            const nulls = typeof order === 'string' ? 'last' : order.nulls;
            const a = left[field];
            const b = right[field];
            if (a === b) continue;
            if (a === null) return nulls === 'first' ? -1 : 1;
            if (b === null) return nulls === 'first' ? 1 : -1;
            return (a < b ? -1 : 1) * (direction === 'desc' ? -1 : 1);
        }
        return 0;
    });
}

function updateRow(rows, where, data) {
    const row = rows.find((candidate) => matches(candidate, where));
    if (!row) throw new Error('record not found');
    Object.assign(row, data, { updatedAt: new Date('2026-07-24T00:00:00.000Z') });
    return row;
}

function removeRows(rows, where) {
    for (let index = rows.length - 1; index >= 0; index--) {
        if (matches(rows[index], where)) rows.splice(index, 1);
    }
}
