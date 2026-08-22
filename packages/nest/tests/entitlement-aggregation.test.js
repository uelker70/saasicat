import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    aggregateLimits,
    applyCustomLimits,
    filterPlannedOnlyFeatures,
    hasAnyFeature,
    hasFeature,
    toEffectiveLimitsSnapshot,
} from '../dist/entitlement/index.js';

const NOW = new Date('2026-05-08T12:00:00Z');

const CATALOG = {
    schemaVersion: 1,
    projectKey: 'demoapp',
    currency: 'EUR',
    vatRate: 19,
    features: [
        { key: 'CASHBOOK' },
        { key: 'DMS' },
        { key: 'CALENDAR' },
        { key: 'API_ACCESS', plannedOnly: true },
        { key: 'SSO', plannedOnly: true },
        { key: 'AI_ASSISTANT_BASIC' },
        { key: 'AI_ASSISTANT_EXTENDED' },
    ],
    plans: [
        {
            id: 'BASIC',
            label: 'Basic',
            marketed: true,
            monthlyNet: 19,
            yearlyNet: 190,
            quotas: { users: 1, vehicles: 50, storageGb: 5 },
            features: ['CASHBOOK'],
        },
    ],
};

const PLAN_VERSION = {
    planId: 'BASIC',
    quotas: { users: 1, vehicles: 50, storageGb: 5 },
    features: ['CASHBOOK'],
};

describe('filterPlannedOnlyFeatures', () => {
    test('plannedOnly features are filtered out', () => {
        const out = filterPlannedOnlyFeatures(new Set(['CASHBOOK', 'API_ACCESS']), CATALOG);
        assert.deepEqual([...out], ['CASHBOOK']);
    });

    test('unknown features (not in catalog) stay in', () => {
        const out = filterPlannedOnlyFeatures(new Set(['UNKNOWN_FEATURE']), CATALOG);
        assert.deepEqual([...out], ['UNKNOWN_FEATURE']);
    });
});

describe('applyCustomLimits', () => {
    const base = {
        plan: 'BASIC',
        quotas: { users: 1, vehicles: 50, storageGb: 5 },
        features: new Set(['CASHBOOK']),
    };

    test('null/undefined custom: no change', () => {
        const r1 = applyCustomLimits(base, null);
        const r2 = applyCustomLimits(base, undefined);
        assert.deepEqual(r1.quotas, base.quotas);
        assert.deepEqual([...r1.features], [...base.features]);
        assert.deepEqual(r2.quotas, base.quotas);
    });

    test('quotas override overwrites field by field', () => {
        const r = applyCustomLimits(base, { quotas: { vehicles: 9999 } });
        assert.equal(r.quotas.vehicles, 9999);
        assert.equal(r.quotas.users, 1); // unchanged
        assert.equal(r.quotas.storageGb, 5);
    });

    test('features override adds', () => {
        const r = applyCustomLimits(base, { features: ['DMS', 'CALENDAR'] });
        assert.equal(r.features.has('CASHBOOK'), true);
        assert.equal(r.features.has('DMS'), true);
        assert.equal(r.features.has('CALENDAR'), true);
    });

    test('mutation of the input is forbidden (pure function)', () => {
        const before = { ...base.quotas };
        applyCustomLimits(base, { quotas: { vehicles: 9999 } });
        assert.deepEqual(base.quotas, before);
    });
});

describe('aggregateLimits — main aggregator', () => {
    test('plan default without bundles', () => {
        const r = aggregateLimits({ plan: 'BASIC', planVersion: PLAN_VERSION }, CATALOG, NOW);
        assert.equal(r.plan, 'BASIC');
        assert.deepEqual(r.quotas, { users: 1, vehicles: 50, storageGb: 5 });
        assert.deepEqual([...r.features], ['CASHBOOK']);
    });

    test('plan + bundle quotas sum additively', () => {
        const r = aggregateLimits(
            {
                plan: 'BASIC',
                planVersion: PLAN_VERSION,
                subscriptionBundles: [
                    {
                        bundleKey: 'TEAM',
                        features: [],
                        quotas: { users: 5, storageGb: 100 },
                        canceledEffectiveAt: null,
                    },
                ],
            },
            CATALOG,
            NOW,
        );
        assert.equal(r.quotas.users, 6); // 1 plan + 5 bundle
        assert.equal(r.quotas.storageGb, 105); // 5 plan + 100 bundle
    });

    test('bundle features add to the features set', () => {
        const r = aggregateLimits(
            {
                plan: 'BASIC',
                planVersion: PLAN_VERSION,
                subscriptionBundles: [
                    {
                        bundleKey: 'AI_BUNDLE',
                        features: ['AI_ASSISTANT_BASIC', 'AI_ASSISTANT_EXTENDED'],
                        quotas: {},
                        canceledEffectiveAt: null,
                    },
                ],
            },
            CATALOG,
            NOW,
        );
        assert.equal(r.features.has('CASHBOOK'), true);
        assert.equal(r.features.has('AI_ASSISTANT_BASIC'), true);
        assert.equal(r.features.has('AI_ASSISTANT_EXTENDED'), true);
    });

    test('plannedOnly features are consistently hidden', () => {
        const r = aggregateLimits(
            {
                plan: 'BASIC',
                planVersion: { ...PLAN_VERSION, features: ['CASHBOOK', 'API_ACCESS'] },
                customLimits: { features: ['SSO'] },
            },
            CATALOG,
            NOW,
        );
        assert.equal(r.features.has('CASHBOOK'), true);
        assert.equal(r.features.has('API_ACCESS'), false);
        assert.equal(r.features.has('SSO'), false);
    });

    test('customLimits.quotas overrides plan + bundles', () => {
        const r = aggregateLimits(
            {
                plan: 'BASIC',
                planVersion: PLAN_VERSION,
                subscriptionBundles: [
                    {
                        bundleKey: 'TEAM',
                        features: [],
                        quotas: { users: 5 },
                        canceledEffectiveAt: null,
                    },
                ],
                customLimits: { quotas: { users: 999 } },
            },
            CATALOG,
            NOW,
        );
        assert.equal(r.quotas.users, 999); // override wins over (1 + 5)
    });

    test('canceled bundles (canceledEffectiveAt < now) are not included', () => {
        const r = aggregateLimits(
            {
                plan: 'BASIC',
                planVersion: PLAN_VERSION,
                subscriptionBundles: [
                    {
                        bundleKey: 'TEAM',
                        features: [],
                        quotas: { users: 5 },
                        canceledEffectiveAt: new Date('2026-04-01T00:00:00Z'),
                    },
                ],
            },
            CATALOG,
            NOW,
        );
        assert.equal(r.quotas.users, 1); // plan default only
    });

    test('bundle quota in a quota dimension the plan does not have is passed through', () => {
        const planWithoutStorage = {
            ...PLAN_VERSION,
            quotas: { users: 1, vehicles: 50 }, // no storageGb
        };
        const r = aggregateLimits(
            {
                plan: 'BASIC',
                planVersion: planWithoutStorage,
                subscriptionBundles: [
                    {
                        bundleKey: 'STORAGE',
                        features: [],
                        quotas: { storageGb: 50 },
                        canceledEffectiveAt: null,
                    },
                ],
            },
            CATALOG,
            NOW,
        );
        assert.equal(r.quotas.storageGb, 50);
    });
});

describe('hasFeature / hasAnyFeature', () => {
    const limits = {
        plan: 'BASIC',
        quotas: {},
        features: new Set(['CASHBOOK', 'DMS']),
    };
    test('hasFeature matches', () => {
        assert.equal(hasFeature(limits, 'CASHBOOK'), true);
        assert.equal(hasFeature(limits, 'CALENDAR'), false);
    });
    test('hasAnyFeature: at least one is enough', () => {
        assert.equal(hasAnyFeature(limits, ['CALENDAR', 'DMS']), true);
        assert.equal(hasAnyFeature(limits, ['CALENDAR', 'API_ACCESS']), false);
    });
    test('hasAnyFeature: empty list → false', () => {
        assert.equal(hasAnyFeature(limits, []), false);
    });
});

describe('toEffectiveLimitsSnapshot', () => {
    test('set becomes sorted array (deterministic)', () => {
        const snap = toEffectiveLimitsSnapshot({
            plan: 'BASIC',
            quotas: { users: 5 },
            features: new Set(['DMS', 'CASHBOOK', 'CALENDAR']),
        });
        assert.deepEqual(snap.features, ['CALENDAR', 'CASHBOOK', 'DMS']);
        assert.deepEqual(snap.quotas, { users: 5 });
        assert.equal(snap.plan, 'BASIC');
    });

    test('snapshot is independent of the original quota object (deep copy)', () => {
        const limits = {
            plan: 'BASIC',
            quotas: { users: 5 },
            features: new Set(['DMS']),
        };
        const snap = toEffectiveLimitsSnapshot(limits);
        snap.quotas.users = 999;
        assert.equal(limits.quotas.users, 5);
    });
});
