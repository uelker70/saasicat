import { describe, expect, test } from 'vitest';

import { defaultTenantPlanSectionI18n } from '../../src/default-i18n';

// The tenant's screens speak to a business — the person who books a plan or
// files its invoices — and the German catalogue says "Sie" throughout. One
// sentence in "du" beside the rest reads as two products. The sentences are
// read off the catalogue itself, so a new key is held to it the moment it
// exists.
//
// "du" shows in two ways: in a pronoun ("dein Paket", "melde dich") and in
// the verb alone, as an imperative ("Bitte lade es neu", "Pausiere ihn"),
// where the formal form names "Sie" after the verb. Three rules find them:
// an informal pronoun; "Bitte" before a verb ending in -e, as the formal
// request after it is an infinitive ("Bitte laden Sie"); and a verb ending
// in -e that opens a clause before an object or an adverb ("Beende zuerst",
// "und lege diese still"). They read grammar,
// not a list of sentences. What they cannot tell from a noun without a
// dictionary is not caught: an imperative followed straight by a name or
// code ("Implementiere PlanRepository.terminate") and one whose form has no
// -e ("verwirf", "gib"). Those were reworded when the rules were written, and
// a sentence of that shape stays a reviewer's to see.

/** The words that address the reader informally, in every form a sentence takes. */
const INFORMAL_PRONOUNS = new Set([
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

/**
 * Words ending in -e that open a clause without being a verb: articles,
 * pronouns, conjunctions, prepositions and auxiliaries — a closed class.
 */
const FUNCTION_WORDS = new Set([
    'die',
    'diese',
    'eine',
    'keine',
    'jede',
    'ihre',
    'seine',
    'meine',
    'alle',
    'beide',
    'welche',
    'solche',
    'ohne',
    'solange',
    'wie',
    'würde',
    'wurde',
    'werde',
    'wäre',
    'habe',
    'heute',
    'gerade',
    'gerne',
]);

/** What an imperative opens on: an object or an adverb, again a closed class. */
const AFTER_AN_IMPERATIVE = new Set([
    'ihn',
    'sie',
    'es',
    'den',
    'die',
    'das',
    'dem',
    'der',
    'diese',
    'dieses',
    'diesen',
    'ein',
    'eine',
    'einen',
    'zuerst',
    'stattdessen',
    'erneut',
    'noch',
]);

/** Every sentence of the catalogue, by the key it stands under. */
function sentencesOf(value: unknown, key = ''): Array<[string, string]> {
    if (typeof value === 'string') return [[key, value]];
    if (typeof value !== 'object' || value === null) return [];
    return Object.entries(value).flatMap(([name, inner]) =>
        sentencesOf(inner, key ? `${key}.${name}` : name),
    );
}

/** `text` without the parts between `open` and `close`, each a space. */
function without(text: string, open: string, close: string): string {
    const parts = text.split(open);
    return parts
        .map((part, index) => (index === 0 ? part : part.slice(part.indexOf(close) + 1)))
        .join(' ');
}

/**
 * The clauses of a sentence, each as its words in lower case; a placeholder
 * and a code span are no words of it.
 */
function clausesOf(sentence: string): string[][] {
    const plain = without(without(sentence, '{', '}'), '`', '`');
    return plain
        .split(/[.!?;:,()—–]/)
        .map((clause) =>
            clause
                .toLowerCase()
                .split(/[^a-zäöüß]+/)
                .filter((word) => word !== ''),
        )
        .filter((words) => words.length > 0);
}

/** Whether a clause addresses the reader informally, by any of the three rules. */
function isInformal(words: string[]): boolean {
    if (words.some((word) => INFORMAL_PRONOUNS.has(word))) return true;
    const opens = [
        0,
        ...words.flatMap((word, at) => (word === 'und' || word === 'oder' ? [at + 1] : [])),
    ];
    return words.some((word, at) => {
        const next = words[at + 1] ?? '';
        // A formal request after "Bitte" is an infinitive, which never ends in -e.
        if (word === 'bitte') return next.endsWith('e');
        return (
            opens.includes(at) &&
            word.length > 2 &&
            word.endsWith('e') &&
            !FUNCTION_WORDS.has(word) &&
            AFTER_AN_IMPERATIVE.has(next)
        );
    });
}

function informalKeysOf(catalogue: unknown): string[] {
    return sentencesOf(catalogue)
        .filter(([, sentence]) => clausesOf(sentence).some(isInformal))
        .map(([key]) => key);
}

describe('the German texts of the tenant’s screens', () => {
    test('address the reader as "Sie", in every sentence', () => {
        expect(informalKeysOf(defaultTenantPlanSectionI18n('de'))).toEqual([]);
    });

    test('are read, so a catalogue with nothing in it does not pass', () => {
        expect(sentencesOf(defaultTenantPlanSectionI18n('de')).length).toBeGreaterThan(100);
    });

    for (const [form, sentence] of [
        ['a pronoun', 'Bitte melde dich bei uns.'],
        ['an imperative after "Bitte"', 'Bitte lade es neu.'],
        ['an imperative after "Bitte" before "sie"', 'Bitte prüfe sie erneut.'],
        ['an imperative opening a sentence', 'Pausiere ihn stattdessen.'],
        ['an imperative after "und"', 'Veröffentlichen Sie die Version, und lege diese still.'],
    ] as const) {
        test(`find "du" in ${form}`, () => {
            expect(informalKeysOf({ sentence })).toEqual(['sentence']);
        });
    }

    for (const sentence of [
        'Bitte laden Sie es neu.',
        'Pausieren Sie ihn stattdessen.',
        'Bitte zuerst die Nutzung reduzieren.',
        'Die Kündigung hat sich geändert.',
        'Ohne ihn wird nichts vereinbart.',
        'Lade …',
    ]) {
        test(`leave "${sentence}" alone`, () => {
            expect(informalKeysOf({ sentence })).toEqual([]);
        });
    }
});
