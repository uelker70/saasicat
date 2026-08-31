// @requirement SC-LANG-006 — Text a customer reads carries its values beside its code, not inside a sentence

import { describe, expect, test } from 'vitest';

import { messageParts } from '../../src/message-parts';

// Dates are set in bold inside a sentence, which means the sentence has to
// arrive as parts rather than as a string. `v-html` would have done it in one
// line and would have turned a consumer-supplied translation into markup.

describe('a message becomes parts', () => {
    test('the substituted date is the emphasised one', () => {
        expect(messageParts('takes effect on {date}.', { date: '01.01.2027' })).toEqual([
            { text: 'takes effect on ', strong: false },
            { text: '01.01.2027', strong: true },
            { text: '.', strong: false },
        ]);
    });

    test('other values are substituted without emphasis', () => {
        const parts = messageParts('{plan} from {date}', { plan: 'Pro', date: 'X' });
        expect(parts.find((p) => p.text === 'Pro')?.strong).toBe(false);
        expect(parts.find((p) => p.text === 'X')?.strong).toBe(true);
    });

    test('a placeholder nobody supplied stays visible', () => {
        // A sentence with a hole is harder to notice than a stray `{date}`, and
        // this is a translation bug either way.
        expect(messageParts('on {missing}', {})).toEqual([
            { text: 'on ', strong: false },
            { text: '{missing}', strong: false },
        ]);
    });

    test('an unclosed brace is left alone rather than eating the rest', () => {
        expect(messageParts('a { b', { date: 'X' })).toEqual([{ text: 'a { b', strong: false }]);
    });

    test('a message without placeholders is one part', () => {
        expect(messageParts('nothing to fill', {})).toEqual([
            { text: 'nothing to fill', strong: false },
        ]);
    });

    test('two dates are both emphasised', () => {
        const parts = messageParts('{deadline} then {date}', { deadline: 'A', date: 'B' });
        expect(parts.filter((p) => p.strong).map((p) => p.text)).toEqual(['A', 'B']);
    });
});
