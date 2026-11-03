import { describe, expect, test } from 'vitest';

import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';

// The tenant's screens speak to a business — the person who books a plan or
// files its invoices — and the German catalogue says "Sie" throughout. One
// sentence in "du" beside the rest reads as two products. The words are read
// off the catalogue itself, every sentence of it, so a new key is held to it
// the moment it exists.

/** The words that address the reader informally, in every form a sentence takes. */
const INFORMAL = new Set([
    'du',
    'dich',
    'dir',
    'dein',
    'deine',
    'deinen',
    'deinem',
    'deiner',
    'deines',
]);

/** Every sentence of the catalogue, by the key it stands under. */
function sentencesOf(value: unknown, key = ''): Array<[string, string]> {
    if (typeof value === 'string') return [[key, value]];
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value).flatMap(([name, inner]) =>
        sentencesOf(inner, key ? `${key}.${name}` : name),
    );
}

/** The words of a sentence, lower case; a placeholder's name is no word of it. */
function wordsOf(sentence: string): string[] {
    const withoutPlaceholders = sentence
        .split('{')
        .map((part, index) => (index === 0 ? part : part.slice(part.indexOf('}') + 1)))
        .join(' ');
    return withoutPlaceholders
        .toLowerCase()
        .split(/[^a-zäöüß]+/)
        .filter((word) => word !== '');
}

describe('the German texts of the tenant’s screens', () => {
    test('address the reader as "Sie", in every sentence', () => {
        const informal = sentencesOf(defaultTenantPlanSectionI18n('de')).filter(([, sentence]) =>
            wordsOf(sentence).some((word) => INFORMAL.has(word)),
        );
        expect(informal.map(([key]) => key)).toEqual([]);
    });

    test('are read, so a catalogue with nothing in it does not pass', () => {
        expect(sentencesOf(defaultTenantPlanSectionI18n('de')).length).toBeGreaterThan(100);
    });
});
