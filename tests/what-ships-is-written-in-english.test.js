// @requirement SC-LANG-011 — Everything that ships is written in English

// Guard: no German in what leaves this repository.
//
// The promise is old and until now nothing measured it, so it drifted the way
// an unmeasured promise does — quietly and in the places nobody rereads. What
// this found on its first run: two comments in `PlansPage.vue` quoting a
// backend message, a German sentence in the type definitions `@saasicat/spec`
// ships to CommonJS consumers, and a CLI conventions document whose worked
// example ran `myapp paket apply` and answered `Erfordert MFA-Bestätigung`.
// Every one of them is read by somebody integrating the platform.
//
// The word list below is this file's subject, the way the retired spellings
// are the subject of `one-spelling.test.js`. There is no source to derive
// "which words are German" from, so it is written out — and it is written
// narrowly: every entry is a word that cannot occur in English prose, so a hit
// is a hit and not a judgement call. It does not have to be complete. A
// document written in German trips several of these in its first paragraph,
// and one is enough to fail.
//
// Three exclusions, each for a reason that would otherwise make the guard
// wrong rather than merely noisy:
//
//   - the translation catalogues, which are German on purpose. They declare it
//     in their own first lines with `translation-catalogue`, so this file
//     carries no list of them and a new catalogue is covered on the day it is
//     written.
//   - the test tree. Its fixtures are the data of a German installation —
//     plan taglines, tenant names, the sentence a refusal shows a customer —
//     and that is the product's default locale, not a language mistake. What
//     `RULES.md` asks of a test is that its *name* is English, and that is not
//     what this measures.
//   - `handoff/` is not in the tree at all (gitignored), and `CHANGELOG.md`,
//     `.changeset/` and the lock file are history or tool-owned.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * German words that are not also English words.
 *
 * Deliberately short of `der`, `die`, `das`, `man`, `war`, `hat`, `in` and
 * `am`: each of those is either English or a fragment of an identifier, and a
 * guard that cries wolf is turned off within a week.
 */
export const GERMAN_WORDS = [
    'aber',
    'auch',
    'bereits',
    'damit',
    'dass',
    'diese',
    'dieser',
    'durch',
    'eine',
    'einem',
    'einen',
    'für',
    'gegen',
    'gibt',
    'ihre',
    'immer',
    'jede',
    'jeder',
    'jedes',
    'kann',
    'keine',
    'keinen',
    'muss',
    'müssen',
    'nach',
    'nicht',
    'noch',
    'ohne',
    'oder',
    'schon',
    'seine',
    'sich',
    'soll',
    'sonst',
    'sowie',
    'über',
    'ungültig',
    'und',
    'vorhanden',
    'weil',
    'wenn',
    'werden',
    'wird',
    'zum',
    'zur',
    'zwischen',
];

const GERMAN = new Set(GERMAN_WORDS);

/** One quantifier over a class that excludes its own separator — nothing to backtrack. */
const NOT_A_LETTER = /[^\p{L}]+/u;

const SHIPPED = /\.(ts|mts|cts|js|mjs|cjs|vue|md|prisma|sql|css|html|tpl)$/;
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
const DECLARATION_WINDOW = 20;

/** Whether a file declares, in its head, that it is one of the German catalogues. */
export function declaresTranslationCatalogue(text) {
    return text.split('\n', DECLARATION_WINDOW).join('\n').includes('translation-catalogue');
}

/** Whether a repository-relative path is something a stranger reads. */
export function isShipped(path) {
    if (!SHIPPED.test(path)) return false;
    if (path.startsWith('.changeset/') || path.endsWith('CHANGELOG.md')) return false;
    const parts = path.split('/');
    if (parts.includes('tests') || parts.includes('node_modules')) return false;
    return !IS_TEST.test(parts.at(-1));
}

/**
 * Every German word in a piece of text, with the line it stands on.
 *
 * The words are compared as data, not through a pattern assembled from the
 * list: a regular expression built from a value is what `no-restricted-syntax`
 * refuses in this repository. Everything that is not a letter separates, so a
 * word in a comment, in quotes or at the end of a sentence is the same word,
 * and `nichts` is not `nicht`.
 */
export function germanIn(text) {
    const found = [];
    text.split('\n').forEach((line, at) => {
        for (const word of line.toLowerCase().split(NOT_A_LETTER)) {
            if (GERMAN.has(word)) found.push({ line: at + 1, word });
        }
    });
    return found;
}

const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

describe('what ships is written in English', () => {
    test('there are shipped files to look at — otherwise nothing below looks at anything', () => {
        assert.ok(tracked.filter(isShipped).length > 200);
    });

    test('none of them carries a German word', () => {
        const offenders = [];
        for (const path of tracked.filter(isShipped)) {
            const text = readFileSync(join(ROOT, path), 'utf8');
            if (declaresTranslationCatalogue(text)) continue;
            for (const { line, word } of germanIn(text))
                offenders.push(`${path}:${line} — ${word}`);
        }
        assert.deepEqual(
            offenders,
            [],
            `German in what ships:\n  ${offenders.join('\n  ')}\n` +
                'Translate it. A file that is a translation catalogue says so in its first ' +
                'lines with `translation-catalogue`.',
        );
    });

    test('a catalogue that declares itself is skipped, and one that does not is not', () => {
        assert.equal(declaresTranslationCatalogue('// translation-catalogue\nconst a = 1;'), true);
        assert.equal(declaresTranslationCatalogue('const a = 1;'), false);
        // Beyond the window is not a declaration: it has to be where a reader
        // of the first screen sees it.
        assert.equal(
            declaresTranslationCatalogue(`${'\n'.repeat(40)}// translation-catalogue`),
            false,
        );
    });

    test('the test tree and the release history are out of scope, the rest is in', () => {
        assert.equal(isShipped('packages/core/src/error-codes.ts'), true);
        assert.equal(isShipped('packages/spec/cli-conventions.md'), true);
        assert.equal(isShipped('docs/explanation/concepts.md'), true);
        assert.equal(isShipped('packages/nest/tests/version-diff.test.js'), false);
        assert.equal(isShipped('packages/nest/tests/helpers/subscription-fixtures.js'), false);
        assert.equal(isShipped('.changeset/one-name-per-thing.md'), false);
        assert.equal(isShipped('packages/core/CHANGELOG.md'), false);
        assert.equal(isShipped('pnpm-lock.yaml'), false);
    });

    test('the reader finds a German word wherever it stands, and only a whole one', () => {
        assert.deepEqual(germanIn('// wird nicht exportiert'), [
            { line: 1, word: 'wird' },
            { line: 1, word: 'nicht' },
        ]);
        assert.deepEqual(germanIn("const label = 'Für alle';"), [{ line: 1, word: 'für' }]);
        assert.deepEqual(germanIn('a\nb\n// und'), [{ line: 3, word: 'und' }]);
        // A longer word that merely starts with one is a different word.
        assert.deepEqual(germanIn('nichts undo einer'), []);
        assert.deepEqual(germanIn('// nothing to see here'), []);
    });

    test('a word that is also English is not on the list', () => {
        for (const word of ['der', 'die', 'das', 'man', 'war', 'hat', 'in', 'am', 'so', 'we']) {
            assert.ok(!GERMAN_WORDS.includes(word), `'${word}' would fire on English prose`);
        }
    });
});
