// Tests for plan-helpers.ts — pure-function wrappers over PlanCatalog.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    findPlan,
    getActiveFeatureKeys,
    getMarketedPlans,
    getPlanOrThrow,
    getPlanPriceGross,
    getPlanPriceNet,
    getPlanQuota,
    isFeatureInPlan,
    isFeaturePlannedOnly,
} from '../dist/billing/index.js';

const DEMOAPP_LIKE_CATALOG = {
    schemaVersion: 1,
    projectKey: 'demoapp',
    currency: 'EUR',
    vatRate: 19,
    features: [
        { key: 'VEHICLE_INVENTORY', label: 'Fahrzeugbestand', tier: 'CORE' },
        { key: 'DMS', label: 'Dokumentenablage', tier: 'PRO' },
        { key: 'API_ACCESS', label: 'REST-API', plannedOnly: true },
    ],
    plans: [
        {
            id: 'BASIC',
            name: 'Basic',
            tagline: 'Klein',
            marketed: true,
            monthlyNet: 9.9,
            yearlyNet: 99,
            quotas: { users: 1, vehicles: 5, storageGb: 1 },
            features: ['VEHICLE_INVENTORY'],
        },
        {
            id: 'PROFESSIONAL',
            name: 'Professional',
            tagline: 'Pro',
            marketed: true,
            popular: true,
            monthlyNet: 49.9,
            yearlyNet: 499,
            quotas: { users: 3, vehicles: 50, storageGb: 25 },
            features: ['VEHICLE_INVENTORY', 'DMS'],
        },
        {
            id: 'ENTERPRISE',
            name: 'Enterprise',
            tagline: 'Sondervertrag',
            marketed: false,
            monthlyNet: null,
            yearlyNet: null,
            quotas: { users: -1, vehicles: -1, storageGb: 250 },
            features: ['VEHICLE_INVENTORY', 'DMS'],
        },
    ],
};

// ──────────────────────────────────────────────────────────────────
// findPlan / getPlanOrThrow
// ──────────────────────────────────────────────────────────────────

test('findPlan returns a plan for a known ID', () => {
    const plan = findPlan(DEMOAPP_LIKE_CATALOG, 'BASIC');
    assert.equal(plan?.id, 'BASIC');
    assert.equal(plan?.name, 'Basic');
});

test('findPlan returns undefined for an unknown ID', () => {
    assert.equal(findPlan(DEMOAPP_LIKE_CATALOG, 'NIRVANA'), undefined);
});

test('getPlanOrThrow throws a typed error for an unknown ID', () => {
    assert.throws(
        () => getPlanOrThrow(DEMOAPP_LIKE_CATALOG, 'NIRVANA'),
        /Plan "NIRVANA" nicht im Catalog \(demoapp\)/,
    );
});

// ──────────────────────────────────────────────────────────────────
// getMarketedPlans
// ──────────────────────────────────────────────────────────────────

test('getMarketedPlans excludes marketed: false', () => {
    const plans = getMarketedPlans(DEMOAPP_LIKE_CATALOG);
    assert.equal(plans.length, 2);
    assert.deepEqual(
        plans.map((p) => p.id),
        ['BASIC', 'PROFESSIONAL'],
    );
});

test('getMarketedPlans treats undefined as marketed=true', () => {
    const catalog = {
        ...DEMOAPP_LIKE_CATALOG,
        plans: [
            { id: 'A', quotas: { users: 1 }, features: [] }, // marketed undefined
            { id: 'B', marketed: false, quotas: { users: 1 }, features: [] },
        ],
    };
    const plans = getMarketedPlans(catalog);
    assert.deepEqual(
        plans.map((p) => p.id),
        ['A'],
    );
});

// ──────────────────────────────────────────────────────────────────
// getPlanPriceNet / getPlanPriceGross
// ──────────────────────────────────────────────────────────────────

test('getPlanPriceNet MONTHLY for a marketed plan', () => {
    assert.equal(getPlanPriceNet(DEMOAPP_LIKE_CATALOG, 'BASIC', 'MONTHLY'), 9.9);
});

test('getPlanPriceNet YEARLY for a marketed plan', () => {
    assert.equal(getPlanPriceNet(DEMOAPP_LIKE_CATALOG, 'BASIC', 'YEARLY'), 99);
});

test('getPlanPriceNet for an unknown plan → null', () => {
    assert.equal(getPlanPriceNet(DEMOAPP_LIKE_CATALOG, 'NIRVANA', 'MONTHLY'), null);
});

test('getPlanPriceNet for ENTERPRISE (marketed: false) → null', () => {
    assert.equal(getPlanPriceNet(DEMOAPP_LIKE_CATALOG, 'ENTERPRISE', 'MONTHLY'), null);
});

test('getPlanPriceGross MONTHLY = net * 1.19', () => {
    // 9.9 * 1.19 = 11.781, rounded 11.78
    assert.equal(getPlanPriceGross(DEMOAPP_LIKE_CATALOG, 'BASIC', 'MONTHLY'), 11.78);
});

test('getPlanPriceGross with override vatRate', () => {
    // 49.9 * 1.07 = 53.393, rounded 53.39
    assert.equal(getPlanPriceGross(DEMOAPP_LIKE_CATALOG, 'PROFESSIONAL', 'MONTHLY', 7), 53.39);
});

test('getPlanPriceGross for ENTERPRISE → null', () => {
    assert.equal(getPlanPriceGross(DEMOAPP_LIKE_CATALOG, 'ENTERPRISE', 'MONTHLY'), null);
});

// ──────────────────────────────────────────────────────────────────
// getPlanQuota
// ──────────────────────────────────────────────────────────────────

test('getPlanQuota returns a concrete value', () => {
    assert.equal(getPlanQuota(DEMOAPP_LIKE_CATALOG, 'BASIC', 'users'), 1);
    assert.equal(getPlanQuota(DEMOAPP_LIKE_CATALOG, 'PROFESSIONAL', 'vehicles'), 50);
});

test('getPlanQuota returns -1 for unlimited ENTERPRISE quotas', () => {
    assert.equal(getPlanQuota(DEMOAPP_LIKE_CATALOG, 'ENTERPRISE', 'users'), -1);
});

test('getPlanQuota for an unknown plan/key → undefined', () => {
    assert.equal(getPlanQuota(DEMOAPP_LIKE_CATALOG, 'NIRVANA', 'users'), undefined);
    assert.equal(getPlanQuota(DEMOAPP_LIKE_CATALOG, 'BASIC', 'nonexistent'), undefined);
});

// ──────────────────────────────────────────────────────────────────
// isFeatureInPlan
// ──────────────────────────────────────────────────────────────────

test('isFeatureInPlan: true when the feature is directly in the plan', () => {
    assert.equal(isFeatureInPlan(DEMOAPP_LIKE_CATALOG, 'PROFESSIONAL', 'DMS'), true);
});

test('isFeatureInPlan: false when the feature is not in the plan', () => {
    assert.equal(isFeatureInPlan(DEMOAPP_LIKE_CATALOG, 'BASIC', 'DMS'), false);
});

test('isFeatureInPlan: false for an unknown plan', () => {
    assert.equal(isFeatureInPlan(DEMOAPP_LIKE_CATALOG, 'NIRVANA', 'DMS'), false);
});

// ──────────────────────────────────────────────────────────────────
// getActiveFeatureKeys / isFeaturePlannedOnly
// ──────────────────────────────────────────────────────────────────

test('getActiveFeatureKeys excludes plannedOnly', () => {
    const keys = getActiveFeatureKeys(DEMOAPP_LIKE_CATALOG);
    assert.deepEqual(keys, ['VEHICLE_INVENTORY', 'DMS']);
});

test('isFeaturePlannedOnly: true for a declared plannedOnly key', () => {
    assert.equal(isFeaturePlannedOnly(DEMOAPP_LIKE_CATALOG, 'API_ACCESS'), true);
});

test('isFeaturePlannedOnly: false for a declared production key', () => {
    assert.equal(isFeaturePlannedOnly(DEMOAPP_LIKE_CATALOG, 'DMS'), false);
});

test('isFeaturePlannedOnly: false for an unknown key (conservative)', () => {
    assert.equal(isFeaturePlannedOnly(DEMOAPP_LIKE_CATALOG, 'NEW_FEATURE_NOT_DECLARED'), false);
});
