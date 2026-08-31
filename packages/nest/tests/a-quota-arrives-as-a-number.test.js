// @requirement SC-PLAN-025 — Every quota a version carries counts as a limit that can be lowered

// What the boundary accepts as a quota, and why it matters that it is checked
// here rather than trusted.
//
// `@IsObject()` said the container is an object and nothing about what is in
// it, so `{ "users": "100" }` reached the service, the repository and the JSON
// column. Two things then went wrong downstream, and the second is the worse
// one:
//
//   - the regression gate compared `"50"` against `"100"` as strings — `'5'`
//     against `'1'` — so halving an allowance read as an improvement and
//     published with nothing asked;
//   - "unlimited" is `=== -1` at every enforcement site, and `"-1"` is not, so
//     an unlimited quota written as a string became `max !== -1` and
//     `used + delta > "-1"`: every request refused, for a tenant who had bought
//     no limit at all.
//
// The shape insisted on here is the one the JSON Schema already states for the
// same field (`plan-catalog.schema.json`: `patternProperties` → `integer`). The
// catalogue-import path was validated by that schema all along; this is the
// admin route catching up.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
    CreatePlanVersionDraftDto,
    UpdatePlanVersionDraftDto,
    CreateBundleVersionDraftDto,
} from '../dist/catalog/index.js';

function refusedProperties(Dto, payload) {
    const errors = validateSync(plainToInstance(Dto, payload), { forbidUnknownValues: true });
    return errors.map((e) => e.property).sort();
}

function messageFor(Dto, payload) {
    const errors = validateSync(plainToInstance(Dto, payload), { forbidUnknownValues: true });
    return Object.values(errors.find((e) => e.property === 'quotas')?.constraints ?? {}).join(' ');
}

const VALID_PLAN_DRAFT = {
    features: ['CASHBOOK'],
    quotas: { users: 5, notesMax: 100 },
    monthlyNet: '9.90',
    yearlyNet: '99.00',
};

describe('a quota arrives as a number or it does not arrive', () => {
    test('integers are accepted, and so is -1 for unlimited', () => {
        assert.deepEqual(refusedProperties(CreatePlanVersionDraftDto, VALID_PLAN_DRAFT), []);
        assert.deepEqual(
            refusedProperties(CreatePlanVersionDraftDto, {
                ...VALID_PLAN_DRAFT,
                quotas: { users: -1, notesMax: 0 },
            }),
            [],
        );
    });

    test('an empty record is accepted — a version may carry no quota at all', () => {
        assert.deepEqual(
            refusedProperties(CreatePlanVersionDraftDto, { ...VALID_PLAN_DRAFT, quotas: {} }),
            [],
        );
    });

    test('a numeric string is refused, and the message names the key', () => {
        const payload = { ...VALID_PLAN_DRAFT, quotas: { users: '100' } };
        assert.deepEqual(refusedProperties(CreatePlanVersionDraftDto, payload), ['quotas']);
        assert.match(messageFor(CreatePlanVersionDraftDto, payload), /users/);
    });

    test('"-1" is refused too — it is the value that would lock a tenant out', () => {
        assert.deepEqual(
            refusedProperties(CreatePlanVersionDraftDto, {
                ...VALID_PLAN_DRAFT,
                quotas: { users: '-1' },
            }),
            ['quotas'],
        );
    });

    test('a fraction, a negative below -1, null and a nested object are refused', () => {
        for (const quota of [{ users: 1.5 }, { users: -2 }, { users: null }, { users: {} }]) {
            assert.deepEqual(
                refusedProperties(CreatePlanVersionDraftDto, {
                    ...VALID_PLAN_DRAFT,
                    quotas: quota,
                }),
                ['quotas'],
                JSON.stringify(quota),
            );
        }
    });

    test('an array is not a quota record', () => {
        assert.deepEqual(
            refusedProperties(CreatePlanVersionDraftDto, { ...VALID_PLAN_DRAFT, quotas: [] }),
            ['quotas'],
        );
    });

    test('the update DTO holds the same line, and leaving quotas out is still allowed', () => {
        assert.deepEqual(refusedProperties(UpdatePlanVersionDraftDto, {}), []);
        assert.deepEqual(
            refusedProperties(UpdatePlanVersionDraftDto, { quotas: { users: 5 } }),
            [],
        );
        assert.deepEqual(refusedProperties(UpdatePlanVersionDraftDto, { quotas: { users: '5' } }), [
            'quotas',
        ]);
    });

    test('an add-on version is held to it as well — it is the same comparison', () => {
        const draft = { features: ['DMS'], quotas: { storageGb: 50 } };
        assert.deepEqual(refusedProperties(CreateBundleVersionDraftDto, draft), []);
        assert.deepEqual(
            refusedProperties(CreateBundleVersionDraftDto, {
                ...draft,
                quotas: { storageGb: '50' },
            }),
            ['quotas'],
        );
    });
});
