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
// is a hit and not a judgement call.
//
// **It is a floor, not a sweep, and that is worth saying plainly** — a guard
// read as complete is worse than one read as partial. The list is finite, so a
// German sentence built from words that are not on it passes; a sweep of the
// repository with three independent detectors found the entries added at the
// bottom of the list, and there is no reason to believe a fourth would find
// none. What it does hold is that a document written in German trips several
// entries in its first paragraph, and one is enough to fail.
//
// What it still cannot see, said out loud rather than implied: German built
// from words that are not on the list. A sweep with three independent
// detectors — a lexicon, German orthography, and every long token absent from
// an English dictionary — is what produced the second half of the list, and
// there is no reason to think a fourth pass would find nothing.
//
// Three exclusions, each for a reason that would otherwise make the guard
// wrong rather than merely noisy:
//
//   - the translation catalogues, which are German on purpose. They declare it
//     in their own first lines with `translation-catalogue`, so this file
//     carries no list of them and a new catalogue is covered on the day it is
//     written — and the declaration exempts **what is inside the quotes only**.
//     A catalogue is mostly not translations: `default-i18n.ts` is 750 lines of
//     which the German is the values, and its 46 comment lines are English like
//     everything else. A whole-file skip would have made those permanently
//     invisible, so comments and identifiers there are read like anywhere.
//     A release note that renames a German identifier declares
//     `language-history` for the same reason `one-spelling.test.js` has
//     `naming-history`: the old name is what makes the note usable, and a
//     migration instruction that cannot name what it renames is not one. That
//     one is whole-file, and it is confined to Markdown so no source file can
//     claim it.
//   - the test tree. Its fixtures are the data of a German installation —
//     plan taglines, tenant names, the sentence a refusal shows a customer —
//     and that is the product's default locale, not a language mistake. What
//     `RULES.md` asks of a test is that its *name* is English, and that is not
//     what this measures.
//   - `handoff/` is not in the tree at all (gitignored), and `CHANGELOG.md` and
//     the lock file are history or tool-owned. A pending changeset is neither:
//     Changesets copies its summary into the changelog on release, and
//     `SC-LANG-011` names release notes, so `.changeset/*.md` is scanned like
//     anything else that ships.

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

    // Words from the product's own screens, added after a sweep found them in
    // shipped comments, in the example app and in a worked example in the
    // guides — the places a stranger reads first.
    'aktiv',
    'aktive',
    'aktuell',
    'allgemein',
    'anfrage',
    'angelegt',
    'auswertung',
    'bearbeiten',
    'beliebt',
    'benutzer',
    'daten',
    'dokument',
    'empfohlen',
    'exportieren',
    'gültig',
    'hochladen',
    'kunden',
    'mandant',
    'mandanten',
    'mitglieder',
    'monat',
    'neu',
    'paket',
    'preise',
    'produktkatalog',
    'rabatt',
    'speichern',
    'stammdaten',
    'verbrauch',
    'vorgänger',
    'weiter',
    'zurück',
    'übersicht',
];

const GERMAN = new Set(GERMAN_WORDS);

/** One quantifier over a class that excludes its own separator — nothing to backtrack. */
const NOT_A_LETTER = /[^\p{L}]+/u;

/**
 * What carries prose somebody reads, which is wider than "source".
 *
 * `.yaml` is here because `@saasicat/spec` ships `admin-api.openapi.yaml` and
 * calls it normative; `.json` because the four JSON Schemas hold 68
 * `description` strings that are the field-by-field documentation of the
 * platform contract, and because a `package.json` description is what npm
 * shows. The example's operational files are here for the plainest reason of
 * all: they are the first thing anybody runs.
 */
const SHIPPED =
    /\.(ts|mts|cts|js|mjs|cjs|vue|md|prisma|sql|css|scss|html|tpl|ya?ml|jsonc?|sh|conf|example)$/;

/** Shipped files a stranger reads that carry no extension at all. */
const SHIPPED_BY_NAME = new Set(['Dockerfile', 'Makefile']);
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
const DECLARATION_WINDOW = 20;

function declares(text, marker) {
    return text.split('\n', DECLARATION_WINDOW).join('\n').includes(marker);
}

/** Whether a file's German string values are deliberate — its comments are not covered. */
export function declaresTranslationCatalogue(text) {
    return declares(text, 'translation-catalogue');
}

/**
 * Whether a Markdown file declares that it names German it is removing.
 *
 * Markdown only, so that a source file cannot claim it: a release note's German
 * is prose a reader has to see, and no quoting rule separates it from the note
 * around it.
 */
export function declaresLanguageHistory(path, text) {
    return path.endsWith('.md') && declares(text, 'language-history');
}

/** A line that is nothing but comment — read whole, quotes and all. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|<!--)/;

/**
 * A line with its quoted spans blanked out.
 *
 * What a translation catalogue is allowed to hold in German is its *values*.
 * Scanned rather than matched: a pattern for "everything between two quotes"
 * puts two quantifiers side by side that can each claim the same characters,
 * which `regexp/no-super-linear-backtracking` refuses. One pass over the
 * characters has none of that, and it is the only way to get escaping right.
 *
 * A comment line is handed back untouched. An apostrophe in English prose —
 * "don't", "the operator's" — opens a span this scanner would carry to the end
 * of the line, and a comment is exactly where German would hide.
 */
export function outsideQuotes(line) {
    if (COMMENT_LINE.test(line)) return line;
    let out = '';
    let quote = null;
    for (let at = 0; at < line.length; at++) {
        const char = line[at];
        if (quote) {
            if (char === '\\') at++;
            else if (char === quote) quote = null;
            continue;
        }
        if (char === "'" || char === '"' || char === '`') {
            quote = char;
            continue;
        }
        out += char;
    }
    return out;
}

/** Whether a repository-relative path is something a stranger reads. */
export function isShipped(path) {
    const name = path.split('/').at(-1);
    if (!SHIPPED.test(path) && !SHIPPED_BY_NAME.has(name.split('.')[0])) return false;
    // The changeset config, not a release note.
    if (path.startsWith('.changeset/') && !path.endsWith('.md')) return false;
    if (path.endsWith('CHANGELOG.md')) return false;
    // Tool-owned: nobody writes it, and it is now inside the extension list.
    if (name === 'pnpm-lock.yaml') return false;
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
            if (declaresLanguageHistory(path, text)) continue;
            const read = declaresTranslationCatalogue(text)
                ? text.split('\n').map(outsideQuotes).join('\n')
                : text;
            for (const { line, word } of germanIn(read))
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

    test('a catalogue declares itself, and only in its head', () => {
        assert.equal(declaresTranslationCatalogue('// translation-catalogue\nconst a = 1;'), true);
        assert.equal(declaresTranslationCatalogue('const a = 1;'), false);
        // Beyond the window is not a declaration: it has to be where a reader
        // of the first screen sees it.
        assert.equal(
            declaresTranslationCatalogue(`${'\n'.repeat(40)}// translation-catalogue`),
            false,
        );
    });

    test('a catalogue is exempt in its values and read everywhere else', () => {
        assert.equal(outsideQuotes("const a = 'nicht';"), 'const a = ;');
        assert.equal(outsideQuotes('// nicht'), '// nicht');
        // A comment is read whole: an apostrophe in English prose would
        // otherwise open a span that runs to the end of the line.
        assert.equal(outsideQuotes("// the operator's nicht"), "// the operator's nicht");
        assert.equal(outsideQuotes(' * und'), ' * und');
        assert.equal(outsideQuotes('save: `wird`, // und'), 'save: , // und');
        // An escaped quote does not end the span it stands in.
        assert.equal(outsideQuotes("x: 'a\\'nicht', y"), 'x: , y');
    });

    test('only Markdown may declare that it names the German it removes', () => {
        const note = '<!-- language-history -->\ntext';
        assert.equal(declaresLanguageHistory('.changeset/a.md', note), true);
        assert.equal(declaresLanguageHistory('packages/core/src/a.ts', note), false);
        assert.equal(declaresLanguageHistory('.changeset/a.md', 'text'), false);
    });

    test('the test tree and the published history are out of scope, the rest is in', () => {
        assert.equal(isShipped('packages/core/src/error-codes.ts'), true);
        assert.equal(isShipped('packages/spec/cli-conventions.md'), true);
        assert.equal(isShipped('docs/explanation/concepts.md'), true);
        // The contract, the schemas, and what an integrator runs first.
        assert.equal(isShipped('packages/spec/admin-api.openapi.yaml'), true);
        assert.equal(isShipped('packages/spec/schemas/plan-catalog.schema.json'), true);
        assert.equal(isShipped('examples/notesapp/config/saas.yaml'), true);
        assert.equal(isShipped('examples/notesapp/docker-entrypoint.sh'), true);
        assert.equal(isShipped('examples/notesapp/.env.example'), true);
        assert.equal(isShipped('examples/notesapp/Dockerfile'), true);
        assert.equal(isShipped('examples/notesapp/web/Dockerfile.dev'), true);
        assert.equal(isShipped('examples/notesapp/web/nginx.conf'), true);
        assert.equal(isShipped('packages/nest/tests/version-diff.test.js'), false);
        assert.equal(isShipped('packages/nest/tests/helpers/subscription-fixtures.js'), false);
        // A pending changeset is a release note and is read as one.
        assert.equal(isShipped('.changeset/one-name-per-thing.md'), true);
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
