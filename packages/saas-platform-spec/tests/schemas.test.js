// Schema-Selbstkonsistenz-Tests für @saasicat/spec.
// Prüft: alle JSON-Schemas sind syntaktisch valides JSON-Schema 2020-12,
// und einfache Beispiel-Payloads validieren erfolgreich.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
    adminManifestSchema,
    planCatalogSchema,
    promoCodeSchema,
    auditEventSchema,
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
        projectKey: 'autohauspro',
        currency: 'EUR',
        vatRate: 19,
        quotaKeys: ['users', 'vehicles'],
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
        project: { key: 'autohauspro', displayName: 'AutohausPro' },
        build: {
            platformPackageVersion: '0.1.0',
            appVersion: 'autohauspro@2026.05.07',
            manifestHash: 'sha256-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
        },
        planCatalogSnapshot: {
            source: 'config/plans.yaml',
            hash: 'sha256-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF',
            currency: 'EUR',
            vatRate: 19,
            quotaKeys: ['users'],
            plans: [{ id: 'BASIC', quotas: { users: 1 }, features: [] }],
        },
        capabilities: { 'tenants.read': true },
        navigation: {
            standardPages: { tenants: { enabled: true, requiredCapability: 'tenants.read' } },
        },
    });
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
});

test('adminManifest rejects capability with colon notation', () => {
    const ajv = makeAjv();
    const validate = ajv.compile(adminManifestSchema);
    const ok = validate({
        schemaVersion: 1,
        project: { key: 'autohauspro', displayName: 'AutohausPro' },
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
            quotaKeys: ['users'],
            plans: [{ id: 'BASIC', quotas: { users: 1 }, features: [] }],
        },
        capabilities: { 'tenants:read': true }, // ← Doppelpunkt verboten
        navigation: { standardPages: {} },
    });
    assert.equal(ok, false);
});
