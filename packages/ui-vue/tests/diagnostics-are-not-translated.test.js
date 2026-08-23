// Guard: a diagnostic is not a translated sentence.
//
// `markPlatformError` says one thing about a class — its `message` is for the
// log, not for a screen — and `toAdminError` acts on it by dropping that
// message rather than showing it. Five throw sites built theirs through the
// i18n layer instead, so the promise was false twice over: the text was meant
// for a person (and reached one, on the discovery page, which rendered
// `error.message` verbatim), and it came out in the operator's language, which
// for `DEFAULT_SA_LOCALE` means a German string in a repository whose rule is
// that everything developer-facing is English.
//
// No literal scan finds that: the German is produced at runtime by
// `formatMessage(msg.value.…)`, and the source line contains nothing but
// identifiers. So the scan follows the identifiers instead — which symbols a
// file imported from the i18n layer, and which local names it bound to them.
// Both sets are read from the file, so a new i18n helper or a renamed local is
// covered without anybody editing this test.
//
// The behavioural half is in `use-discovery.test.js` and
// `admin-error.test.js`: same diagnostic in both locales, and the sentence a
// user sees coming from the catalog.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(__dirname, '..', 'src');

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) yield* walk(full);
        else if (entry.endsWith('.ts')) yield full;
    }
}

const sources = [...walk(SRC)].map((file) => ({
    path: relative(SRC, file),
    text: readFileSync(file, 'utf8'),
}));

/** 1-based line the offset falls on. */
function lineAt(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

/** Every error class the package declares, by name. */
function declaredErrorClassNames() {
    const names = new Set();
    for (const { text } of sources) {
        for (const match of text.matchAll(/(?:export )?class (\w+) extends Error\b/g)) {
            names.add(match[1]);
        }
    }
    return names;
}

/**
 * The names in one file that stand for translated text.
 *
 * Derived from the file itself, in the two ways such a name can arrive:
 * imported from somewhere under `i18n/` (`formatMessage`, `useSaMessages`, a
 * catalog), or bound to the result of one of those imports
 * (`const msg = useSaMessages('promos')`).
 */
function i18nNamesIn(text) {
    const names = new Set();
    for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']*i18n[^']*)'/g)) {
        for (const part of match[1].split(',')) {
            const name = part
                .replace(/^\s*type\s+/, '')
                .trim()
                .split(/(?<!\s)\s+as\s+/)
                .pop();
            if (name) names.add(name);
        }
    }
    // `useSaMessages` lives in the Vue layer but hands out catalog entries, so
    // it counts as an i18n import wherever it comes from.
    if (/\buseSaMessages\b/.test(text)) names.add('useSaMessages');
    if (/\buseSuperAdminI18n\b/.test(text)) names.add('useSuperAdminI18n');

    // One pass is enough for the shapes in this package (`const msg =
    // useSaMessages('x')`); a binding of a binding would need another, and the
    // day one appears this loop is where it goes.
    for (const match of text.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(\w+)\s*\(/g)) {
        if (names.has(match[2])) names.add(match[1]);
    }
    return names;
}

/** Balanced-parenthesis slice starting at the `(` that follows `start`. */
function argumentsAt(text, start) {
    const open = text.indexOf('(', start);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') {
            depth -= 1;
            if (depth === 0) return text.slice(open + 1, i);
        }
    }
    return text.slice(open + 1);
}

/** Whether `text` contains `name` bounded by non-identifier characters — `(?<![\w$])name(?![\w$])`, without building a pattern. */
function mentionsIdentifier(text, name) {
    for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
        const before = text[at - 1] ?? '';
        const after = text[at + name.length] ?? '';
        if (!/[\w$]/.test(before) && !/[\w$]/.test(after)) return true;
    }
    return false;
}

describe('the diagnostics this package brands are not translated', () => {
    const classNames = declaredErrorClassNames();

    test('the error classes are discoverable — otherwise nothing below looks at anything', () => {
        assert.ok(classNames.size > 0, 'no error class found — the scan stopped matching');
    });

    test('no construction of one takes its message from the catalog', () => {
        // Any construction; whether it is one of ours is asked of the name.
        const construction = /new ([A-Za-z_$][\w$]*)\s*\(/g;
        const offenders = [];
        let found = 0;

        for (const { path, text } of sources) {
            const i18nNames = i18nNamesIn(text);
            if (i18nNames.size === 0) continue;
            for (const match of text.matchAll(construction)) {
                if (!classNames.has(match[1])) continue;
                found += 1;
                const args = argumentsAt(text, match.index);
                const used = [...i18nNames].filter((name) => mentionsIdentifier(args, name));
                if (used.length > 0) {
                    offenders.push(`${path}:${lineAt(text, match.index)} — via ${used.join(', ')}`);
                }
            }
        }

        assert.ok(found > 0, 'no error construction found in a file that uses i18n at all');
        assert.deepEqual(
            offenders,
            [],
            "A branded error's `message` is a diagnostic for the log: English, and the same " +
                'in every locale. The sentence for the screen comes from the `errors` catalog ' +
                'through `adminErrorMessage`:\n  ' +
                offenders.join('\n  '),
        );
    });
});
