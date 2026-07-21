import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    aggregateBusinessTypeQuotas,
    aggregateLimits,
    collectBusinessTypeFeatures,
} from '../dist/entitlement/index.js';

// SPEC_V2 §11.1 M5 + GESCHAEFTSTYP_SPEC §6 — BusinessType share in
// entitlement aggregation. Tests run pure-function against the new
// helpers plus three paths through aggregateLimits.

const NOW = new Date('2026-05-14T12:00:00Z');

const MIN_CATALOG = {
    schemaVersion: 1,
    projectKey: 'clubapp',
    currency: 'EUR',
    vatRate: 19,
    features: [
        { key: 'CORE_IDENTITY' },
        { key: 'SPORT_TEAMS' },
        { key: 'SPORT_RESOURCES' },
        { key: 'WHATSAPP' },
    ],
    plans: [
        {
            id: 'STARTER',
            label: 'Starter',
            marketed: true,
            monthlyNet: 19,
            yearlyNet: 190,
            quotas: { members: 250, storageGb: 2 },
            features: ['CORE_IDENTITY'],
        },
    ],
};

const PLAN_VERSION = {
    planId: 'STARTER',
    quotas: { members: 250, storageGb: 2 },
    features: ['CORE_IDENTITY'],
};

const SPORT_BUNDLE = {
    bundleKey: 'SPORT_BUNDLE',
    quotas: { members: 250, resources: 5 },
    features: ['SPORT_TEAMS', 'SPORT_RESOURCES'],
};

// ─────────────────────────────────────────────────────────────────
// aggregateBusinessTypeQuotas — Σ + override + -1 dominance
// ─────────────────────────────────────────────────────────────────

describe('aggregateBusinessTypeQuotas', () => {
    test('Σ over all bundles per quotaKey', () => {
        const result = aggregateBusinessTypeQuotas({
            businessTypeKey: 'X',
            bundles: [
                { bundleKey: 'A', quotas: { members: 100, storageGb: 5 }, features: [] },
                { bundleKey: 'B', quotas: { members: 50, resources: 5 }, features: [] },
            ],
            quotaOverrides: {},
        });
        assert.deepEqual(result, { members: 150, storageGb: 5, resources: 5 });
    });

    test('-1 (unlimited) dominates the Σ', () => {
        const result = aggregateBusinessTypeQuotas({
            businessTypeKey: 'X',
            bundles: [
                { bundleKey: 'A', quotas: { members: 100 }, features: [] },
                { bundleKey: 'B', quotas: { members: -1 }, features: [] },
            ],
            quotaOverrides: {},
        });
        assert.equal(result.members, -1);
    });

    test('override replaces Σ per set key', () => {
        const result = aggregateBusinessTypeQuotas({
            businessTypeKey: 'X',
            bundles: [
                { bundleKey: 'A', quotas: { members: 100, storageGb: 5 }, features: [] },
                { bundleKey: 'B', quotas: { members: 50 }, features: [] },
            ],
            quotaOverrides: { members: 1000 },
        });
        // members replaced by override 1000; storageGb stays Σ = 5
        assert.deepEqual(result, { members: 1000, storageGb: 5 });
    });

    test('override -1 replaces Σ with -1', () => {
        const result = aggregateBusinessTypeQuotas({
            businessTypeKey: 'X',
            bundles: [{ bundleKey: 'A', quotas: { members: 100 }, features: [] }],
            quotaOverrides: { members: -1 },
        });
        assert.equal(result.members, -1);
    });
});

// ─────────────────────────────────────────────────────────────────
// collectBusinessTypeFeatures — set union
// ─────────────────────────────────────────────────────────────────

describe('collectBusinessTypeFeatures', () => {
    test('set union over all bundles', () => {
        const result = collectBusinessTypeFeatures({
            businessTypeKey: 'X',
            bundles: [
                { bundleKey: 'A', quotas: {}, features: ['F1', 'F2'] },
                { bundleKey: 'B', quotas: {}, features: ['F3'] },
            ],
            quotaOverrides: {},
        });
        assert.deepEqual([...result].sort(), ['F1', 'F2', 'F3']);
    });

    test('deduplicates duplicate features (set semantics)', () => {
        const result = collectBusinessTypeFeatures({
            businessTypeKey: 'X',
            bundles: [
                { bundleKey: 'A', quotas: {}, features: ['F1', 'SHARED'] },
                { bundleKey: 'B', quotas: {}, features: ['SHARED', 'F2'] },
            ],
            quotaOverrides: {},
        });
        assert.deepEqual([...result].sort(), ['F1', 'F2', 'SHARED']);
    });
});

// ─────────────────────────────────────────────────────────────────
// aggregateLimits — paths: plan-only, plan+BusinessType, +bundles
// ─────────────────────────────────────────────────────────────────

describe('aggregateLimits — plan + BusinessType + bundles', () => {
    test('plan-only (no BusinessType, no bundles) — as before', () => {
        const limits = aggregateLimits(
            {
                plan: 'STARTER',
                planVersion: PLAN_VERSION,
            },
            MIN_CATALOG,
            NOW,
        );
        assert.equal(limits.plan, 'STARTER');
        assert.deepEqual(limits.quotas, { members: 250, storageGb: 2 });
        assert.deepEqual([...limits.features].sort(), ['CORE_IDENTITY']);
    });

    test('plan + BusinessType (without bundles): quotas summed, features unioned', () => {
        const limits = aggregateLimits(
            {
                plan: 'STARTER',
                planVersion: PLAN_VERSION,
                businessTypeVersion: {
                    businessTypeKey: 'SPORT_VEREIN',
                    bundles: [SPORT_BUNDLE],
                    quotaOverrides: {},
                },
            },
            MIN_CATALOG,
            NOW,
        );
        // Plan members 250 + Bundle members 250 = 500
        // Plan storageGb 2 + Bundle has none = 2
        // Bundle resources 5 (Plan has none) = 5
        assert.deepEqual(limits.quotas, { members: 500, storageGb: 2, resources: 5 });
        assert.deepEqual([...limits.features].sort(), [
            'CORE_IDENTITY',
            'SPORT_RESOURCES',
            'SPORT_TEAMS',
        ]);
    });

    test('plan + BusinessType + QuotaOverride: override beats Σ', () => {
        const limits = aggregateLimits(
            {
                plan: 'STARTER',
                planVersion: PLAN_VERSION,
                businessTypeVersion: {
                    businessTypeKey: 'SPORT_VEREIN',
                    bundles: [SPORT_BUNDLE],
                    quotaOverrides: { members: 1000 }, // replaces bundle Σ (250)
                },
            },
            MIN_CATALOG,
            NOW,
        );
        // members: Plan 250 + BusinessType override 1000 = 1250
        // (plan default + BusinessType share; override only applies to bundle Σ replacement)
        assert.equal(limits.quotas.members, 1250);
    });

    test('plan + BusinessType + SubscriptionBundles (all sources)', () => {
        const limits = aggregateLimits(
            {
                plan: 'STARTER',
                planVersion: PLAN_VERSION,
                subscriptionBundles: [
                    {
                        bundleKey: 'WHATSAPP_PACK',
                        features: ['WHATSAPP'],
                        quotas: { members: 500 },
                        canceledEffectiveAt: null,
                    },
                ],
                businessTypeVersion: {
                    businessTypeKey: 'SPORT_VEREIN',
                    bundles: [SPORT_BUNDLE],
                    quotaOverrides: {},
                },
            },
            MIN_CATALOG,
            NOW,
        );
        // members: Plan 250 + BT bundle 250 + SubscriptionBundle 500 = 1000
        // resources: Bundle 5 = 5
        // features: ⋃(CORE_IDENTITY, SPORT_TEAMS, SPORT_RESOURCES, WHATSAPP)
        assert.equal(limits.quotas.members, 1000);
        assert.equal(limits.quotas.resources, 5);
        assert.deepEqual([...limits.features].sort(), [
            'CORE_IDENTITY',
            'SPORT_RESOURCES',
            'SPORT_TEAMS',
            'WHATSAPP',
        ]);
    });

    test('-1 (unlimited) in the BusinessType dominates even after plan addition', () => {
        const limits = aggregateLimits(
            {
                plan: 'STARTER',
                planVersion: PLAN_VERSION,
                businessTypeVersion: {
                    businessTypeKey: 'ENTERPRISE_BT',
                    bundles: [{ bundleKey: 'UNLIMITED', quotas: { members: -1 }, features: [] }],
                    quotaOverrides: {},
                },
            },
            MIN_CATALOG,
            NOW,
        );
        assert.equal(limits.quotas.members, -1);
    });
});
