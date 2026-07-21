// Tests for plan-catalog-loader.ts — YAML loading + schema + cross-field validation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    loadPlanCatalogFromString,
    loadPlanCatalogFromFile,
    PlanCatalogValidationError,
} from '../dist/billing/index.js';

const VALID_YAML = `
schemaVersion: 1
projectKey: demoapp
currency: EUR
vatRate: 19.0
features:
  - { key: VEHICLE_INVENTORY, label: Fahrzeugbestand, tier: CORE }
  - { key: DMS,               label: Dokumentenablage, tier: PRO }
plans:
  - id: BASIC
    name: Basic
    monthlyNet: 9.90
    yearlyNet: 99.00
    marketed: true
    quotas: { users: 1, vehicles: 5, storageGb: 1 }
    features: [VEHICLE_INVENTORY]
`;

// ──────────────────────────────────────────────────────────────────
// Happy path
// ──────────────────────────────────────────────────────────────────

test('loadPlanCatalogFromString accepts valid example', () => {
    const catalog = loadPlanCatalogFromString(VALID_YAML, { source: 'inline-test' });
    assert.equal(catalog.projectKey, 'demoapp');
    assert.equal(catalog.plans.length, 1);
    assert.equal(catalog.plans[0].id, 'BASIC');
});

// ──────────────────────────────────────────────────────────────────
// Schema violations
// ──────────────────────────────────────────────────────────────────

test('loadPlanCatalogFromString rejects schemaVersion != 1', () => {
    const yaml = VALID_YAML.replace('schemaVersion: 1', 'schemaVersion: 2');
    assert.throws(
        () => loadPlanCatalogFromString(yaml, { source: 'bad-schema' }),
        PlanCatalogValidationError,
    );
});

test('loadPlanCatalogFromString rejects missing required fields', () => {
    const yaml = `
schemaVersion: 1
projectKey: test-app
# currency fehlt
vatRate: 19
plans:
  - id: BASIC
    quotas: { users: 1 }
    features: []
`;
    assert.throws(
        () => loadPlanCatalogFromString(yaml, { source: 'missing-currency' }),
        PlanCatalogValidationError,
    );
});

test('loadPlanCatalogFromString rejects addons block (#49 — no addon sales)', () => {
    const yaml = `
schemaVersion: 1
projectKey: test-app
currency: EUR
vatRate: 19
plans:
  - id: BASIC
    quotas: { users: 1 }
    features: []
addons:
  - { kind: USER_SEAT, quotaKey: users, quantityStep: 1, monthlyNet: 5.0 }
`;
    assert.throws(
        () => loadPlanCatalogFromString(yaml, { source: 'addons-not-allowed' }),
        PlanCatalogValidationError,
    );
});

// ──────────────────────────────────────────────────────────────────
// Cross-field validations
// ──────────────────────────────────────────────────────────────────

test('cross-field: plan references unknown featureKey → error', () => {
    const yaml = `
schemaVersion: 1
projectKey: test-app
currency: EUR
vatRate: 19
features:
  - { key: F1 }
plans:
  - id: BASIC
    quotas: { users: 1 }
    features: [F1, F2]   # F2 nicht deklariert
`;
    assert.throws(
        () => loadPlanCatalogFromString(yaml, { source: 'unknown-feature' }),
        /Unbekannter featureKey "F2"/,
    );
});

test('cross-field: duplicate plan IDs → error', () => {
    const yaml = `
schemaVersion: 1
projectKey: test-app
currency: EUR
vatRate: 19
plans:
  - id: BASIC
    quotas: { users: 1 }
    features: []
  - id: BASIC
    quotas: { users: 5 }
    features: []
`;
    assert.throws(
        () => loadPlanCatalogFromString(yaml, { source: 'duplicate-id' }),
        /Doppelte Plan-ID "BASIC"/,
    );
});

test('cross-field: plannedOnly:true allows plan reference (roadmap marker)', () => {
    // Semantics (SPEC_V2 §8.2): plannedOnly = "listed in the catalog, not (yet)
    // implemented in code". Plans may carry the feature as a roadmap marker —
    // activation protection lives in getActiveFeatureKeys.
    const yaml = `
schemaVersion: 1
projectKey: test-app
currency: EUR
vatRate: 19
features:
  - { key: F1 }
  - { key: F2_PLANNED, plannedOnly: true }
plans:
  - id: BASIC
    quotas: { users: 1 }
    features: [F1, F2_PLANNED]
`;
    const catalog = loadPlanCatalogFromString(yaml, { source: 'planned-only-plan' });
    assert.equal(catalog.plans[0].features.length, 2);
});

test('crossFieldChecks: false skips consistency checks', () => {
    const yaml = `
schemaVersion: 1
projectKey: test-app
currency: EUR
vatRate: 19
features:
  - { key: F1 }
plans:
  - id: BASIC
    quotas: { users: 1 }
    features: [F1, F2]
`;
    // With checks enabled → error (F2 not declared). Without → no error.
    const catalog = loadPlanCatalogFromString(yaml, {
        source: 'no-checks',
        crossFieldChecks: false,
    });
    assert.equal(catalog.plans[0].features.length, 2);
});

// ──────────────────────────────────────────────────────────────────
// File-Loading
// ──────────────────────────────────────────────────────────────────

test('loadPlanCatalogFromFile reads YAML file from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'plan-catalog-'));
    const path = join(dir, 'plans.yaml');
    writeFileSync(path, VALID_YAML, 'utf-8');
    try {
        const catalog = loadPlanCatalogFromFile({ path });
        assert.equal(catalog.projectKey, 'demoapp');
        assert.equal(catalog.plans[0].id, 'BASIC');
    } finally {
        unlinkSync(path);
    }
});

test('loadPlanCatalogFromFile throws for non-existent file', () => {
    assert.throws(() => loadPlanCatalogFromFile({ path: '/tmp/does-not-exist-12345.yaml' }));
});

test('PlanCatalogValidationError contains error list', () => {
    try {
        loadPlanCatalogFromString('schemaVersion: 9', { source: 'bad' });
        assert.fail('expected throw');
    } catch (e) {
        assert.ok(e instanceof PlanCatalogValidationError);
        assert.equal(e.source, 'bad');
        assert.ok(e.errors.length > 0);
    }
});
