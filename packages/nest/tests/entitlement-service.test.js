import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EntitlementService, LimitExceededError } from '../dist/entitlement/index.js';
import {
    FakePlanVersionRepository,
    FakeSubscriptionContractRepository,
    FakeSubscriptionRepository,
    FakeTransactionRunner,
} from '../dist/testing/index.js';

const NOW = new Date('2026-05-08T12:00:00Z');

const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Test App' },
    currency: 'EUR',
    vatRate: 19,
    features: [{ key: 'CASHBOOK' }, { key: 'DMS' }, { key: 'API_ACCESS', plannedOnly: true }],
    plans: [
        {
            id: 'STANDARD',
            label: 'Standard',
            marketed: true,
            monthlyNet: 24.9,
            yearlyNet: 249,
            quotas: { users: 1, vehicles: 15, storageGb: 5 },
            features: ['CASHBOOK'],
        },
        {
            id: 'PROFESSIONAL',
            label: 'Professional',
            marketed: true,
            monthlyNet: 49.9,
            yearlyNet: 499,
            quotas: { users: 3, vehicles: 50, storageGb: 50 },
            features: ['CASHBOOK', 'DMS'],
        },
    ],
};

const STANDARD_PV = {
    planId: 'STANDARD',
    quotas: { users: 1, vehicles: 15, storageGb: 5 },
    features: ['CASHBOOK'],
};
const PROFESSIONAL_PV = {
    planId: 'PROFESSIONAL',
    quotas: { users: 3, vehicles: 50, storageGb: 50 },
    features: ['CASHBOOK', 'DMS'],
};

function buildSub(overrides = {}) {
    return {
        id: 'sub-1',
        tenantId: 't1',
        plan: 'STANDARD',
        status: 'ACTIVE',
        planVersionId: 'pv-1',
        planVersion: STANDARD_PV,
        ...overrides,
    };
}

function buildHarness(resolutionConfig = null) {
    const subRepo = new FakeSubscriptionRepository();
    const pvRepo = new FakePlanVersionRepository();
    const txRunner = new FakeTransactionRunner();
    pvRepo.set(STANDARD_PV);
    pvRepo.set(PROFESSIONAL_PV);
    const svc = new EntitlementService(CATALOG, subRepo, pvRepo, txRunner, resolutionConfig);
    return { svc, subRepo, pvRepo, txRunner };
}

function buildContractHarness() {
    const subRepo = new FakeSubscriptionRepository();
    const pvRepo = new FakePlanVersionRepository();
    const txRunner = new FakeTransactionRunner();
    const contractRepo = new FakeSubscriptionContractRepository();
    pvRepo.set(STANDARD_PV);
    const svc = new EntitlementService(
        CATALOG,
        subRepo,
        pvRepo,
        txRunner,
        null,
        null,
        null,
        contractRepo,
    );
    return { svc, subRepo, contractRepo };
}

// @requirement SC-ENTL-016 — An answer computed before an end date arrives is not served after it
describe('EntitlementService — computeLimits + Cache', () => {
    test('returns plan default limits for STANDARD', async () => {
        const { svc, subRepo } = buildHarness();
        subRepo.set(buildSub());
        const limits = await svc.computeLimits('t1', NOW);
        assert.equal(limits.plan, 'STANDARD');
        assert.deepEqual(limits.quotas, { users: 1, vehicles: 15, storageGb: 5 });
        assert.deepEqual([...limits.features], ['CASHBOOK']);
    });

    test('second call on the same tenant does NOT hit the DB', async () => {
        const { svc, subRepo } = buildHarness();
        subRepo.set(buildSub());
        let dbHits = 0;
        const original = subRepo.findByTenantId.bind(subRepo);
        subRepo.findByTenantId = async (id) => {
            dbHits += 1;
            return original(id);
        };
        await svc.computeLimits('t1', NOW);
        await svc.computeLimits('t1', NOW);
        await svc.computeLimits('t1', NOW);
        assert.equal(dbHits, 1);
    });

    test('NotFound for unknown tenant', async () => {
        const { svc } = buildHarness();
        await assert.rejects(() => svc.computeLimits('unknown'), /No subscription/);
    });

    test('invalidateTenant forces a re-read', async () => {
        const { svc, subRepo } = buildHarness();
        subRepo.set(buildSub());
        let dbHits = 0;
        const original = subRepo.findByTenantId.bind(subRepo);
        subRepo.findByTenantId = async (id) => {
            dbHits += 1;
            return original(id);
        };
        await svc.computeLimits('t1', NOW);
        svc.invalidateTenant('t1');
        await svc.computeLimits('t1', NOW);
        assert.equal(dbHits, 2);
    });

    test('TTL: reloads after >60 s', async () => {
        const { svc, subRepo } = buildHarness();
        subRepo.set(buildSub());
        let dbHits = 0;
        const original = subRepo.findByTenantId.bind(subRepo);
        subRepo.findByTenantId = async (id) => {
            dbHits += 1;
            return original(id);
        };
        await svc.computeLimits('t1', NOW);
        const later = new Date(NOW.getTime() + 61_000);
        await svc.computeLimits('t1', later);
        assert.equal(dbHits, 2);
    });

    test('different tenants are cached separately', async () => {
        const { svc, subRepo } = buildHarness();
        subRepo.set(buildSub({ tenantId: 't1' }));
        subRepo.set(buildSub({ tenantId: 't2', id: 'sub-2' }));
        let dbHits = 0;
        const original = subRepo.findByTenantId.bind(subRepo);
        subRepo.findByTenantId = async (id) => {
            dbHits += 1;
            return original(id);
        };
        await svc.computeLimits('t1', NOW);
        await svc.computeLimits('t2', NOW);
        await svc.computeLimits('t1', NOW);
        await svc.computeLimits('t2', NOW);
        assert.equal(dbHits, 2);
    });
});

// @requirement SC-ENTL-001 — What a tenant may do is their plan plus the add-ons they booked
// @requirement SC-ENTL-021 — A commercial edit does not reach a running contract; a feature losing its code does
describe('EntitlementService — deriveLimits + Resolution', () => {
    test('TRIAL: uses trialEntitlementPlan via DB lookup', async () => {
        const { svc, subRepo } = buildHarness({
            defaultTrialEntitlementPlan: 'PROFESSIONAL',
        });
        subRepo.set(
            buildSub({
                plan: 'STANDARD',
                status: 'TRIAL',
                trialEntitlementPlan: 'PROFESSIONAL',
            }),
        );
        const limits = await svc.computeLimits('t1', NOW);
        assert.equal(limits.plan, 'PROFESSIONAL');
        assert.equal(limits.quotas.vehicles, 50); // PROFESSIONAL default
        assert.equal(limits.features.has('DMS'), true);
    });

    test('Pilot with config: pilotEntitlementPlan overrides', async () => {
        const { svc, subRepo } = buildHarness({
            pilotEntitlementPlan: 'PROFESSIONAL',
        });
        subRepo.set(buildSub({ plan: 'STANDARD', isPilot: true }));
        const limits = await svc.computeLimits('t1', NOW);
        assert.equal(limits.plan, 'PROFESSIONAL');
    });
});

// @requirement SC-ENTL-021 — A commercial edit does not reach a running contract; a feature losing its code does
// @requirement SC-MKT-017 — One offer yields at most one contract, and only once its prices are frozen
describe('EntitlementService — V3 ContractLineItems', () => {
    test('reads entitlements from active contract snapshot without catalog join', async () => {
        const { svc, subRepo, contractRepo } = buildContractHarness();
        subRepo.set(buildSub());
        await contractRepo.create({
            tenantId: 't1',
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            priceSnapshot: {
                currency: 'EUR',
                billingCycle: 'monthly',
                subtotalNet: 61,
                discountNet: 0,
                totalNet: 61,
                vatRate: 0.19,
                totalGross: 72.59,
            },
            lineItems: [
                {
                    kind: 'plan',
                    sourceKey: 'STANDARD',
                    sourceVersionId: null,
                    titleSnapshot: 'Standard',
                    descriptionSnapshot: null,
                    quantity: 1,
                    unit: null,
                    priceNet: 49,
                    priceGross: 58.31,
                    billingCycle: 'monthly',
                    minimumTermUntil: null,
                    featuresSnapshot: ['CASHBOOK'],
                    quotaEffectsSnapshot: { users: 1, vehicles: 15 },
                    metadata: null,
                },
                {
                    kind: 'bundle',
                    sourceKey: 'FINANCE_PLUS',
                    sourceVersionId: 'deleted-bundle-version',
                    titleSnapshot: 'Finance Plus',
                    descriptionSnapshot: null,
                    quantity: 1,
                    unit: null,
                    priceNet: 12,
                    priceGross: 14.28,
                    billingCycle: 'monthly',
                    minimumTermUntil: null,
                    featuresSnapshot: ['DMS'],
                    quotaEffectsSnapshot: { storageGb: 100 },
                    metadata: null,
                },
            ],
        });

        const limits = await svc.computeLimits('t1', NOW);
        assert.equal(limits.plan, 'STANDARD');
        assert.deepEqual(limits.quotas, { users: 1, vehicles: 15, storageGb: 100 });
        assert.deepEqual([...limits.features].sort(), ['CASHBOOK', 'DMS']);
    });

    test('Contract entitlementSnapshot wins over line-item aggregation', async () => {
        const { svc, subRepo, contractRepo } = buildContractHarness();
        subRepo.set(buildSub());
        await contractRepo.create({
            tenantId: 't1',
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            entitlementSnapshot: {
                plan: 'SNAPSHOT_PLAN',
                quotas: { users: 99 },
                features: ['SNAPSHOT_FEATURE'],
            },
            priceSnapshot: {
                currency: 'EUR',
                billingCycle: 'monthly',
                subtotalNet: 49,
                discountNet: 0,
                totalNet: 49,
                vatRate: 0.19,
                totalGross: 58.31,
            },
            lineItems: [
                {
                    kind: 'plan',
                    sourceKey: 'STANDARD',
                    sourceVersionId: null,
                    titleSnapshot: 'Standard',
                    descriptionSnapshot: null,
                    quantity: 1,
                    unit: null,
                    priceNet: 49,
                    priceGross: 58.31,
                    billingCycle: 'monthly',
                    minimumTermUntil: null,
                    featuresSnapshot: ['CASHBOOK'],
                    quotaEffectsSnapshot: { users: 1 },
                    metadata: null,
                },
            ],
        });

        const limits = await svc.computeLimits('t1', NOW);
        assert.equal(limits.plan, 'SNAPSHOT_PLAN');
        assert.deepEqual(limits.quotas, { users: 99 });
        assert.deepEqual([...limits.features], ['SNAPSHOT_FEATURE']);
    });
});

describe('the read that decides takes the row lock', () => {
    // The port offers two reads and only one of them is safe here. Deciding
    // from the unlocked one lets two callers each see fourteen of fifteen used,
    // each conclude there is room, and each insert — the limit an operator sold
    // is then exceeded by the number of people who asked at once.
    //
    // The other half of the guarantee is already pinned below, where every
    // lookup is shown to receive the runner's transaction: a lock taken and
    // released before the write protects nothing.

    function watchful() {
        const { svc, subRepo, txRunner } = buildHarness();
        const seen = [];
        const locked = subRepo.findByTenantIdLocked.bind(subRepo);
        const unlocked = subRepo.findByTenantId.bind(subRepo);
        // The shipped fake emulates the lock by delegating to the plain read,
        // so that delegation is not a read the service made. Counting it would
        // report a defect nobody has — as it did on the first attempt here.
        let inside = false;
        subRepo.findByTenantIdLocked = async (...args) => {
            seen.push('locked read');
            inside = true;
            try {
                return await locked(...args);
            } finally {
                inside = false;
            }
        };
        subRepo.findByTenantId = async (...args) => {
            if (!inside) seen.push('unlocked read');
            return unlocked(...args);
        };
        return { svc, subRepo, txRunner, seen };
    }

    // @requirement SC-ENTL-007 — Two simultaneous requests cannot both take the last remaining unit of a limit
    test('enforcing a limit reads the subscription locked, never plainly', async () => {
        const { svc, subRepo, seen } = watchful();
        subRepo.set(buildSub());

        await svc.enforceLimit({
            tenantId: 't1',
            dimension: 'vehicles',
            currentUsage: async () => 10,
            insert: async () => 'created-id',
            now: NOW,
        });

        assert.deepEqual(seen, ['locked read'], 'the decision was taken on an unlocked read');
    });

    // @requirement SC-ENTL-007 — Two simultaneous requests cannot both take the last remaining unit of a limit
    test('the count and the write happen while it is still held', async () => {
        const { svc, subRepo, txRunner } = buildHarness();
        subRepo.set(buildSub());
        const order = [];
        const run = txRunner.run.bind(txRunner);
        txRunner.run = async (work) => {
            order.push('transaction opened');
            const result = await run(work);
            order.push('transaction closed');
            return result;
        };

        await svc.enforceLimit({
            tenantId: 't1',
            dimension: 'vehicles',
            currentUsage: async () => {
                order.push('counted');
                return 10;
            },
            insert: async () => {
                order.push('written');
                return 'created-id';
            },
            now: NOW,
        });

        assert.deepEqual(order, ['transaction opened', 'counted', 'written', 'transaction closed']);
    });

    test('and a limit that bites is what the lock is protecting', async () => {
        // The counter-check: both cases above would hold over a service that
        // let everybody through, and there would be no last unit to contend for.
        const { svc, subRepo } = watchful();
        subRepo.set(buildSub()); // STANDARD: vehicles=15

        await assert.rejects(
            () =>
                svc.enforceLimit({
                    tenantId: 't1',
                    dimension: 'vehicles',
                    currentUsage: async () => 15,
                    insert: async () => 'should-not-run',
                    now: NOW,
                }),
            LimitExceededError,
        );
    });
});

// @requirement SC-ENTL-008 — A single large action can be refused by a limit it would cross in one go
describe('EntitlementService.enforceLimit — transactional', () => {
    test('insert runs when under the limit', async () => {
        const { svc, subRepo, txRunner } = buildHarness();
        subRepo.set(buildSub({ plan: 'PROFESSIONAL', planVersion: PROFESSIONAL_PV }));
        let inserted = false;
        const result = await svc.enforceLimit({
            tenantId: 't1',
            dimension: 'vehicles',
            currentUsage: async () => 10,
            insert: async () => {
                inserted = true;
                return 'created-id';
            },
            now: NOW,
        });
        assert.equal(result, 'created-id');
        assert.equal(inserted, true);
        assert.equal(txRunner.runCount, 1);
    });

    test('LimitExceededError when insert would exceed the limit', async () => {
        const { svc, subRepo } = buildHarness();
        subRepo.set(buildSub()); // STANDARD: vehicles=15
        await assert.rejects(
            () =>
                svc.enforceLimit({
                    tenantId: 't1',
                    dimension: 'vehicles',
                    currentUsage: async () => 15,
                    insert: async () => 'should-not-run',
                    now: NOW,
                }),
            (err) =>
                err instanceof LimitExceededError &&
                err.dimension === 'vehicles' &&
                err.max === 15 &&
                err.used === 15,
        );
    });

    test('delta>1 for STORAGE: insert of 6 GB against 5 GB limit blocks', async () => {
        const { svc, subRepo } = buildHarness();
        subRepo.set(buildSub()); // STANDARD: storageGb=5
        await assert.rejects(
            () =>
                svc.enforceLimit({
                    tenantId: 't1',
                    dimension: 'storageGb',
                    currentUsage: async () => 0,
                    insert: async () => 'doc-id',
                    delta: 6,
                    now: NOW,
                }),
            LimitExceededError,
        );
    });

    test('-1 (unlimited) never blocks', async () => {
        const customCatalog = {
            ...CATALOG,
            plans: [
                { ...CATALOG.plans[0], quotas: { users: -1, vehicles: -1, storageGb: -1 } },
                CATALOG.plans[1],
            ],
        };
        const subRepo = new FakeSubscriptionRepository();
        const pvRepo = new FakePlanVersionRepository();
        pvRepo.set({
            planId: 'STANDARD',
            quotas: { users: -1, vehicles: -1, storageGb: -1 },
            features: ['CASHBOOK'],
        });
        const txRunner = new FakeTransactionRunner();
        const svc = new EntitlementService(customCatalog, subRepo, pvRepo, txRunner);
        subRepo.set(
            buildSub({
                planVersion: {
                    planId: 'STANDARD',
                    quotas: { users: -1, vehicles: -1, storageGb: -1 },
                    features: ['CASHBOOK'],
                },
            }),
        );
        const result = await svc.enforceLimit({
            tenantId: 't1',
            dimension: 'users',
            currentUsage: async () => 999_999,
            insert: async () => 'ok',
            now: NOW,
        });
        assert.equal(result, 'ok');
    });

    test('NotFound when subscription is missing', async () => {
        const { svc } = buildHarness();
        await assert.rejects(
            () =>
                svc.enforceLimit({
                    tenantId: 'unknown',
                    dimension: 'users',
                    currentUsage: async () => 0,
                    insert: async () => 'never',
                    now: NOW,
                }),
            /No subscription/,
        );
    });

    test('Error for unknown quota dimension', async () => {
        const { svc, subRepo } = buildHarness();
        subRepo.set(buildSub());
        await assert.rejects(
            () =>
                svc.enforceLimit({
                    tenantId: 't1',
                    dimension: 'blubb',
                    currentUsage: async () => 0,
                    insert: async () => 'never',
                    now: NOW,
                }),
            (error) => {
                // Misconfiguration → coded 500 (the status is unchanged, only
                // the body is now machine-readable).
                assert.equal(error.getStatus(), 500);
                assert.equal(error.getResponse().code, 'QUOTA_DIMENSION_UNKNOWN');
                assert.equal(error.getResponse().message, 'Unknown quota dimension "blubb".');
                assert.equal(error.getResponse().params.dimension, 'blubb');
                return true;
            },
        );
    });
});

// @requirement SC-ENTL-003 — A feature declared as not yet rolled out is never granted
describe('EntitlementService — a feature the catalog says is not built yet', () => {
    // `API_ACCESS` is `plannedOnly: true` in CATALOG. Every path below hands
    // it to the tenant from somewhere the aggregator does not see, which is
    // how it used to reach them: the filter sat in the aggregator, and a
    // frozen contract does not go through one.

    test('a contract snapshot that carries it grants everything else instead', async () => {
        const { svc, subRepo, contractRepo } = buildContractHarness();
        subRepo.set(buildSub());
        await contractRepo.create({
            tenantId: 't1',
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            entitlementSnapshot: {
                plan: 'STANDARD',
                quotas: { users: 1 },
                features: ['CASHBOOK', 'API_ACCESS'],
            },
            lineItems: [],
        });
        const limits = await svc.computeLimits('t1', NOW);
        assert.deepEqual([...limits.features], ['CASHBOOK']);
    });

    test('a contract line item that carries it is treated the same', async () => {
        const { svc, subRepo, contractRepo } = buildContractHarness();
        subRepo.set(buildSub());
        await contractRepo.create({
            tenantId: 't1',
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            lineItems: [
                {
                    kind: 'plan',
                    sourceKey: 'STANDARD',
                    sourceVersionId: null,
                    titleSnapshot: 'Standard',
                    descriptionSnapshot: null,
                    quantity: 1,
                    unit: null,
                    priceNet: 49,
                    priceGross: 58.31,
                    billingCycle: 'monthly',
                    minimumTermUntil: null,
                    featuresSnapshot: ['CASHBOOK', 'API_ACCESS'],
                    quotaEffectsSnapshot: { users: 1 },
                    metadata: null,
                },
            ],
        });
        const limits = await svc.computeLimits('t1', NOW);
        assert.deepEqual([...limits.features], ['CASHBOOK']);
    });

    test('a successor reached through a replaces chain does not slip past it', async () => {
        const subRepo = new FakeSubscriptionRepository();
        const pvRepo = new FakePlanVersionRepository();
        pvRepo.set(STANDARD_PV);
        const svc = new EntitlementService(
            CATALOG,
            subRepo,
            pvRepo,
            new FakeTransactionRunner(),
            null,
            null,
            null,
            null,
            { features: [{ featureKey: 'API_ACCESS', replaces: ['CASHBOOK'] }] },
        );
        subRepo.set(buildSub());
        const limits = await svc.computeLimits('t1', NOW);
        assert.deepEqual([...limits.features], ['CASHBOOK']);
    });

    test('a successor that is built is still granted through the same chain', async () => {
        const subRepo = new FakeSubscriptionRepository();
        const pvRepo = new FakePlanVersionRepository();
        pvRepo.set(STANDARD_PV);
        const svc = new EntitlementService(
            CATALOG,
            subRepo,
            pvRepo,
            new FakeTransactionRunner(),
            null,
            null,
            null,
            null,
            { features: [{ featureKey: 'DMS', replaces: ['CASHBOOK'] }] },
        );
        subRepo.set(buildSub());
        const limits = await svc.computeLimits('t1', NOW);
        assert.deepEqual([...limits.features].sort(), ['CASHBOOK', 'DMS']);
    });

    test('a contract keeps everything the catalog does say is built', async () => {
        const { svc, subRepo, contractRepo } = buildContractHarness();
        subRepo.set(buildSub());
        await contractRepo.create({
            tenantId: 't1',
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            entitlementSnapshot: {
                plan: 'STANDARD',
                quotas: { users: 1 },
                features: ['CASHBOOK', 'DMS'],
            },
            lineItems: [],
        });
        const limits = await svc.computeLimits('t1', NOW);
        assert.deepEqual([...limits.features].sort(), ['CASHBOOK', 'DMS']);
    });

    test('a feature the catalog has never heard of is left alone', async () => {
        const { svc, subRepo, contractRepo } = buildContractHarness();
        subRepo.set(buildSub());
        await contractRepo.create({
            tenantId: 't1',
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            entitlementSnapshot: {
                plan: 'STANDARD',
                quotas: { users: 1 },
                features: ['CASHBOOK', 'SOMETHING_THE_APP_ADDED'],
            },
            lineItems: [],
        });
        const limits = await svc.computeLimits('t1', NOW);
        assert.deepEqual([...limits.features].sort(), ['CASHBOOK', 'SOMETHING_THE_APP_ADDED']);
    });
});

// @requirement SC-BUN-033 — An add-on bought after a contract was agreed takes effect immediately
describe('EntitlementService — bundles booked after the contract was signed', () => {
    // A contract freezes what was agreed at signing time. A bundle bought
    // afterwards must take effect right away — before this it stayed without
    // consequence, because the snapshot was the only source of truth.
    function buildBundleContractHarness(bookings, versionsByid) {
        const subRepo = new FakeSubscriptionRepository();
        const pvRepo = new FakePlanVersionRepository();
        const txRunner = new FakeTransactionRunner();
        const contractRepo = new FakeSubscriptionContractRepository();
        pvRepo.set(STANDARD_PV);
        const subscriptionBundles = {
            listBySubscription: async () => bookings,
            findById: async () => null,
            listActiveBySubscription: async () => bookings,
            add: async () => {
                throw new Error('unused');
            },
            cancel: async () => {
                throw new Error('unused');
            },
            reactivate: async () => {
                throw new Error('unused');
            },
            countActiveByBundleVersionId: async () => 0,
        };
        const bundles = {
            findVersionById: async (versionId) => versionsByid[versionId] ?? null,
        };
        const svc = new EntitlementService(
            CATALOG,
            subRepo,
            pvRepo,
            txRunner,
            null,
            subscriptionBundles,
            bundles,
            contractRepo,
        );
        return { svc, subRepo, contractRepo };
    }

    const PRICE = {
        currency: 'EUR',
        billingCycle: 'monthly',
        subtotalNet: 49,
        discountNet: 0,
        totalNet: 49,
        vatRate: 0.19,
        totalGross: 58.31,
    };

    async function createSnapshotContract(contractRepo, extra = {}) {
        await contractRepo.create({
            tenantId: 't1',
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            priceSnapshot: PRICE,
            entitlementSnapshot: {
                plan: 'STANDARD',
                quotas: { users: 1, vehicles: 15, storageGb: 5 },
                features: ['CASHBOOK'],
            },
            lineItems: [],
            ...extra,
        });
    }

    test('adds features and quotas of a bundle missing from the contract', async () => {
        const { svc, subRepo, contractRepo } = buildBundleContractHarness(
            [{ bundleVersionId: 'bv-export', canceledEffectiveAt: null }],
            {
                'bv-export': { bundleKey: 'EXPORT', features: ['DMS'], quotas: { storageGb: 20 } },
            },
        );
        subRepo.set(buildSub());
        await createSnapshotContract(contractRepo);

        const limits = await svc.computeLimits('t1', NOW);

        assert.deepEqual([...limits.features].sort(), ['CASHBOOK', 'DMS']);
        assert.equal(limits.quotas.storageGb, 25);
        // The frozen plan itself stays untouched.
        assert.equal(limits.plan, 'STANDARD');
        assert.equal(limits.quotas.vehicles, 15);
    });

    test('does not count a bundle already frozen into the contract twice', async () => {
        const { svc, subRepo, contractRepo } = buildBundleContractHarness(
            [{ bundleVersionId: 'bv-frozen', canceledEffectiveAt: null }],
            {
                'bv-frozen': { bundleKey: 'FROZEN', features: ['DMS'], quotas: { storageGb: 20 } },
            },
        );
        subRepo.set(buildSub());
        await createSnapshotContract(contractRepo, {
            originalBundleVersionIds: ['bv-frozen'],
            entitlementSnapshot: {
                plan: 'STANDARD',
                quotas: { users: 1, vehicles: 15, storageGb: 25 },
                features: ['CASHBOOK', 'DMS'],
            },
        });

        const limits = await svc.computeLimits('t1', NOW);

        assert.equal(limits.quotas.storageGb, 25);
        assert.deepEqual([...limits.features].sort(), ['CASHBOOK', 'DMS']);
    });

    test('skips a bundle already covered by a contract line item', async () => {
        const { svc, subRepo, contractRepo } = buildBundleContractHarness(
            [{ bundleVersionId: 'bv-line', canceledEffectiveAt: null }],
            { 'bv-line': { bundleKey: 'LINE', features: ['DMS'], quotas: { storageGb: 30 } } },
        );
        subRepo.set(buildSub());
        await contractRepo.create({
            tenantId: 't1',
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            priceSnapshot: PRICE,
            lineItems: [
                {
                    kind: 'plan',
                    sourceKey: 'STANDARD',
                    sourceVersionId: null,
                    titleSnapshot: 'Standard',
                    descriptionSnapshot: null,
                    quantity: 1,
                    unit: null,
                    priceNet: 49,
                    priceGross: 58.31,
                    billingCycle: 'monthly',
                    minimumTermUntil: null,
                    featuresSnapshot: ['CASHBOOK'],
                    quotaEffectsSnapshot: { storageGb: 5 },
                    metadata: null,
                },
                {
                    kind: 'bundle',
                    sourceKey: 'LINE',
                    sourceVersionId: 'bv-line',
                    titleSnapshot: 'Line',
                    descriptionSnapshot: null,
                    quantity: 1,
                    unit: null,
                    priceNet: 12,
                    priceGross: 14.28,
                    billingCycle: 'monthly',
                    minimumTermUntil: null,
                    featuresSnapshot: ['DMS'],
                    quotaEffectsSnapshot: { storageGb: 30 },
                    metadata: null,
                },
            ],
        });

        const limits = await svc.computeLimits('t1', NOW);

        assert.equal(limits.quotas.storageGb, 35);
    });

    test('does not grant a plannedOnly feature from a later bundle', async () => {
        // API_ACCESS is flagged plannedOnly in the catalog — the plan path
        // filters it out, and the contract path must behave the same.
        const { svc, subRepo, contractRepo } = buildBundleContractHarness(
            [{ bundleVersionId: 'bv-planned', canceledEffectiveAt: null }],
            {
                'bv-planned': {
                    bundleKey: 'PLANNED',
                    features: ['API_ACCESS', 'DMS'],
                    quotas: {},
                },
            },
        );
        subRepo.set(buildSub());
        await createSnapshotContract(contractRepo);

        const limits = await svc.computeLimits('t1', NOW);

        assert.deepEqual([...limits.features].sort(), ['CASHBOOK', 'DMS']);
    });

    test('ignores a booking that is already canceled', async () => {
        const { svc, subRepo, contractRepo } = buildBundleContractHarness(
            [
                {
                    bundleVersionId: 'bv-gone',
                    canceledEffectiveAt: new Date('2026-04-01T00:00:00.000Z'),
                },
            ],
            { 'bv-gone': { bundleKey: 'GONE', features: ['DMS'], quotas: { storageGb: 20 } } },
        );
        subRepo.set(buildSub());
        await createSnapshotContract(contractRepo);

        const limits = await svc.computeLimits('t1', NOW);

        assert.deepEqual([...limits.features], ['CASHBOOK']);
        assert.equal(limits.quotas.storageGb, 5);
    });
});

// @requirement SC-ENTL-007 — Two simultaneous requests cannot both take the last remaining unit of a limit
describe('EntitlementService.enforceLimit — forwards tx to lookup ports (#70)', () => {
    test('contract, bundle and bundle-version lookups receive the runner tx', async () => {
        const subRepo = new FakeSubscriptionRepository();
        const pvRepo = new FakePlanVersionRepository();
        const txRunner = new FakeTransactionRunner();
        pvRepo.set(STANDARD_PV);
        subRepo.set(buildSub());

        const seen = { contract: [], bundles: [], versions: [] };
        const contractRepo = {
            list: async () => [],
            findById: async () => null,
            findActiveByTenantId: async (_tenantId, _asOf, tx) => {
                seen.contract.push(tx);
                return null;
            },
            create: async () => {
                throw new Error('unused');
            },
            terminate: async () => {
                throw new Error('unused');
            },
        };
        const subscriptionBundles = {
            listBySubscription: async () => [],
            findById: async () => null,
            listActiveBySubscription: async (_subscriptionId, _asOf, tx) => {
                seen.bundles.push(tx);
                return [{ bundleVersionId: 'bv-1', canceledEffectiveAt: null }];
            },
            add: async () => {
                throw new Error('unused');
            },
            cancel: async () => {
                throw new Error('unused');
            },
            reactivate: async () => {
                throw new Error('unused');
            },
            countActiveByBundleVersionId: async () => 0,
        };
        const bundles = {
            // Nur der im Entitlement-Pfad berührte Teil des BundleRepository-Ports.
            findVersionById: async (_versionId, tx) => {
                seen.versions.push(tx);
                return { bundleKey: 'B1', features: [], quotas: {} };
            },
        };

        const svc = new EntitlementService(
            CATALOG,
            subRepo,
            pvRepo,
            txRunner,
            null,
            subscriptionBundles,
            bundles,
            contractRepo,
        );

        const result = await svc.enforceLimit({
            tenantId: 't1',
            dimension: 'vehicles',
            currentUsage: async () => 0,
            insert: async () => 'created-id',
            now: NOW,
        });

        assert.equal(result, 'created-id');
        assert.deepEqual(seen.contract, [FakeTransactionRunner.TX_SENTINEL]);
        assert.deepEqual(seen.bundles, [FakeTransactionRunner.TX_SENTINEL]);
        assert.deepEqual(seen.versions, [FakeTransactionRunner.TX_SENTINEL]);
    });
});
