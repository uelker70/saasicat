// What an e-invoice in the XML of EN 16931 can say, read the same way by the
// renderer that writes it, the tax adapter that checks it and the API that
// takes a subscriber's details: the category each treatment takes, and the
// characters XML 1.0 can hold at all. Each range of the `Char` production is
// tried at its edges and just past them.

// @requirement SC-PRIC-078 — The shipped renderer issues an invoice the format's own validators accept

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    TAX_TREATMENT_KINDS,
    holdsOnlyXmlCharacters,
    vatCategoryOf,
    withXmlCharactersOnly,
} from '../dist/index.js';

describe('the VAT category of a treatment', () => {
    test('is the one EN 16931 names, for every treatment an adapter can decide', () => {
        assert.deepEqual(
            Object.fromEntries(TAX_TREATMENT_KINDS.map((kind) => [kind, vatCategoryOf(kind)])),
            {
                standard: 'S',
                reduced: 'S',
                exempt: 'E',
                'small-business': 'E',
                'reverse-charge': 'AE',
                'not-taxable': 'O',
            },
        );
    });
});

describe('a character in an e-invoice', () => {
    for (const [what, character] of [
        ['a tab', '\t'],
        ['a line feed', '\n'],
        ['a carriage return', '\r'],
        ['a space, where the printable range begins', ' '],
        ['the last before the surrogates', '\uD7FF'],
        ['the first after them', '\uE000'],
        ['the replacement character', '\uFFFD'],
        ['the first beyond the basic plane, as a surrogate pair', '\u{10000}'],
        ['the last code point there is', '\u{10FFFF}'],
    ]) {
        test(`stands as it is: ${what}`, () => {
            assert.equal(holdsOnlyXmlCharacters(`a${character}b`), true);
            assert.equal(withXmlCharactersOnly(`a${character}b`), `a${character}b`);
        });
    }

    for (const [what, character] of [
        ['the null character', '\u0000'],
        ['a backspace, just below the tab', '\u0008'],
        ['a vertical tab, between line feed and carriage return', '\u000B'],
        ['a form feed', '\u000C'],
        ['the first after the carriage return', '\u000E'],
        ['the last control character, just below the space', '\u001F'],
        ['a lone high surrogate', '\uD800'],
        ['a lone low surrogate', '\uDFFF'],
        ['U+FFFE, just past the replacement character', '\uFFFE'],
        ['U+FFFF', '\uFFFF'],
    ]) {
        test(`cannot stand, and is written as ?: ${what}`, () => {
            assert.equal(holdsOnlyXmlCharacters(`a${character}b`), false);
            assert.equal(withXmlCharactersOnly(`a${character}b`), 'a?b');
        });
    }

    test('is judged the same however often it is asked, each one replaced', () => {
        const pasted = 'Acme\u000BGmbH\u000C';

        assert.equal(holdsOnlyXmlCharacters(pasted), false);
        assert.equal(holdsOnlyXmlCharacters(pasted), false);
        assert.equal(withXmlCharactersOnly(pasted), 'Acme?GmbH?');
        assert.equal(withXmlCharactersOnly(pasted), 'Acme?GmbH?');
    });
});
