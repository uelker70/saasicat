// Tests for plan-catalog-loader.ts — YAML loading + schema + cross-field validation.

// @requirement SC-PLAN-022 — Everything wrong with an uploaded catalogue is reported at once
// @requirement SC-PLAN-023 — A catalogue that cannot be read is the caller's mistake, not a server failure

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
app:
  name: Demo App
currency: EUR
vatRate: 19.0
tenantBilling:
  cancellationNoticeDays: { monthly: 0, yearly: 0 }
  selfServiceBlockedPlans: { asTarget: [], asSource: [] }
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
    assert.equal(catalog.app.name, 'Demo App');
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
app:
  name: Demo App
# currency fehlt
vatRate: 19
tenantBilling:
  cancellationNoticeDays: { monthly: 0, yearly: 0 }
  selfServiceBlockedPlans: { asTarget: [], asSource: [] }
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
app:
  name: Demo App
currency: EUR
vatRate: 19
tenantBilling:
  cancellationNoticeDays: { monthly: 0, yearly: 0 }
  selfServiceBlockedPlans: { asTarget: [], asSource: [] }
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
app:
  name: Demo App
currency: EUR
vatRate: 19
tenantBilling:
  cancellationNoticeDays: { monthly: 0, yearly: 0 }
  selfServiceBlockedPlans: { asTarget: [], asSource: [] }
features:
  - { key: F1 }
plans:
  - id: BASIC
    quotas: { users: 1 }
    features: [F1, F2]   # F2 nicht deklariert
`;
    assert.throws(
        () => loadPlanCatalogFromString(yaml, { source: 'unknown-feature' }),
        /Unknown featureKey "F2"/,
    );
});

test('cross-field: duplicate plan IDs → error', () => {
    const yaml = `
schemaVersion: 1
app:
  name: Demo App
currency: EUR
vatRate: 19
tenantBilling:
  cancellationNoticeDays: { monthly: 0, yearly: 0 }
  selfServiceBlockedPlans: { asTarget: [], asSource: [] }
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
        /duplicate plan id "BASIC"/,
    );
});

test('cross-field: plannedOnly:true allows plan reference (roadmap marker)', () => {
    // Semantics: plannedOnly = "listed in the catalog, not (yet)
    // implemented in code". Plans may carry the feature as a roadmap marker —
    // activation protection lives in getActiveFeatureKeys.
    const yaml = `
schemaVersion: 1
app:
  name: Demo App
currency: EUR
vatRate: 19
tenantBilling:
  cancellationNoticeDays: { monthly: 0, yearly: 0 }
  selfServiceBlockedPlans: { asTarget: [], asSource: [] }
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
app:
  name: Demo App
currency: EUR
vatRate: 19
tenantBilling:
  cancellationNoticeDays: { monthly: 0, yearly: 0 }
  selfServiceBlockedPlans: { asTarget: [], asSource: [] }
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
        assert.equal(catalog.app.name, 'Demo App');
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

// ──────────────────────────────────────────────────────────────────
// tenantBilling — required, member by member
// ──────────────────────────────────────────────────────────────────

test('a catalogue without tenantBilling is refused, and the field is named', () => {
    const yaml = VALID_YAML.split('\n')
        .filter(
            (line) =>
                !line.startsWith('tenantBilling:') &&
                !line.trimStart().startsWith('cancellationNoticeDays:') &&
                !line.trimStart().startsWith('selfServiceBlockedPlans:'),
        )
        .join('\n');
    assert.throws(
        () => loadPlanCatalogFromString(yaml, { source: 'no-tenant-billing' }),
        (error) => {
            assert.ok(error instanceof PlanCatalogValidationError);
            // The field, not a schema path: this is the message every existing
            // installation meets on upgrade.
            assert.match(error.message, /tenantBilling/);
            assert.doesNotMatch(error.message, /#\/required/);
            return true;
        },
    );
});

test('a rhythm nobody named is refused, rather than read as zero', () => {
    const yaml = VALID_YAML.replace(
        'cancellationNoticeDays: { monthly: 0, yearly: 0 }',
        'cancellationNoticeDays: { monthly: 30 }',
    );
    assert.throws(
        () => loadPlanCatalogFromString(yaml, { source: 'half-a-notice-period' }),
        (error) => {
            // The missing member by name, with its parent — an integrator has
            // to know WHICH rhythm they left out.
            assert.match(error.message, /tenantBilling\.cancellationNoticeDays\.yearly/);
            return true;
        },
    );
});

test('a self-service list nobody named is refused too', () => {
    const yaml = VALID_YAML.replace(
        'selfServiceBlockedPlans: { asTarget: [], asSource: [] }',
        'selfServiceBlockedPlans: { asTarget: [] }',
    );
    assert.throws(
        () => loadPlanCatalogFromString(yaml, { source: 'half-a-block-list' }),
        (error) => {
            assert.match(error.message, /tenantBilling\.selfServiceBlockedPlans\.asSource/);
            return true;
        },
    );
});

test('empty lists and zeroes are values, not omissions', () => {
    const catalog = loadPlanCatalogFromString(VALID_YAML, { source: 'inline-test' });
    assert.deepEqual(catalog.tenantBilling.cancellationNoticeDays, { monthly: 0, yearly: 0 });
    assert.deepEqual(catalog.tenantBilling.selfServiceBlockedPlans, {
        asTarget: [],
        asSource: [],
    });
});

test('a negative notice period is refused', () => {
    const yaml = VALID_YAML.replace(
        'cancellationNoticeDays: { monthly: 0, yearly: 0 }',
        'cancellationNoticeDays: { monthly: -1, yearly: 0 }',
    );
    assert.throws(
        () => loadPlanCatalogFromString(yaml, { source: 'negative-notice' }),
        PlanCatalogValidationError,
    );
});

test('a fractional notice period is refused — days are whole', () => {
    const yaml = VALID_YAML.replace(
        'cancellationNoticeDays: { monthly: 0, yearly: 0 }',
        'cancellationNoticeDays: { monthly: 1.5, yearly: 0 }',
    );
    assert.throws(
        () => loadPlanCatalogFromString(yaml, { source: 'fractional-notice' }),
        PlanCatalogValidationError,
    );
});

test('an unknown member of the block is refused, not ignored', () => {
    const yaml = VALID_YAML.replace(
        'tenantBilling:',
        'tenantBilling:\n  canceledEntitlementPlan: STARTER',
    );
    assert.throws(
        () => loadPlanCatalogFromString(yaml, { source: 'unknown-setting' }),
        PlanCatalogValidationError,
    );
});
