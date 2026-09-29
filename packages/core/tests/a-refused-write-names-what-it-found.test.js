import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CATALOG_ERROR_CODES,
    PersistenceRefusal,
    catalogVersionAlreadyPublished,
    catalogVersionGone,
    isPersistenceRefusal,
} from '../dist/index.js';

// An adapter says what it found; the platform turns that into an answer. The
// pairing of case and code lives here once, so both adapters give a caller the
// same code for the same race.

// @requirement SC-PLAN-019 — Two operators cannot publish the same draft
describe('a catalogue version refused', () => {
    for (const [kind, published, gone] of [
        [
            'PlanVersion',
            CATALOG_ERROR_CODES.PLAN_VERSION_ALREADY_PUBLISHED,
            CATALOG_ERROR_CODES.PLAN_VERSION_NOT_FOUND,
        ],
        [
            'BundleVersion',
            CATALOG_ERROR_CODES.BUNDLE_VERSION_ALREADY_PUBLISHED,
            CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND,
        ],
    ]) {
        test(`a ${kind} published first is refused as moved, with its code and id`, () => {
            const refusal = catalogVersionAlreadyPublished(kind, 'v-1');

            assert.equal(refusal.code, published);
            assert.equal(refusal.reason, 'moved');
            assert.deepEqual(refusal.params, { versionId: 'v-1' });
            assert.match(refusal.message, /v-1/);
        });

        test(`a ${kind} that is not there is refused as gone`, () => {
            const refusal = catalogVersionGone(kind, 'v-1');

            assert.equal(refusal.code, gone);
            assert.equal(refusal.reason, 'gone');
            assert.deepEqual(refusal.params, { versionId: 'v-1' });
        });
    }
});

describe('telling a refusal from any other failure', () => {
    test('a refusal is recognised', () => {
        assert.equal(isPersistenceRefusal(catalogVersionGone('PlanVersion', 'v-1')), true);
    });

    test('so is one built by another copy of the class', () => {
        // Thrower and catcher can each load their own module instance, and
        // `instanceof` against the other's class is then false.
        const foreign = Object.assign(new Error('taken'), {
            name: 'PersistenceRefusal',
            code: 'PLAN_VERSION_ALREADY_PUBLISHED',
            reason: 'moved',
        });

        assert.equal(isPersistenceRefusal(foreign), true);
    });

    test('a plain error is not one', () => {
        assert.equal(isPersistenceRefusal(new Error('connection reset')), false);
    });

    test('nor an error that only borrows the name', () => {
        const named = Object.assign(new Error('x'), { name: 'PersistenceRefusal' });

        assert.equal(isPersistenceRefusal(named), false);
    });

    test('nor one whose reason is not a case the platform answers', () => {
        const unknown = new PersistenceRefusal('PLAN_VERSION_NOT_FOUND', 'lost', 'x');

        assert.equal(isPersistenceRefusal(unknown), false);
    });

    test('nor something that is not an error at all', () => {
        assert.equal(
            isPersistenceRefusal({ name: 'PersistenceRefusal', code: 'X', reason: 'gone' }),
            false,
        );
    });
});
