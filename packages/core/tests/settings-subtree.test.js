// The settings subtree: what of a catalogue is configuration, and how two of
// them are compared.
//
// The exclusion list is the decision worth a guard. Written as a list of
// settings, a block the schema gains later would be left out of the fingerprint
// and a change to it never noticed — so the list names what is NOT a setting,
// and this holds that list to the schema: every name in it is a property the
// schema declares, and every property the schema declares lands on one side.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CATALOGUE_KEYS, canonicalJson, diffSettings, settingsSubtreeOf } from '../dist/index.js';

// Off the sibling package's directory, the way the codegen reads it: this
// package depends on no other, and the schema is the source the exclusion list
// has to be held to.
const planCatalogSchema = JSON.parse(
    readFileSync(new URL('../../spec/schemas/plan-catalog.schema.json', import.meta.url), 'utf8'),
);

const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Demo', label: 'Demo Cockpit' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling: {
        cancellationNoticeDays: { monthly: 14, yearly: 90 },
        selfServiceBlockedPlans: { asTarget: ['ENTERPRISE'], asSource: [] },
    },
    marketing: { availableLocales: ['en', 'de'] },
    features: [{ key: 'CORE' }],
    plans: [{ id: 'BASIC', quotas: { users: 1 }, features: ['CORE'] }],
};

// @requirement SC-CFG-025 — The installation records the configuration it applied, and notices when it changed
describe('the settings subtree', () => {
    test('is the catalogue without its plans, features and format marker', () => {
        assert.deepEqual(settingsSubtreeOf(CATALOG), {
            app: CATALOG.app,
            currency: 'EUR',
            vatRate: 19,
            tenantBilling: CATALOG.tenantBilling,
            marketing: CATALOG.marketing,
        });
    });

    test('a block left out of the file is left out of the subtree, not written as undefined', () => {
        const { marketing: _omitted, ...withoutMarketing } = CATALOG;
        assert.deepEqual(Object.keys(settingsSubtreeOf(withoutMarketing)).sort(), [
            'app',
            'currency',
            'tenantBilling',
            'vatRate',
        ]);
        assert.deepEqual(settingsSubtreeOf({ ...withoutMarketing, marketing: undefined }), {
            ...settingsSubtreeOf(withoutMarketing),
        });
    });

    test('every excluded name is a property the schema declares', () => {
        const declared = Object.keys(planCatalogSchema.properties);
        for (const key of CATALOGUE_KEYS) {
            assert.ok(declared.includes(key), `${key} is excluded but not in the schema`);
        }
    });

    test('a block the schema gains is a setting until somebody says otherwise', () => {
        // The other direction of the guard above: the subtree is the schema's
        // properties minus the exclusions, so a new top-level block shows up in
        // the fingerprint without anybody remembering to add it.
        const everyProperty = Object.fromEntries(
            Object.keys(planCatalogSchema.properties).map((key) => [key, `value of ${key}`]),
        );
        const expected = Object.keys(planCatalogSchema.properties).filter(
            (key) => !CATALOGUE_KEYS.has(key),
        );
        assert.deepEqual(Object.keys(settingsSubtreeOf(everyProperty)).sort(), expected.sort());
        assert.ok(expected.includes('tenantBilling'));
        assert.ok(!expected.includes('plans'));
    });
});

describe('canonical JSON', () => {
    test('does not depend on the order keys were written in', () => {
        assert.equal(
            canonicalJson({ b: { y: 1, x: [3, 2] }, a: 'z' }),
            canonicalJson({ a: 'z', b: { x: [3, 2], y: 1 } }),
        );
    });

    test('keeps the order of a list — a list is what its author wrote', () => {
        assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
    });
});

// @requirement SC-CFG-025 — The installation records the configuration it applied, and notices when it changed
describe('the difference between two settings subtrees', () => {
    const before = settingsSubtreeOf(CATALOG);

    test('is empty for the same values in another order', () => {
        const reordered = JSON.parse(
            canonicalJson({ ...before, tenantBilling: { ...before.tenantBilling } }),
        );
        assert.deepEqual(diffSettings(before, reordered), []);
    });

    test('names each changed leaf by its dotted path, with both sides', () => {
        const after = {
            ...before,
            vatRate: 20,
            tenantBilling: {
                ...before.tenantBilling,
                cancellationNoticeDays: { monthly: 30, yearly: 90 },
            },
        };
        assert.deepEqual(diffSettings(before, after), [
            { path: 'tenantBilling.cancellationNoticeDays.monthly', before: 14, after: 30 },
            { path: 'vatRate', before: 19, after: 20 },
        ]);
    });

    test('a list that changed is one difference, not one per element', () => {
        const after = {
            ...before,
            tenantBilling: {
                ...before.tenantBilling,
                selfServiceBlockedPlans: { asTarget: [], asSource: ['ENTERPRISE'] },
            },
        };
        assert.deepEqual(diffSettings(before, after), [
            {
                path: 'tenantBilling.selfServiceBlockedPlans.asSource',
                before: [],
                after: ['ENTERPRISE'],
            },
            {
                path: 'tenantBilling.selfServiceBlockedPlans.asTarget',
                before: ['ENTERPRISE'],
                after: [],
            },
        ]);
    });

    test('a leaf that appeared or vanished is reported with undefined on the missing side', () => {
        const { marketing: _gone, ...withoutMarketing } = before;
        assert.deepEqual(diffSettings(before, withoutMarketing), [
            { path: 'marketing.availableLocales', before: ['en', 'de'], after: undefined },
        ]);
        assert.deepEqual(diffSettings(withoutMarketing, before), [
            { path: 'marketing.availableLocales', before: undefined, after: ['en', 'de'] },
        ]);
    });
});
