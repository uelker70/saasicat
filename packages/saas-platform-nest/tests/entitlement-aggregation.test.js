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
    projectKey: 'autohauspro',
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
    test('plannedOnly-Features werden ausgefiltert', () => {
        const out = filterPlannedOnlyFeatures(new Set(['CASHBOOK', 'API_ACCESS']), CATALOG);
        assert.deepEqual([...out], ['CASHBOOK']);
    });

    test('Unbekannte Features (nicht im Catalog) bleiben drin', () => {
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

    test('null/undefined Custom: keine Änderung', () => {
        const r1 = applyCustomLimits(base, null);
        const r2 = applyCustomLimits(base, undefined);
        assert.deepEqual(r1.quotas, base.quotas);
        assert.deepEqual([...r1.features], [...base.features]);
        assert.deepEqual(r2.quotas, base.quotas);
    });

    test('quotas-Override überschreibt feldweise', () => {
        const r = applyCustomLimits(base, { quotas: { vehicles: 9999 } });
        assert.equal(r.quotas.vehicles, 9999);
        assert.equal(r.quotas.users, 1); // unverändert
        assert.equal(r.quotas.storageGb, 5);
    });

    test('features-Override ergänzt', () => {
        const r = applyCustomLimits(base, { features: ['DMS', 'CALENDAR'] });
        assert.equal(r.features.has('CASHBOOK'), true);
        assert.equal(r.features.has('DMS'), true);
        assert.equal(r.features.has('CALENDAR'), true);
    });

    test('Mutation des Inputs ist verboten (Pure Function)', () => {
        const before = { ...base.quotas };
        applyCustomLimits(base, { quotas: { vehicles: 9999 } });
        assert.deepEqual(base.quotas, before);
    });
});

describe('aggregateLimits — Hauptaggregator', () => {
    test('Plan-Default ohne Bundles', () => {
        const r = aggregateLimits({ plan: 'BASIC', planVersion: PLAN_VERSION }, CATALOG, NOW);
        assert.equal(r.plan, 'BASIC');
        assert.deepEqual(r.quotas, { users: 1, vehicles: 50, storageGb: 5 });
        assert.deepEqual([...r.features], ['CASHBOOK']);
    });

    test('Plan + Bundle-Quotas summieren additiv', () => {
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

    test('Bundle-Features ergänzen das features-Set', () => {
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

    test('plannedOnly-Features werden konsequent ausgeblendet', () => {
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

    test('customLimits.quotas überschreibt Plan + Bundles', () => {
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
        assert.equal(r.quotas.users, 999); // Override gewinnt über (1 + 5)
    });

    test('Gekündigte Bundles (canceledEffectiveAt < now) gehen nicht ein', () => {
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
        assert.equal(r.quotas.users, 1); // nur Plan-Default
    });

    test('Bundle-Quota in einer Quota-Dimension, die der Plan nicht hat, wird durchgereicht', () => {
        const planWithoutStorage = {
            ...PLAN_VERSION,
            quotas: { users: 1, vehicles: 50 }, // kein storageGb
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
    test('hasFeature trifft', () => {
        assert.equal(hasFeature(limits, 'CASHBOOK'), true);
        assert.equal(hasFeature(limits, 'CALENDAR'), false);
    });
    test('hasAnyFeature: mindestens eines reicht', () => {
        assert.equal(hasAnyFeature(limits, ['CALENDAR', 'DMS']), true);
        assert.equal(hasAnyFeature(limits, ['CALENDAR', 'API_ACCESS']), false);
    });
    test('hasAnyFeature: leere Liste → false', () => {
        assert.equal(hasAnyFeature(limits, []), false);
    });
});

describe('toEffectiveLimitsSnapshot', () => {
    test('Set wird zu sortiertem Array (deterministisch)', () => {
        const snap = toEffectiveLimitsSnapshot({
            plan: 'BASIC',
            quotas: { users: 5 },
            features: new Set(['DMS', 'CASHBOOK', 'CALENDAR']),
        });
        assert.deepEqual(snap.features, ['CALENDAR', 'CASHBOOK', 'DMS']);
        assert.deepEqual(snap.quotas, { users: 5 });
        assert.equal(snap.plan, 'BASIC');
    });

    test('Snapshot ist unabhängig vom Original-Quota-Object (deep-copy)', () => {
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
