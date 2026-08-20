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
// `PLAN_VERSION_SUPERSEDED` in someone's UI.
//
// The key half of that is the compiler's, not this file's. Both catalogues are
// `Record<PlatformErrorCode, string>` over a closed union, so a missing code is
// a TS2741 and a text for a code that no longer exists is a TS2561 — in either
// catalogue, before any test runs. The cases below re-state it at runtime,
// which costs nothing and keeps the failure legible if the type is ever
// widened.
//
// What the type cannot see is what the texts SAY, and that is the case worth
// having: two catalogues can carry the same keys and interpolate different
// values, and then the German sentence renders `{waitSeconds}` at the reader.

const SHIPPED_LOCALES = { en: ERROR_MESSAGES_EN, de: ERROR_MESSAGES_DE };

/**
 * Every code that can reach a client.
 *
 * Read off `PLATFORM_ERROR_CODES` alone. `FEATURE_NOT_LICENSED` is declared in
 * `upsell.types.ts` and re-exported into `BILLING_ERROR_CODES` for exactly this
 * reason, so naming it a second time here would suggest the map is incomplete
 * when it is not.
 */
const ALL_CODES = Object.values(PLATFORM_ERROR_CODES);

const placeholders = (template) => new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

describe('shipped error messages', () => {
    test('the code map carries the one code declared in another file', () => {
        // The premise `ALL_CODES` rests on. If `FEATURE_NOT_LICENSED` were ever
        // dropped from `BILLING_ERROR_CODES`, every check below would quietly
        // stop covering it — and the union would stop requiring a text for it
        // in the same edit, so nothing else would notice.
        assert.ok(
            ALL_CODES.includes(FEATURE_NOT_LICENSED),
            'FEATURE_NOT_LICENSED is no longer reachable through PLATFORM_ERROR_CODES',
        );
    });

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
