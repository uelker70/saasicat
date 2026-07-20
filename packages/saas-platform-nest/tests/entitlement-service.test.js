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
    projectKey: 'demoapp',
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

describe('EntitlementService — computeLimits + Cache', () => {
    test('liefert Plan-Default-Limits für STANDARD', async () => {
        const { svc, subRepo } = buildHarness();
        subRepo.set(buildSub());
        const limits = await svc.computeLimits('t1', NOW);
        assert.equal(limits.plan, 'STANDARD');
        assert.deepEqual(limits.quotas, { users: 1, vehicles: 15, storageGb: 5 });
        assert.deepEqual([...limits.features], ['CASHBOOK']);
    });

    test('zweiter Aufruf am selben Tenant geht NICHT in die DB', async () => {
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

    test('NotFound bei unbekanntem Tenant', async () => {
        const { svc } = buildHarness();
        await assert.rejects(() => svc.computeLimits('unknown'), /Keine Subscription/);
    });

    test('invalidateTenant erzwingt Re-Read', async () => {
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

    test('TTL: nach >60 s wird neu geladen', async () => {
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

    test('verschiedene Tenants werden separat gecached', async () => {
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

describe('EntitlementService — deriveLimits + Resolution', () => {
    test('TRIAL: nutzt trialEntitlementPlan über DB-Lookup', async () => {
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
        assert.equal(limits.quotas.vehicles, 50); // PROFESSIONAL-Default
        assert.equal(limits.features.has('DMS'), true);
    });

    test('Pilot mit Config: pilotEntitlementPlan überschreibt', async () => {
        const { svc, subRepo } = buildHarness({
            pilotEntitlementPlan: 'PROFESSIONAL',
        });
        subRepo.set(buildSub({ plan: 'STANDARD', isPilot: true }));
        const limits = await svc.computeLimits('t1', NOW);
        assert.equal(limits.plan, 'PROFESSIONAL');
    });

});

describe('EntitlementService — V3 ContractLineItems', () => {
    test('liest Entitlements aus aktivem Contract-Snapshot ohne Katalog-Join', async () => {
        const { svc, subRepo, contractRepo } = buildContractHarness();
        subRepo.set(buildSub());
        await contractRepo.create({
            projectKey: 'demoapp',
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

    test('Contract entitlementSnapshot gewinnt vor LineItem-Aggregation', async () => {
        const { svc, subRepo, contractRepo } = buildContractHarness();
        subRepo.set(buildSub());
        await contractRepo.create({
            projectKey: 'demoapp',
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

describe('EntitlementService.enforceLimit — transactional', () => {
    test('Insert läuft, wenn unter Limit', async () => {
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

    test('LimitExceededError, wenn Insert das Limit überschreiten würde', async () => {
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

    test('delta>1 für STORAGE: Insert mit 6 GB gegen 5 GB Limit blockt', async () => {
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

    test('-1 (unbegrenzt) blockt nie', async () => {
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

    test('NotFound, wenn Subscription fehlt', async () => {
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
            /Keine Subscription/,
        );
    });

    test('Error bei unbekannter Quota-Dimension', async () => {
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
            /Quota-Dimension "blubb"/,
        );
    });
});
