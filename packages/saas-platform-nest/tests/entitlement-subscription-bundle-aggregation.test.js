import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    aggregateLimits,
    aggregateSubscriptionBundleQuotas,
    collectSubscriptionBundleFeatures,
    filterActiveSubscriptionBundles,
} from '../dist/entitlement/index.js';

// SubscriptionBundle-Aggregation (P11.7.3) — Pure-Function-Tests gegen
// die neuen Helper + Integration in `aggregateLimits`. Bundles addieren
// additiv zu PlanVersion-Quotas/Features (mit -1-Dominanz und
// Set-Union).

const NOW = new Date('2026-05-08T12:00:00Z');
const PAST = new Date('2026-04-01T00:00:00Z');
const FUTURE = new Date('2026-08-01T00:00:00Z');

const CATALOG = {
    schemaVersion: 1,
    projectKey: 'autohauspro',
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

describe('SubscriptionBundle-Aggregation (P11.7.3)', () => {
    test('filterActiveSubscriptionBundles: gekündigte mit vergangenem Effektiv-Datum raus', () => {
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

    test('aggregateSubscriptionBundleQuotas: Σ pro Key, -1 dominiert', () => {
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

    test('collectSubscriptionBundleFeatures: Set-Union', () => {
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

    test('aggregateLimits: Bundle-Quotas addieren zu Plan-Quotas + Bundle-Features kommen dazu', () => {
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

    test('aggregateLimits: gekündigte Bundle wird ignoriert', () => {
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
        assert.equal(limits.quotas.users, 1); // bundle ignoriert
        assert.equal(limits.features.has('CAMPAIGNS'), false);
    });

    test('aggregateLimits: -1 in Bundle-Quota macht Gesamt-Quota unbegrenzt', () => {
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

    test('aggregateLimits ohne subscriptionBundles → Plan-only-Verhalten unverändert', () => {
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
