// Schema self-consistency tests for @saasicat/spec.
// Checks: all JSON schemas are syntactically valid JSON Schema 2020-12,
// and simple example payloads validate successfully.

// @requirement SC-SEC-005 — Data arriving from outside is validated at the boundary

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
    SCHEMAS,
    adminManifestSchema,
    planCatalogSchema,
    promoCodeSchema,
    auditEventSchema,
    subscriberLedgerSchema,
} from '../index.js';

function makeAjv() {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats.default(ajv);
    return ajv;
}

test('adminManifestSchema compiles', () => {
    const ajv = makeAjv();
    assert.doesNotThrow(() => ajv.compile(adminManifestSchema));
});

test('planCatalogSchema compiles', () => {
    const ajv = makeAjv();
    assert.doesNotThrow(() => ajv.compile(planCatalogSchema));
});

test('promoCodeSchema compiles', () => {
    const ajv = makeAjv();
    assert.doesNotThrow(() => ajv.compile(promoCodeSchema));
});

test('auditEventSchema compiles', () => {
    const ajv = makeAjv();
    assert.doesNotThrow(() => ajv.compile(auditEventSchema));
});

// ──────────────────────────────────────────────────────────────────
// PlanCatalog: minimal valid payload + FEATURE_BUNDLE acceptance
// ──────────────────────────────────────────────────────────────────

test('planCatalog accepts minimal valid catalog', () => {
    const ajv = makeAjv();
    const validate = ajv.compile(planCatalogSchema);
    const ok = validate({
        schemaVersion: 1,
        app: { name: 'Demo App' },
        currency: 'EUR',
        vatRate: 19,
        tenantBilling: {
            cancellationNoticeDays: { monthly: 0, yearly: 0 },
            selfServiceBlockedPlans: { asTarget: [], asSource: [] },
        },
        plans: [
            {
                id: 'BASIC',
                quotas: { users: 1, vehicles: 5 },
                features: ['VEHICLE_INVENTORY'],
            },
        ],
    });
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

// ──────────────────────────────────────────────────────────────────
// PromoCode: CreatePromoCodeRequest validation
// ──────────────────────────────────────────────────────────────────

test('promoCode CreatePromoCodeRequest accepts a typical PERCENT code', () => {
    const ajv = makeAjv();
    const validate = ajv.compile({
        ...promoCodeSchema,
        $ref: '#/$defs/CreatePromoCodeRequest',
    });
    const ok = validate({
        code: 'WELCOME25',
        valueType: 'PERCENT',
        value: 25,
        durationType: 'ONCE',
    });
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

test('promoCode CreatePromoCodeRequest rejects lowercase code', () => {
    const ajv = makeAjv();
    const validate = ajv.compile({
        ...promoCodeSchema,
        $ref: '#/$defs/CreatePromoCodeRequest',
    });
    const ok = validate({
        code: 'welcome25',
        valueType: 'PERCENT',
        value: 25,
        durationType: 'ONCE',
    });
    assert.equal(ok, false);
});

// ──────────────────────────────────────────────────────────────────
// AuditEvent: minimal valid event
// ──────────────────────────────────────────────────────────────────

test('auditEvent accepts minimal valid entry', () => {
    const ajv = makeAjv();
    const validate = ajv.compile(auditEventSchema);
    const ok = validate({
        id: '11111111-1111-1111-1111-111111111111',
        entity: 'Tenant',
        entityId: 'abc',
        action: 'TENANT_SUSPEND',
        createdAt: '2026-05-07T12:34:56Z',
    });
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

test('auditEvent rejects lowercase action', () => {
    const ajv = makeAjv();
    const validate = ajv.compile(auditEventSchema);
    const ok = validate({
        id: '11111111-1111-1111-1111-111111111111',
        entity: 'Tenant',
        entityId: 'abc',
        action: 'tenant_suspend',
        createdAt: '2026-05-07T12:34:56Z',
    });
    assert.equal(ok, false);
});

// ──────────────────────────────────────────────────────────────────
// AdminManifest: minimal valid manifest stub
// ──────────────────────────────────────────────────────────────────

test('adminManifest accepts minimal valid manifest', () => {
    const ajv = makeAjv();
    const validate = ajv.compile(adminManifestSchema);
    const ok = validate({
        schemaVersion: 1,
        project: { key: 'demoapp', displayName: 'DemoApp' },
        build: {
            platformPackageVersion: '0.1.0',
            appVersion: 'demoapp@2026.05.07',
            manifestHash: 'sha256-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
        },
        planCatalogSnapshot: {
            source: 'config/plans.yaml',
            hash: 'sha256-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
            currency: 'EUR',
            vatRate: 19,
            plans: [{ id: 'BASIC', quotas: { users: 1 }, features: [] }],
        },
        capabilities: { 'tenants.read': true },
        navigation: {
            standardPages: { tenants: { enabled: true, requiredCapability: 'tenants.read' } },
        },
    });
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

test('adminManifest rejects the removed planVersions standard page', () => {
    const ajv = makeAjv();
    const validate = ajv.compile(adminManifestSchema);
    const ok = validate({
        schemaVersion: 1,
        project: { key: 'demoapp', displayName: 'DemoApp' },
        build: {
            platformPackageVersion: '0.1.0',
            appVersion: 'demoapp@2026.05.07',
            manifestHash: 'sha256-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
        },
        planCatalogSnapshot: {
            source: 'config/plans.yaml',
            hash: 'sha256-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
            currency: 'EUR',
            vatRate: 19,
            plans: [],
        },
        capabilities: { 'plans.read': true },
        navigation: {
            standardPages: {
                planVersions: { enabled: true, requiredCapability: 'plans.read' },
            },
        },
    });
    assert.equal(ok, false);
});

test('adminManifest rejects capability with colon notation', () => {
    const ajv = makeAjv();
    const validate = ajv.compile(adminManifestSchema);
    const ok = validate({
        schemaVersion: 1,
        project: { key: 'demoapp', displayName: 'DemoApp' },
        build: {
            platformPackageVersion: '0.1.0',
            appVersion: 'x',
            manifestHash: 'sha256-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
        },
        planCatalogSnapshot: {
            source: 'config/plans.yaml',
            hash: 'sha256-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
            currency: 'EUR',
            vatRate: 19,
            plans: [{ id: 'BASIC', quotas: { users: 1 }, features: [] }],
        },
        capabilities: { 'tenants:read': true }, // ← colon not allowed
        navigation: { standardPages: {} },
    });
    assert.equal(ok, false);
});

// ──────────────────────────────────────────────────────────────────
// Every schema is reachable
// ──────────────────────────────────────────────────────────────────

/**
 * Both entry points, not just the one this suite imports.
 *
 * `package.json` resolves `require` to `index.cjs` and `import` to `index.js`,
 * and the two are hand-written lists. Asking only the one the test file happens
 * to load is how a schema reaches ESM consumers and not CommonJS ones, with the
 * two `SCHEMAS` maps holding different keys and nothing saying so.
 */
const ENTRY_POINTS = [
    ['index.js', SCHEMAS],
    ['index.cjs', createRequire(import.meta.url)('../index.cjs').SCHEMAS],
];

test('every schema file is exported from both entry points', () => {
    const dir = new URL('../schemas/', import.meta.url);
    const files = readdirSync(dir).filter((name) => name.endsWith('.schema.json'));
    assert.ok(files.length > 0, 'no schema files found — the directory or the suffix moved');
    for (const [entry, exported] of ENTRY_POINTS) {
        const ids = Object.values(exported).map((schema) => schema.$id);
        for (const file of files) {
            const { $id } = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
            assert.ok(
                ids.includes($id),
                `${file} is not exported from ${entry} — a consumer on that module system ` +
                    `cannot validate against it, and no test here would say so`,
            );
        }
    }
});

test('and the two entry points offer the same names', () => {
    // The check above passes on an entry point that exports every schema plus
    // something the other does not have. `SCHEMAS` is iterated by consumers
    // building validators, so a key on one side only is a validator on one side
    // only.
    const [[, esm], [, cjs]] = ENTRY_POINTS;
    assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
});

test('and the type shells name what the entry points export', () => {
    // `index.d.ts` and `index.d.cts` are hand-written too, and a missing
    // declaration is not a runtime failure — it is a consumer whose TypeScript
    // says the export does not exist while it plainly does.
    for (const [runtime, shell] of [
        ['index.js', 'index.d.ts'],
        ['index.cjs', 'index.d.cts'],
    ]) {
        const declared = readFileSync(new URL(`../${shell}`, import.meta.url), 'utf8');
        const [, exported] = ENTRY_POINTS.find(([entry]) => entry === runtime);
        for (const name of Object.keys(exported)) {
            assert.ok(
                declared.includes(`readonly ${name}:`),
                `${shell} does not declare SCHEMAS.${name}, which ${runtime} exports`,
            );
        }
    }
});

// ──────────────────────────────────────────────────────────────────
// SubscriberCharge: one charge in a subscriber's account
// ──────────────────────────────────────────────────────────────────

/** A charge with every required fact present. Each case below alters one. */
const CHARGE = {
    id: '22222222-2222-2222-2222-222222222222',
    subscriberId: 'subscriber-1',
    tenantId: 'tenant-1',
    subscriptionId: 'sub-1',
    contractId: 'contract-1',
    contractLineItemId: 'line-1',
    origin: 'renewal',
    source: 'plan',
    sourceRef: 'sub-1',
    periodStart: '2026-01-01T00:00:00Z',
    periodEnd: '2026-02-01T00:00:00Z',
    currency: 'EUR',
    amountNet: 19.9,
    bookedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:01Z',
};

function without(entry, field) {
    const copy = { ...entry };
    delete copy[field];
    return copy;
}

function chargeValidator() {
    return makeAjv().compile(subscriberLedgerSchema);
}

test('subscriberLedger accepts a charge carrying its period, origin, source and amount', () => {
    const validate = chargeValidator();
    const ok = validate(CHARGE);
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

test('subscriberLedger accepts a discount, which is a negative charge', () => {
    const validate = chargeValidator();
    const ok = validate({
        ...CHARGE,
        source: 'discount',
        sourceRef: 'WELCOME20',
        amountNet: -3.98,
    });
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

test('subscriberLedger rejects a charge that states a tax of its own', () => {
    // The tax is the invoice's, decided by the tax adapter when the charge is
    // invoiced; a second figure on the charge could differ from it by cents.
    assert.equal(chargeValidator()({ ...CHARGE, taxRate: 19, taxAmount: 3.78 }), false);
});

test('subscriberLedger rejects a charge that names no contract line', () => {
    assert.equal(chargeValidator()(without(CHARGE, 'contractLineItemId')), false);
    assert.equal(chargeValidator()({ ...CHARGE, contractLineItemId: null }), false);
});

test('subscriberLedger rejects a charge without an origin', () => {
    assert.equal(chargeValidator()(without(CHARGE, 'origin')), false);
});

test('subscriberLedger rejects an origin outside the catalogue of origins', () => {
    assert.equal(chargeValidator()({ ...CHARGE, origin: 'refund' }), false);
});

test('subscriberLedger rejects a source outside the kinds of contract line', () => {
    assert.equal(chargeValidator()({ ...CHARGE, source: 'tax' }), false);
});

test('subscriberLedger rejects an empty sourceRef, which would not collide with itself', () => {
    assert.equal(chargeValidator()({ ...CHARGE, sourceRef: '' }), false);
});

test('subscriberLedger rejects a charge that names no period', () => {
    assert.equal(chargeValidator()(without(CHARGE, 'periodStart')), false);
});

test('subscriberLedger rejects a currency that is not an ISO 4217 code', () => {
    assert.equal(chargeValidator()({ ...CHARGE, currency: 'Euro' }), false);
});
