// Tests für plan-helpers.ts — Pure-Function-Wrapper über PlanCatalog.

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

const AUTOHAUSPRO_LIKE_CATALOG = {
    schemaVersion: 1,
    projectKey: 'autohauspro',
    currency: 'EUR',
    vatRate: 19,
    quotaKeys: ['users', 'vehicles', 'storageGb'],
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

test('findPlan liefert Plan bei bekannter ID', () => {
    const plan = findPlan(AUTOHAUSPRO_LIKE_CATALOG, 'BASIC');
    assert.equal(plan?.id, 'BASIC');
    assert.equal(plan?.name, 'Basic');
});

test('findPlan liefert undefined bei unbekannter ID', () => {
    assert.equal(findPlan(AUTOHAUSPRO_LIKE_CATALOG, 'NIRVANA'), undefined);
});

test('getPlanOrThrow wirft typed Error bei unbekannter ID', () => {
    assert.throws(
        () => getPlanOrThrow(AUTOHAUSPRO_LIKE_CATALOG, 'NIRVANA'),
        /Plan "NIRVANA" nicht im Catalog \(autohauspro\)/,
    );
});

// ──────────────────────────────────────────────────────────────────
// getMarketedPlans
// ──────────────────────────────────────────────────────────────────

test('getMarketedPlans schließt marketed: false aus', () => {
    const plans = getMarketedPlans(AUTOHAUSPRO_LIKE_CATALOG);
    assert.equal(plans.length, 2);
    assert.deepEqual(
        plans.map((p) => p.id),
        ['BASIC', 'PROFESSIONAL'],
    );
});

test('getMarketedPlans behandelt undefined als marketed=true', () => {
    const catalog = {
        ...AUTOHAUSPRO_LIKE_CATALOG,
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

test('getPlanPriceNet MONTHLY für marketed Plan', () => {
    assert.equal(getPlanPriceNet(AUTOHAUSPRO_LIKE_CATALOG, 'BASIC', 'MONTHLY'), 9.9);
});

test('getPlanPriceNet YEARLY für marketed Plan', () => {
    assert.equal(getPlanPriceNet(AUTOHAUSPRO_LIKE_CATALOG, 'BASIC', 'YEARLY'), 99);
});

test('getPlanPriceNet für unbekannten Plan → null', () => {
    assert.equal(getPlanPriceNet(AUTOHAUSPRO_LIKE_CATALOG, 'NIRVANA', 'MONTHLY'), null);
});

test('getPlanPriceNet für ENTERPRISE (marketed: false) → null', () => {
    assert.equal(getPlanPriceNet(AUTOHAUSPRO_LIKE_CATALOG, 'ENTERPRISE', 'MONTHLY'), null);
});

test('getPlanPriceGross MONTHLY = Netto * 1.19', () => {
    // 9.9 * 1.19 = 11.781, gerundet 11.78
    assert.equal(getPlanPriceGross(AUTOHAUSPRO_LIKE_CATALOG, 'BASIC', 'MONTHLY'), 11.78);
});

test('getPlanPriceGross mit override vatRate', () => {
    // 49.9 * 1.07 = 53.393, gerundet 53.39
    assert.equal(getPlanPriceGross(AUTOHAUSPRO_LIKE_CATALOG, 'PROFESSIONAL', 'MONTHLY', 7), 53.39);
});

test('getPlanPriceGross für ENTERPRISE → null', () => {
    assert.equal(getPlanPriceGross(AUTOHAUSPRO_LIKE_CATALOG, 'ENTERPRISE', 'MONTHLY'), null);
});

// ──────────────────────────────────────────────────────────────────
// getPlanQuota
// ──────────────────────────────────────────────────────────────────

test('getPlanQuota liefert konkreten Wert', () => {
    assert.equal(getPlanQuota(AUTOHAUSPRO_LIKE_CATALOG, 'BASIC', 'users'), 1);
    assert.equal(getPlanQuota(AUTOHAUSPRO_LIKE_CATALOG, 'PROFESSIONAL', 'vehicles'), 50);
});

test('getPlanQuota liefert -1 für unbegrenzte ENTERPRISE-Quotas', () => {
    assert.equal(getPlanQuota(AUTOHAUSPRO_LIKE_CATALOG, 'ENTERPRISE', 'users'), -1);
});

test('getPlanQuota für unbekannten Plan/Key → undefined', () => {
    assert.equal(getPlanQuota(AUTOHAUSPRO_LIKE_CATALOG, 'NIRVANA', 'users'), undefined);
    assert.equal(getPlanQuota(AUTOHAUSPRO_LIKE_CATALOG, 'BASIC', 'nonexistent'), undefined);
});

// ──────────────────────────────────────────────────────────────────
// isFeatureInPlan
// ──────────────────────────────────────────────────────────────────

test('isFeatureInPlan: true wenn Feature direkt im Plan', () => {
    assert.equal(isFeatureInPlan(AUTOHAUSPRO_LIKE_CATALOG, 'PROFESSIONAL', 'DMS'), true);
});

test('isFeatureInPlan: false wenn Feature nicht im Plan', () => {
    assert.equal(isFeatureInPlan(AUTOHAUSPRO_LIKE_CATALOG, 'BASIC', 'DMS'), false);
});

test('isFeatureInPlan: false bei unbekanntem Plan', () => {
    assert.equal(isFeatureInPlan(AUTOHAUSPRO_LIKE_CATALOG, 'NIRVANA', 'DMS'), false);
});

// ──────────────────────────────────────────────────────────────────
// getActiveFeatureKeys / isFeaturePlannedOnly
// ──────────────────────────────────────────────────────────────────

test('getActiveFeatureKeys schließt plannedOnly aus', () => {
    const keys = getActiveFeatureKeys(AUTOHAUSPRO_LIKE_CATALOG);
    assert.deepEqual(keys, ['VEHICLE_INVENTORY', 'DMS']);
});

test('isFeaturePlannedOnly: true für deklarierten plannedOnly-Key', () => {
    assert.equal(isFeaturePlannedOnly(AUTOHAUSPRO_LIKE_CATALOG, 'API_ACCESS'), true);
});

test('isFeaturePlannedOnly: false für deklarierten produktiven Key', () => {
    assert.equal(isFeaturePlannedOnly(AUTOHAUSPRO_LIKE_CATALOG, 'DMS'), false);
});

test('isFeaturePlannedOnly: false für unbekannten Key (konservativ)', () => {
    assert.equal(isFeaturePlannedOnly(AUTOHAUSPRO_LIKE_CATALOG, 'NEW_FEATURE_NOT_DECLARED'), false);
});
