import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
    CreateBundleDto,
    CreateBundleVersionDraftDto,
    UpdateBundleDto,
    UpdateBundleVersionDraftDto,
} from '../dist/catalog/index.js';

// What the four bundle DTOs accept and refuse.
//
// They had no test at all, which is the state that makes a DTO dangerous
// rather than merely repetitive: a decorator dropped in a refactor removes a
// check and nothing anywhere goes red, because the platform does not install
// the pipe — the consumer does. These cases exist so the de-duplication of
// their decorator stacks could be verified rather than hoped for.
//
// `whitelist: true` and `forbidNonWhitelisted` are not set here. This asks what
// the DECORATORS say; what the pipe strips is the consumer's setting, and
// `examples/notesapp/src/main.ts` is where that is shown.

/** The property names a payload is refused for, sorted. */
function refusedProperties(Dto, payload) {
    const errors = validateSync(plainToInstance(Dto, payload), {
        forbidUnknownValues: true,
    });
    return errors.map((e) => e.property).sort();
}

const VALID_BUNDLE = {
    bundleKey: 'BANKING',
    label: 'Banking',
    description: 'Payments and statements',
    icon: 'account_balance',
    sortOrder: 10,
    i18n: { en: { label: 'Banking' } },
};

const VALID_DRAFT = {
    features: ['SEPA_EXPORT', 'CAMT_IMPORT'],
    quotas: { accounts: 5 },
    monthlyNet: '9.90',
    yearlyNet: '99.00',
    changeNote: 'first version',
    validFrom: '2026-04-01',
    validUntil: null,
};

describe('CreateBundleDto', () => {
    test('accepts a complete bundle', () => {
        assert.deepEqual(refusedProperties(CreateBundleDto, VALID_BUNDLE), []);
    });

    test('requires the two identity fields', () => {
        assert.deepEqual(refusedProperties(CreateBundleDto, {}), ['bundleKey', 'label']);
    });

    test('holds the key pattern', () => {
        // The key is what a URL and a feature lookup are built from, so its
        // shape is a contract rather than a preference.
        assert.deepEqual(
            refusedProperties(CreateBundleDto, { ...VALID_BUNDLE, bundleKey: 'banking' }),
            ['bundleKey'],
        );
    });

    test('holds the lengths and the sort-order range', () => {
        assert.deepEqual(refusedProperties(CreateBundleDto, { ...VALID_BUNDLE, label: '' }), [
            'label',
        ]);
        assert.deepEqual(
            refusedProperties(CreateBundleDto, { ...VALID_BUNDLE, description: 'x'.repeat(2001) }),
            ['description'],
        );
        assert.deepEqual(refusedProperties(CreateBundleDto, { ...VALID_BUNDLE, sortOrder: -1 }), [
            'sortOrder',
        ]);
        assert.deepEqual(
            refusedProperties(CreateBundleDto, { ...VALID_BUNDLE, sortOrder: 10_001 }),
            ['sortOrder'],
        );
    });
});

describe('UpdateBundleDto', () => {
    test('accepts an empty patch', () => {
        // Every field is optional: an update that changes one thing sends one
        // thing.
        assert.deepEqual(refusedProperties(UpdateBundleDto, {}), []);
    });

    test('clears a text field with null, and keeps the same limits', () => {
        // `null` is how a caller says "remove this", which is the one place the
        // update contract differs from the create one.
        assert.deepEqual(refusedProperties(UpdateBundleDto, { description: null, icon: null }), []);
        assert.deepEqual(refusedProperties(UpdateBundleDto, { label: '' }), ['label']);
        assert.deepEqual(refusedProperties(UpdateBundleDto, { sortOrder: 10_001 }), ['sortOrder']);
    });
});

describe('CreateBundleVersionDraftDto', () => {
    test('accepts a complete draft', () => {
        assert.deepEqual(refusedProperties(CreateBundleVersionDraftDto, VALID_DRAFT), []);
    });

    test('requires the feature list', () => {
        // The one field that separates this from the update DTO.
        assert.deepEqual(refusedProperties(CreateBundleVersionDraftDto, {}), ['features']);
    });

    test('holds the feature-key shape', () => {
        assert.deepEqual(
            refusedProperties(CreateBundleVersionDraftDto, { features: ['sepa_export'] }),
            ['features'],
        );
    });

    test('holds the decimal shape, and lets null through', () => {
        // A price with three fraction digits is a rounding decision nobody
        // made; `null` is "no price of its own".
        assert.deepEqual(
            refusedProperties(CreateBundleVersionDraftDto, { ...VALID_DRAFT, monthlyNet: '9.905' }),
            ['monthlyNet'],
        );
        assert.deepEqual(
            refusedProperties(CreateBundleVersionDraftDto, {
                ...VALID_DRAFT,
                monthlyNet: null,
                yearlyNet: null,
            }),
            [],
        );
    });

    test('holds the date shape, and lets null through', () => {
        assert.deepEqual(
            refusedProperties(CreateBundleVersionDraftDto, {
                ...VALID_DRAFT,
                validFrom: '01.04.2026',
            }),
            ['validFrom'],
        );
        assert.deepEqual(
            refusedProperties(CreateBundleVersionDraftDto, { ...VALID_DRAFT, validFrom: null }),
            [],
        );
    });
});

describe('UpdateBundleVersionDraftDto', () => {
    test('accepts an empty patch and the same shapes as create', () => {
        assert.deepEqual(refusedProperties(UpdateBundleVersionDraftDto, {}), []);
        assert.deepEqual(refusedProperties(UpdateBundleVersionDraftDto, VALID_DRAFT), []);
    });

    test('refuses what create refuses, field for field', () => {
        // The pair carried the same constraints written twice, and this is the
        // assertion that they stay the same pair: if one side gains a rule the
        // other does not, the same payload stops being refused by both.
        for (const [field, value] of [
            ['features', ['sepa_export']],
            ['monthlyNet', '9.905'],
            ['yearlyNet', '9.905'],
            ['validFrom', '01.04.2026'],
            ['validUntil', '01.04.2026'],
            ['changeNote', 'x'.repeat(2001)],
        ]) {
            const payload = { ...VALID_DRAFT, [field]: value };
            assert.deepEqual(
                refusedProperties(UpdateBundleVersionDraftDto, payload),
                refusedProperties(CreateBundleVersionDraftDto, payload),
                `${field} is judged differently by the two draft DTOs`,
            );
        }
    });
});
