import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    bundleDraftDefaults,
    bundleStemDefaults,
    definedFields,
    toBundleStemRow,
} from '../dist/index.js';

// The defaulting rules every bundle adapter applies.
//
// They lived in each adapter until `adapter-drizzle` learned about bundles and
// put a second copy beside `adapter-prisma`'s — the same decision written
// twice, which is the kind that drifts without anything going red. Here once,
// tested once, and the negatives matter more than the positives: what a caller
// omits is exactly what a second copy would have guessed differently.

describe('what a new draft starts from', () => {
    const minimal = { bundleId: 'b-1', features: ['REPORTS'] };

    test('an omitted quota map is empty, not absent', () => {
        // `undefined` reaching a jsonb column is not the same as `{}`, and the
        // column is NOT NULL.
        assert.deepEqual(bundleDraftDefaults(minimal).quotas, {});
        assert.deepEqual(bundleDraftDefaults(minimal).compatibility, {});
        assert.deepEqual(bundleDraftDefaults(minimal).pricingOverrides, []);
    });

    test('an omitted price is null, not zero', () => {
        // Zero is a price somebody typed; null is a price nobody set, and the
        // publish gate treats the two very differently.
        const d = bundleDraftDefaults(minimal);
        assert.equal(d.monthlyNet, null);
        assert.equal(d.yearlyNet, null);
    });

    test('an unstated bundle is marketed', () => {
        assert.equal(bundleDraftDefaults(minimal).marketed, true);
    });

    test('…and an explicit false stays false', () => {
        assert.equal(bundleDraftDefaults({ ...minimal, marketed: false }).marketed, false);
    });

    test('an omitted change note is empty, and lineage is null', () => {
        const d = bundleDraftDefaults(minimal);
        assert.equal(d.changeNote, '');
        assert.equal(d.baseVersionId, null);
        assert.equal(d.createdByUserId, null);
    });

    test('everything given is passed through untouched', () => {
        const given = {
            bundleId: 'b-1',
            baseVersionId: 'v-0',
            features: ['A', 'B'],
            quotas: { users: 5 },
            compatibility: { planIds: ['PRO'] },
            pricingOverrides: [{ planId: 'PRO', monthlyNet: '1.00' }],
            monthlyNet: '9.90',
            yearlyNet: '99.00',
            marketed: false,
            changeNote: 'why',
            createdByUserId: 'u-1',
        };
        const d = bundleDraftDefaults(given);
        for (const [key, value] of Object.entries(given)) {
            if (key === 'bundleId') continue;
            assert.deepEqual(d[key], value, key);
        }
    });

    test('it says nothing about validity windows', () => {
        // Whether a draft carries them is an adapter capability, not a default.
        // An adapter that does not maintain the columns must not write them.
        const d = bundleDraftDefaults({ ...minimal, validFrom: '2026-01-01' });
        assert.equal('validFrom' in d, false);
        assert.equal('validUntil' in d, false);
    });
});

describe('what a new bundle stem starts from', () => {
    const minimal = { projectKey: 'app', bundleKey: 'REPORTING', label: 'Reporting' };

    test('an omitted description or icon is null, not an empty string', () => {
        const d = bundleStemDefaults(minimal);
        assert.equal(d.description, null);
        assert.equal(d.icon, null);
    });

    test('an unstated sort order is zero, and an explicit zero survives', () => {
        assert.equal(bundleStemDefaults(minimal).sortOrder, 0);
        assert.equal(bundleStemDefaults({ ...minimal, sortOrder: 0 }).sortOrder, 0);
        assert.equal(bundleStemDefaults({ ...minimal, sortOrder: 7 }).sortOrder, 7);
    });

    test('an omitted translation map is empty', () => {
        assert.deepEqual(bundleStemDefaults(minimal).i18n, {});
    });

    test('the identity fields are carried straight over', () => {
        const d = bundleStemDefaults(minimal);
        assert.equal(d.projectKey, 'app');
        assert.equal(d.bundleKey, 'REPORTING');
        assert.equal(d.label, 'Reporting');
    });
});

describe('reading a stored stem back', () => {
    const stored = {
        id: 'b-1',
        projectKey: 'app',
        bundleKey: 'REPORTING',
        label: 'Reporting',
        description: null,
        icon: null,
        sortOrder: 3,
        i18n: { de: { label: 'Berichte' } },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        deletedAt: null,
    };

    test('dates become ISO strings, because that is what the row type says', () => {
        const row = toBundleStemRow(stored);
        assert.equal(row.createdAt, '2026-01-01T00:00:00.000Z');
        assert.equal(row.updatedAt, '2026-02-01T00:00:00.000Z');
        assert.equal(row.deletedAt, null);
    });

    test('a retired stem carries its date rather than a flag', () => {
        const row = toBundleStemRow({ ...stored, deletedAt: new Date('2026-03-01T00:00:00.000Z') });
        assert.equal(row.deletedAt, '2026-03-01T00:00:00.000Z');
    });

    test('an i18n map is passed through', () => {
        assert.deepEqual(toBundleStemRow(stored).i18n, { de: { label: 'Berichte' } });
    });

    test('anything that is not a map becomes one', () => {
        // JSON columns hold whatever was written. A caller that expects a map
        // and gets an array or a string fails somewhere far from here.
        for (const junk of [null, undefined, [], 'text', 42]) {
            assert.deepEqual(toBundleStemRow({ ...stored, i18n: junk }).i18n, {}, String(junk));
        }
    });
});

describe('the fields a caller actually gave', () => {
    // Update DTOs mean three different things by three different values: a
    // value changes the column, an explicit `null` clears it, and an omitted
    // field leaves it alone. Only the third needs care, and it was written out
    // as `...(data.x !== undefined ? { x: data.x } : {})` more than fifty times
    // across five repositories before this.

    test('an omitted field is not in the patch at all', () => {
        // Not `{ label: undefined }`: a key that is present with an undefined
        // value is a column some drivers will happily set to NULL.
        const patch = definedFields({ label: 'New' }, ['label', 'description', 'icon']);
        assert.deepEqual(Object.keys(patch), ['label']);
        assert.equal('description' in patch, false);
    });

    test('an explicit null is kept, because somebody chose it', () => {
        const patch = definedFields({ description: null }, ['description']);
        assert.equal('description' in patch, true);
        assert.equal(patch.description, null);
    });

    test('falsy values are values', () => {
        // Zero, an empty string and false are the three that a naive truthiness
        // check would drop, and all three are legitimate column values.
        const patch = definedFields({ sortOrder: 0, label: '', marketed: false }, [
            'sortOrder',
            'label',
            'marketed',
        ]);
        assert.deepEqual(patch, { sortOrder: 0, label: '', marketed: false });
    });

    test('a key that was not asked for is not in the patch', () => {
        // The key list is the allow-list: a DTO that has grown a field the
        // repository does not write must not start writing it by accident.
        const patch = definedFields({ label: 'New', secret: 'x' }, ['label']);
        assert.deepEqual(patch, { label: 'New' });
    });

    test('an empty patch is empty, not undefined', () => {
        assert.deepEqual(definedFields({}, ['label']), {});
        assert.deepEqual(definedFields({ label: 'x' }, []), {});
    });
});
