import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    aggregateBusinessTypeQuotas,
    aggregateLimits,
    collectBusinessTypeFeatures,
} from '../dist/entitlement/index.js';

// SPEC_V2 §11.1 M5 + GESCHAEFTSTYP_SPEC §6 — BusinessType-Anteil in
// Entitlement-Aggregation. Tests laufen Pure-Function gegen die neuen
// Helper plus drei Pfade durch aggregateLimits.

const NOW = new Date('2026-05-14T12:00:00Z');

const MIN_CATALOG = {
    schemaVersion: 1,
    projectKey: 'vereinsfux',
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
// aggregateBusinessTypeQuotas — Σ + Override + -1-Dominanz
// ─────────────────────────────────────────────────────────────────

describe('aggregateBusinessTypeQuotas', () => {
    test('Σ über alle Bundles pro QuotaKey', () => {
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

    test('-1 (unbegrenzt) dominiert die Σ', () => {
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

    test('Override ersetzt Σ pro gesetztem Key', () => {
        const result = aggregateBusinessTypeQuotas({
            businessTypeKey: 'X',
            bundles: [
                { bundleKey: 'A', quotas: { members: 100, storageGb: 5 }, features: [] },
                { bundleKey: 'B', quotas: { members: 50 }, features: [] },
            ],
            quotaOverrides: { members: 1000 },
        });
        // members durch Override 1000 ersetzt; storageGb bleibt Σ = 5
        assert.deepEqual(result, { members: 1000, storageGb: 5 });
    });

    test('Override -1 ersetzt Σ mit -1', () => {
        const result = aggregateBusinessTypeQuotas({
            businessTypeKey: 'X',
            bundles: [{ bundleKey: 'A', quotas: { members: 100 }, features: [] }],
            quotaOverrides: { members: -1 },
        });
        assert.equal(result.members, -1);
    });
});

// ─────────────────────────────────────────────────────────────────
// collectBusinessTypeFeatures — Set-Union
// ─────────────────────────────────────────────────────────────────

describe('collectBusinessTypeFeatures', () => {
    test('Set-Union über alle Bundles', () => {
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

    test('dedupliziert doppelte Features (Set-Semantik)', () => {
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
// aggregateLimits — Pfade: Plan-only, Plan+BusinessType, +Bundles
// ─────────────────────────────────────────────────────────────────

describe('aggregateLimits — Plan + BusinessType + Bundles', () => {
    test('Plan-only (kein BusinessType, keine Bundles) — wie bisher', () => {
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

    test('Plan + BusinessType (ohne Bundles): Quotas summiert, Features unioniert', () => {
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
        // Bundle resources 5 (Plan hat keine) = 5
        assert.deepEqual(limits.quotas, { members: 500, storageGb: 2, resources: 5 });
        assert.deepEqual([...limits.features].sort(), [
            'CORE_IDENTITY',
            'SPORT_RESOURCES',
            'SPORT_TEAMS',
        ]);
    });

    test('Plan + BusinessType + QuotaOverride: Override schlägt Σ', () => {
        const limits = aggregateLimits(
            {
                plan: 'STARTER',
                planVersion: PLAN_VERSION,
                businessTypeVersion: {
                    businessTypeKey: 'SPORT_VEREIN',
                    bundles: [SPORT_BUNDLE],
                    quotaOverrides: { members: 1000 }, // ersetzt Bundle-Σ (250)
                },
            },
            MIN_CATALOG,
            NOW,
        );
        // members: Plan 250 + BusinessType-Override 1000 = 1250
        // (Plan-Default + BusinessType-Anteil; Override gilt nur für Bundle-Σ-Replacement)
        assert.equal(limits.quotas.members, 1250);
    });

    test('Plan + BusinessType + SubscriptionBundles (alle Quellen)', () => {
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
        // members: Plan 250 + BT-Bundle 250 + SubscriptionBundle 500 = 1000
        // resources: Bundle 5 = 5
        // Features: ⋃(CORE_IDENTITY, SPORT_TEAMS, SPORT_RESOURCES, WHATSAPP)
        assert.equal(limits.quotas.members, 1000);
        assert.equal(limits.quotas.resources, 5);
        assert.deepEqual([...limits.features].sort(), [
            'CORE_IDENTITY',
            'SPORT_RESOURCES',
            'SPORT_TEAMS',
            'WHATSAPP',
        ]);
    });

    test('-1 (unbegrenzt) im BusinessType dominiert auch nach Plan-Addition', () => {
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
