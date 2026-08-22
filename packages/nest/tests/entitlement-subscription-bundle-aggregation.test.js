import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    aggregateLimits,
    aggregateSubscriptionBundleQuotas,
    collectSubscriptionBundleFeatures,
    filterActiveSubscriptionBundles,
} from '../dist/entitlement/index.js';

// SubscriptionBundle aggregation (P11.7.3) — pure-function tests against
// the new helpers + integration in `aggregateLimits`. Bundles add
// additively to PlanVersion quotas/features (with -1 dominance and
// set union).

const NOW = new Date('2026-05-08T12:00:00Z');
const PAST = new Date('2026-04-01T00:00:00Z');
const FUTURE = new Date('2026-08-01T00:00:00Z');

const CATALOG = {
    schemaVersion: 1,
    projectKey: 'demoapp',
    currency: 'EUR',
    vatRate: 19,
    features: [{ key: 'CASHBOOK' }, { key: 'DMS' }, { key: 'CAMPAIGNS' }],
    plans: [
        {
            id: 'STARTER',
            label: 'Starter',
            marketed: true,
            monthlyNet: 9.9,
            yearlyNet: 99,
            quotas: { users: 1, storageGb: 5 },
            features: ['CASHBOOK'],
        },
    ],
};

const PLAN_INPUT = {
    plan: 'STARTER',
    planVersion: { planId: 'STARTER', quotas: { users: 1, storageGb: 5 }, features: ['CASHBOOK'] },
};

describe('SubscriptionBundle aggregation (P11.7.3)', () => {
    test('filterActiveSubscriptionBundles: canceled with a past effective date are dropped', () => {
        const bundles = [
            { bundleKey: 'A', features: ['DMS'], quotas: {}, canceledEffectiveAt: null },
            { bundleKey: 'B', features: ['CAMPAIGNS'], quotas: {}, canceledEffectiveAt: PAST },
            { bundleKey: 'C', features: ['CASHBOOK'], quotas: {}, canceledEffectiveAt: FUTURE },
        ];
        const active = filterActiveSubscriptionBundles(bundles, NOW);
        assert.deepEqual(
            active.map((b) => b.bundleKey),
            ['A', 'C'],
        );
    });

    test('aggregateSubscriptionBundleQuotas: Σ per key, -1 dominates', () => {
        const sums = aggregateSubscriptionBundleQuotas([
            {
                bundleKey: 'A',
                features: [],
                quotas: { users: 5, storageGb: 10 },
                canceledEffectiveAt: null,
            },
            { bundleKey: 'B', features: [], quotas: { users: 3 }, canceledEffectiveAt: null },
            { bundleKey: 'C', features: [], quotas: { storageGb: -1 }, canceledEffectiveAt: null },
        ]);
        assert.equal(sums.users, 8);
        assert.equal(sums.storageGb, -1);
    });

    test('collectSubscriptionBundleFeatures: set union', () => {
        const features = collectSubscriptionBundleFeatures([
            {
                bundleKey: 'A',
                features: ['DMS', 'CASHBOOK'],
                quotas: {},
                canceledEffectiveAt: null,
            },
            {
                bundleKey: 'B',
                features: ['CASHBOOK', 'CAMPAIGNS'],
                quotas: {},
                canceledEffectiveAt: null,
            },
        ]);
        assert.deepEqual([...features].sort(), ['CAMPAIGNS', 'CASHBOOK', 'DMS']);
    });

    test('aggregateLimits: bundle quotas add to plan quotas + bundle features are included', () => {
        const limits = aggregateLimits(
            {
                ...PLAN_INPUT,
                subscriptionBundles: [
                    {
                        bundleKey: 'PRO_PACK',
                        features: ['DMS'],
                        quotas: { users: 4, storageGb: 50 },
                        canceledEffectiveAt: null,
                    },
                ],
            },
            CATALOG,
            NOW,
        );
        assert.equal(limits.quotas.users, 5); // 1 plan + 4 bundle
        assert.equal(limits.quotas.storageGb, 55); // 5 plan + 50 bundle
        assert.ok(limits.features.has('CASHBOOK'));
        assert.ok(limits.features.has('DMS'));
    });

    test('aggregateLimits: canceled bundle is ignored', () => {
        const limits = aggregateLimits(
            {
                ...PLAN_INPUT,
                subscriptionBundles: [
                    {
                        bundleKey: 'CAMP_PACK',
                        features: ['CAMPAIGNS'],
                        quotas: { users: 100 },
                        canceledEffectiveAt: PAST,
                    },
                ],
            },
            CATALOG,
            NOW,
        );
        assert.equal(limits.quotas.users, 1); // bundle ignored
        assert.equal(limits.features.has('CAMPAIGNS'), false);
    });

    test('aggregateLimits: -1 in a bundle quota makes the total quota unlimited', () => {
        const limits = aggregateLimits(
            {
                ...PLAN_INPUT,
                subscriptionBundles: [
                    {
                        bundleKey: 'UNLIMITED_STORAGE',
                        features: [],
                        quotas: { storageGb: -1 },
                        canceledEffectiveAt: null,
                    },
                ],
            },
            CATALOG,
            NOW,
        );
        assert.equal(limits.quotas.storageGb, -1);
    });

    test('aggregateLimits without subscriptionBundles → plan-only behavior unchanged', () => {
        const withoutBundles = aggregateLimits(PLAN_INPUT, CATALOG, NOW);
        const withEmptyBundles = aggregateLimits(
            { ...PLAN_INPUT, subscriptionBundles: [] },
            CATALOG,
            NOW,
        );
        assert.deepEqual(withoutBundles.quotas, withEmptyBundles.quotas);
        assert.deepEqual(
            [...withoutBundles.features].sort(),
            [...withEmptyBundles.features].sort(),
        );
    });
});
