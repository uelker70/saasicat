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
    tenantLedgerSchema,
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
// TenantLedgerEntry: the two kinds, and the account read model
// ──────────────────────────────────────────────────────────────────

/** A charge with every required fact present. Each case below alters one. */
const CHARGE = {
    id: '22222222-2222-2222-2222-222222222222',
    tenantId: 'tenant-1',
    kind: 'charge',
    subscriptionId: 'sub-1',
    origin: 'renewal',
    originRef: 'sub-1',
    periodStart: '2026-01-01T00:00:00Z',
    periodEnd: '2026-02-01T00:00:00Z',
    contractId: 'contract-1',
    contractLineItemId: 'line-1',
    currency: 'EUR',
    amountNet: 19.9,
    taxRate: 19,
    taxAmount: 3.78,
    amountGross: 23.68,
    bookedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:01Z',
};

/**
 * The same for a payment: an external reference, no period, and no tax split —
 * the net, the rate and the tax belong to the charges it settles.
 */
const PAYMENT = {
    id: '33333333-3333-3333-3333-333333333333',
    tenantId: 'tenant-1',
    kind: 'payment',
    externalReference: 'pi_3Nk2xQ',
    settlesEntryId: CHARGE.id,
    currency: 'EUR',
    amountGross: 23.68,
    bookedAt: '2026-01-03T09:12:00Z',
    createdAt: '2026-01-03T09:12:01Z',
};

function without(entry, field) {
    const copy = { ...entry };
    delete copy[field];
    return copy;
}

function ledgerEntryValidator() {
    return makeAjv().compile(tenantLedgerSchema);
}

/**
 * A validator for one `$defs` entry.
 *
 * Not `{ ...tenantLedgerSchema, $ref }`: in 2020-12 a `$ref` applies BESIDE its
 * siblings rather than replacing them, so that form asks for the definition
 * AND the root's `oneOf` — under which an account matches neither branch. The
 * accept case fails, and the reject case passes for a reason that has nothing
 * to do with what it claims to check.
 */
function ledgerDefinitionValidator(name) {
    return makeAjv().compile({
        $schema: tenantLedgerSchema.$schema,
        $defs: tenantLedgerSchema.$defs,
        $ref: `#/$defs/${name}`,
    });
}

test('tenantLedger accepts a charge carrying its period, origin and money facts', () => {
    const validate = ledgerEntryValidator();
    const ok = validate(CHARGE);
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

test('tenantLedger accepts a charge that names no contract', () => {
    const validate = ledgerEntryValidator();
    const ok = validate({ ...CHARGE, contractId: null, contractLineItemId: null });
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

test('tenantLedger accepts a payment, which carries no period', () => {
    const validate = ledgerEntryValidator();
    const ok = validate(PAYMENT);
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

test('tenantLedger accepts a payment on account, settling no named charge', () => {
    const validate = ledgerEntryValidator();
    const ok = validate({ ...PAYMENT, settlesEntryId: null });
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

test('tenantLedger rejects a charge without an origin', () => {
    assert.equal(ledgerEntryValidator()(without(CHARGE, 'origin')), false);
});

test('tenantLedger rejects an origin outside the catalogue of origins', () => {
    assert.equal(ledgerEntryValidator()({ ...CHARGE, origin: 'refund' }), false);
});

test('tenantLedger rejects an empty originRef, which would not collide with itself', () => {
    assert.equal(ledgerEntryValidator()({ ...CHARGE, originRef: '' }), false);
});

test('tenantLedger rejects a charge that names no period', () => {
    assert.equal(ledgerEntryValidator()(without(CHARGE, 'periodStart')), false);
});

test('tenantLedger rejects a payment without an external reference', () => {
    assert.equal(ledgerEntryValidator()(without(PAYMENT, 'externalReference')), false);
});

test('tenantLedger rejects a payment whose external reference is empty', () => {
    assert.equal(ledgerEntryValidator()({ ...PAYMENT, externalReference: '' }), false);
});

test('tenantLedger rejects an entry that is neither a charge nor a payment', () => {
    assert.equal(ledgerEntryValidator()({ ...CHARGE, kind: 'adjustment' }), false);
});

test('tenantLedger rejects a charge wearing a payment field', () => {
    assert.equal(ledgerEntryValidator()({ ...CHARGE, externalReference: 'pi_3Nk2xQ' }), false);
});

test('tenantLedger rejects a payment that states a tax of its own', () => {
    // A payment settles charges that already state theirs. Letting it carry a
    // second answer is how an account comes to hold two totals for one tax.
    assert.equal(ledgerEntryValidator()({ ...PAYMENT, taxRate: 19, taxAmount: 3.78 }), false);
});

test('tenantLedger rejects a currency that is not an ISO 4217 code', () => {
    assert.equal(ledgerEntryValidator()({ ...CHARGE, currency: 'Euro' }), false);
});

test('tenantLedger rejects a tax rate above 100 per cent', () => {
    assert.equal(ledgerEntryValidator()({ ...CHARGE, taxRate: 119 }), false);
});

test('tenantLedger accepts a credit, which is a negative charge', () => {
    const validate = ledgerEntryValidator();
    const ok = validate({
        ...CHARGE,
        origin: 'credit',
        originRef: CHARGE.id,
        amountNet: -19.9,
        taxAmount: -3.78,
        amountGross: -23.68,
    });
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

test('tenantLedger accepts an account with a balance, open items and history', () => {
    const validate = ledgerDefinitionValidator('TenantAccount');
    const ok = validate({
        tenantId: 'tenant-1',
        currency: 'EUR',
        asOf: '2026-02-01T00:00:00Z',
        chargedGross: 23.68,
        paidGross: 0,
        balanceGross: 23.68,
        openItems: [
            {
                entryId: CHARGE.id,
                origin: 'renewal',
                periodStart: CHARGE.periodStart,
                periodEnd: CHARGE.periodEnd,
                currency: 'EUR',
                amountGross: 23.68,
                settledGross: 0,
                openGross: 23.68,
                dueAt: CHARGE.bookedAt,
            },
        ],
        entries: [CHARGE, PAYMENT],
    });
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

test('tenantLedger rejects an account that does not say when its balance is true', () => {
    const validate = ledgerDefinitionValidator('TenantAccount');
    const ok = validate({
        tenantId: 'tenant-1',
        currency: 'EUR',
        chargedGross: 0,
        paidGross: 0,
        balanceGross: 0,
        openItems: [],
        entries: [],
    });
    assert.equal(ok, false);
});
