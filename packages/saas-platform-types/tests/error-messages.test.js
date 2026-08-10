import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    ERROR_MESSAGES_DE,
    ERROR_MESSAGES_EN,
    FEATURE_NOT_LICENSED,
    PLATFORM_ERROR_CODES,
    formatErrorMessage,
    resolveErrorMessage,
} from '../dist/index.js';

// The shipped texts are what a consumer shows before translating anything, and
// for the 21 codes thrown as a bare `{ code }` they are the only readable text
// that exists. A code added without a text would therefore surface as
// `PLAN_VERSION_NOT_LIVE` in someone's UI — that is what these guard against.

const SHIPPED_LOCALES = { en: ERROR_MESSAGES_EN, de: ERROR_MESSAGES_DE };

/** Every code that can reach a client, including the one defined elsewhere. */
const ALL_CODES = [...Object.values(PLATFORM_ERROR_CODES), FEATURE_NOT_LICENSED];

const placeholders = (template) => new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

describe('shipped error messages', () => {
    for (const [locale, catalogue] of Object.entries(SHIPPED_LOCALES)) {
        test(`${locale} has a text for every error code`, () => {
            const missing = ALL_CODES.filter((code) => !catalogue[code]);
            assert.deepEqual(missing, [], `${locale} is missing: ${missing.join(', ')}`);
        });

        test(`${locale} has no text for an unknown code`, () => {
            const known = new Set(ALL_CODES);
            const orphans = Object.keys(catalogue).filter((code) => !known.has(code));
            assert.deepEqual(orphans, [], `${locale} has orphaned texts: ${orphans.join(', ')}`);
        });
    }

    test('every locale interpolates the same placeholders per code', () => {
        const [reference, ...others] = Object.entries(SHIPPED_LOCALES);
        for (const [locale, catalogue] of others) {
            for (const code of ALL_CODES) {
                assert.deepEqual(
                    [...placeholders(catalogue[code])].sort(),
                    [...placeholders(reference[1][code])].sort(),
                    `${locale}.${code} interpolates different values than ${reference[0]}`,
                );
            }
        }
    });
});

describe('formatErrorMessage', () => {
    test('substitutes named values', () => {
        assert.equal(
            formatErrorMessage('Plan {planId} not found', { planId: 'p1' }),
            'Plan p1 not found',
        );
    });

    test('leaves an unknown placeholder visible rather than dropping it', () => {
        assert.equal(formatErrorMessage('Plan {planId} not found', {}), 'Plan {planId} not found');
    });

    test('treats null like a missing value', () => {
        assert.equal(formatErrorMessage('{a} and {b}', { a: 0, b: null }), '0 and {b}');
    });
});

describe('resolveErrorMessage', () => {
    const body = { code: 'PLAN_NOT_FOUND', message: 'Plan p1 not found', params: { planId: 'p1' } };

    test('prefers the consumer override', () => {
        assert.equal(
            resolveErrorMessage(body, { PLAN_NOT_FOUND: 'Kein Plan {planId}' }),
            'Kein Plan p1',
        );
    });

    test('falls back to the shipped default', () => {
        assert.match(resolveErrorMessage(body), /p1/);
    });

    test('falls back to the message when the code has no text', () => {
        assert.equal(
            resolveErrorMessage({ code: 'SOMETHING_NEW', message: 'Backend prose' }, {}, {}),
            'Backend prose',
        );
    });

    test('falls back to the code only when there is no message either', () => {
        assert.equal(resolveErrorMessage({ code: 'SOMETHING_NEW' }, {}, {}), 'SOMETHING_NEW');
    });

    test('reads top-level body fields when a placeholder is not in params', () => {
        assert.equal(
            resolveErrorMessage({ code: 'X', draftCount: 3 }, { X: '{draftCount} drafts' }),
            '3 drafts',
        );
    });

    test('params win over a top-level field of the same name', () => {
        assert.equal(
            resolveErrorMessage({ code: 'X', n: 1, params: { n: 2 } }, { X: 'n={n}' }),
            'n=2',
        );
    });
});
