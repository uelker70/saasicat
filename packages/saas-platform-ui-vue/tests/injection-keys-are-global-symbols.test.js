// Guard: every Vue injection key this package declares is created with
// `Symbol.for`, never with a plain `Symbol()`.
//
// `@saasicat/ui-vue` is loaded twice on purpose. A consumer app imports
// `createSuperAdminApp` — and with it every `app.provide(KEY, …)` — from the
// built `dist/` bundle, while the shared pages under `pages-standard/` ship as
// source and are imported from `src/`. Those are two module instances. A key
// declared as `Symbol('…')` is a different symbol in each of them: `provide`
// writes one, `inject` reads the other, and the page fails at runtime with
// "injection not found" while every line involved still reads correctly.
// `Symbol.for` goes through the process-wide registry, so both copies land on
// the same symbol. The long form is in `CONTRIBUTING.md` ("The `Symbol.for`
// rule for DI tokens") and above the keys in `src/vue/super-admin-context.ts`;
// this file is what makes that explanation fail a build.
//
// Nothing here is a list of key names. One set comes from the declarations,
// a second from the `provide()`/`inject()` call sites, and the two have to
// agree — so a key that drops out of one scan is reported by the other instead
// of quietly leaving the guard. The rule is applied to the union of both,
// which is what catches a key that carries no `InjectionKey` annotation at all
// and is only recognisable by being handed to `provide`.
//
// What this file cannot see:
//   - Keys declared outside this package's `src`. A `provide()` naming an
//     identifier that `src` does not declare is reported as a failure rather
//     than skipped, so such a key stops the build until someone decides what
//     it means — but the guard cannot check the other package's spelling.
//   - Runtime identity. This is a source scan. It checks how a key is written,
//     not that the loaded bundles ended up agreeing; `tests/cjs-entry-identity`
//     in `@saasicat/nest` is the test that does the latter for classes.
//   - Whether two keys accidentally share one `Symbol.for` argument, or
//     whether the argument names the right namespace.
//   - A key reached through an alias, a property (`keys.THEME`) or any
//     computed expression: the call-site reader recognises a bare identifier
//     and a string literal, and anything else fails the "every call site was
//     read" test below rather than passing unnoticed.
//   - Anything in a `.vue` file outside its `<script>` blocks, and anything
//     inside a template literal — both are blanked before the scan.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(__dirname, '..', 'src');

const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
const CLOSING_SCRIPT = '</script>';

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) yield* walk(full);
        else if (entry.endsWith('.ts') || entry.endsWith('.vue')) yield full;
    }
}

/** 1-based line the offset falls on. */
function lineAt(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

/**
 * A `.vue` file with everything outside its `<script>` blocks replaced by
 * spaces.
 *
 * Blanking rather than slicing is the point: every offset — and therefore
 * every line number this file reports — keeps pointing at the original file,
 * so a failure can be opened at the line it names.
 */
function scriptBlocksOnly(source) {
    const out = source.split('').map((char) => (char === '\n' ? '\n' : ' '));
    for (const match of source.matchAll(SCRIPT_BLOCK)) {
        const body = match[1];
        const start = match.index + match[0].length - body.length - CLOSING_SCRIPT.length;
        for (let offset = 0; offset < body.length; offset += 1) out[start + offset] = body[offset];
    }
    return out.join('');
}

/**
 * Characters after which a `/` opens a regular expression rather than dividing.
 * Applied to the significant code seen so far, so `foo / 2` and `.replace(/…/)`
 * are told apart without parsing the file.
 */
const REGEX_MAY_FOLLOW =
    /[(,=:[!&|?{};+\-*%~^<>]$|(?:return|typeof|case|in|of|do|else|yield|await|new)$/;

/**
 * Replaces comments, string bodies and regular-expression literals with
 * spaces, character for character.
 *
 * Both scans below need this. `src/vue/super-admin-context.ts` documents the
 * rule with the words `app.provide(KEY, ...)` inside a comment, and a scan that
 * cannot tell a comment from a statement would read that sentence as a call
 * site — and then report a key named `KEY` that nothing declares.
 *
 * The walk also reports where it lost its footing: a single- or double-quoted
 * string or a regular expression that reaches a newline means the opening
 * delimiter was misread, which the test below turns into a failure rather than
 * leaving the rest of that file scanned as something it is not.
 */
function scrubNonCode(source) {
    const out = source.split('');
    const anomalies = [];
    const blank = (index) => {
        if (out[index] !== '\n') out[index] = ' ';
    };

    let state = 'code';
    let quote = '';
    let inCharacterClass = false;
    let tail = '';
    let opened = 0;
    let index = 0;

    while (index < source.length) {
        const char = source[index];
        const nextChar = source[index + 1];

        if (state === 'code') {
            if (char === '/' && nextChar === '/') {
                blank(index);
                blank(index + 1);
                state = 'line-comment';
                index += 2;
            } else if (char === '/' && nextChar === '*') {
                blank(index);
                blank(index + 1);
                state = 'block-comment';
                index += 2;
            } else if (char === '/' && REGEX_MAY_FOLLOW.test(tail)) {
                blank(index);
                state = 'regex';
                inCharacterClass = false;
                opened = index;
                index += 1;
            } else if (char === "'" || char === '"' || char === '`') {
                blank(index);
                state = 'quoted';
                quote = char;
                opened = index;
                index += 1;
            } else {
                if (!/\s/.test(char)) tail = (tail + char).slice(-8);
                index += 1;
            }
            continue;
        }

        if (state === 'line-comment') {
            if (char === '\n') state = 'code';
            else blank(index);
            index += 1;
            continue;
        }

        if (state === 'block-comment') {
            if (char === '*' && nextChar === '/') {
                blank(index);
                blank(index + 1);
                state = 'code';
                index += 2;
            } else {
                blank(index);
                index += 1;
            }
            continue;
        }

        if (state === 'quoted') {
            if (char === '\\') {
                blank(index);
                blank(index + 1);
                index += 2;
            } else if (char === quote) {
                blank(index);
                // A closed string is a value, so a `/` after it divides.
                tail = (tail + 'x').slice(-8);
                state = 'code';
                index += 1;
            } else if (char === '\n' && quote !== '`') {
                anomalies.push(
                    `unterminated ${quote} string opened at line ${lineAt(source, opened)}`,
                );
                state = 'code';
                index += 1;
            } else {
                blank(index);
                index += 1;
            }
            continue;
        }

        // state === 'regex'
        if (char === '\\') {
            blank(index);
            blank(index + 1);
            index += 2;
        } else if (char === '[') {
            blank(index);
            inCharacterClass = true;
            index += 1;
        } else if (char === ']') {
            blank(index);
            inCharacterClass = false;
            index += 1;
        } else if (char === '/' && !inCharacterClass) {
            blank(index);
            tail = (tail + 'x').slice(-8);
            state = 'code';
            index += 1;
        } else if (char === '\n') {
            anomalies.push(
                `unterminated regular expression opened at line ${lineAt(source, opened)}`,
            );
            state = 'code';
            index += 1;
        } else {
            blank(index);
            index += 1;
        }
    }

    if (state !== 'code') anomalies.push(`file ends inside ${state}`);
    return { code: out.join(''), anomalies };
}

const sources = [...walk(SRC)].map((file) => {
    const text = readFileSync(file, 'utf8');
    const stripped = file.endsWith('.vue') ? scriptBlocksOnly(text) : text;
    const { code, anomalies } = scrubNonCode(stripped);
    return { path: relative(SRC, file), code, anomalies };
});

const OPENERS = '([{<';
const CLOSERS = ')]}>';

/**
 * The type annotation of a `const NAME: T = …`, read up to the `=` that starts
 * the initializer.
 *
 * Walked by bracket depth rather than matched by a regex, because the
 * annotations in this package contain their own `=`:
 * `InjectionKey<() => AdminManifest | null>` would end a lazier reader inside
 * the arrow.
 */
function readAnnotation(code, at) {
    if (code[at] !== ':') return { annotation: '', valueAt: at + 1 };
    let depth = 0;
    let index = at;
    while (index < code.length) {
        const char = code[index];
        // `=>` is one token: neither half may end the annotation or move the
        // depth, or `: () => void = …` would be read as ending at the arrow.
        if (char === '=' && code[index + 1] === '>') {
            index += 2;
            continue;
        }
        if (OPENERS.includes(char)) depth += 1;
        else if (CLOSERS.includes(char)) depth -= 1;
        else if (char === ';' && depth <= 0)
            return { annotation: code.slice(at + 1, index), valueAt: -1 };
        else if (char === '=' && depth <= 0)
            return { annotation: code.slice(at + 1, index), valueAt: index + 1 };
        index += 1;
    }
    return { annotation: '', valueAt: -1 };
}

/** The initializer of a `const … = …;`, read to the semicolon that ends it. */
function readInitializer(code, at) {
    let depth = 0;
    for (let index = at; index < code.length; index += 1) {
        const char = code[index];
        if ('([{'.includes(char)) depth += 1;
        else if (')]}'.includes(char)) depth -= 1;
        else if (char === ';' && depth <= 0) return code.slice(at, index);
    }
    return code.slice(at);
}

const BINDING = /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?=[:=])/g;

/** Every named binding with an initializer, with its annotation and its value. */
function declarations() {
    const found = [];
    for (const { path, code } of sources) {
        for (const match of code.matchAll(BINDING)) {
            const { annotation, valueAt } = readAnnotation(code, match.index + match[0].length);
            if (valueAt < 0) continue;
            found.push({
                name: match[1],
                path,
                line: lineAt(code, match.index),
                annotation,
                initializer: readInitializer(code, valueAt).trim(),
            });
        }
    }
    return found;
}

const allBindings = declarations();

const byName = new Map();
for (const binding of allBindings) {
    if (!byName.has(binding.name)) byName.set(binding.name, []);
    byName.get(binding.name).push(binding);
}

/**
 * The bindings that say they are injection keys — through the annotation
 * (`: InjectionKey<T>`) or through a cast (`… as InjectionKey<T>`). Vue accepts
 * a bare `symbol` where an `InjectionKey` is expected, so neither form is
 * required by the compiler; that is exactly why the second derivation below
 * exists.
 */
const annotatedKeys = allBindings.filter(
    ({ annotation, initializer }) =>
        /\bInjectionKey\b/.test(annotation) ||
        /\bas\s+(?:unknown\s+as\s+)?InjectionKey\b/.test(initializer),
);

const PROVIDE_OR_INJECT = /\b(?:provide|inject)\s*\(/g;
const FIRST_ARGUMENT_IDENTIFIER = /^\s*([A-Za-z_$][\w$]*)\s*[,)]/;
const FIRST_ARGUMENT_LITERAL = /^\s*['"`]/;

/** Every `provide(…)` / `inject(…)` call, with whatever its first argument is. */
function callSites() {
    const found = [];
    for (const { path, code } of sources) {
        for (const match of code.matchAll(PROVIDE_OR_INJECT)) {
            const argument = code.slice(match.index + match[0].length);
            const identifier = FIRST_ARGUMENT_IDENTIFIER.exec(argument);
            found.push({
                path,
                line: lineAt(code, match.index),
                name: identifier ? identifier[1] : null,
                // A string key is legal in Vue and simply outside this rule:
                // it has no symbol identity to split in the first place.
                literal: !identifier && FIRST_ARGUMENT_LITERAL.test(argument),
                excerpt: argument.slice(0, 40).replace(/\s+/g, ' ').trim(),
            });
        }
    }
    return found;
}

const sites = callSites();
const usedNames = new Set(sites.filter(({ name }) => name).map(({ name }) => name));

/** The rule applies to both derivations together. */
const injectionKeys = [
    ...new Map(
        [...annotatedKeys, ...[...usedNames].flatMap((name) => byName.get(name) ?? [])].map(
            (binding) => [`${binding.path}:${binding.line}:${binding.name}`, binding],
        ),
    ).values(),
];

const where = ({ path, line, name }) => `${path}:${line} — ${name}`;

describe('every Vue injection key is created with Symbol.for', () => {
    test('the sources were read to the end', () => {
        // The scans below are only worth as much as the scrub that feeds them.
        // A misread delimiter would blank real code, and blanked code is code
        // this guard silently stops looking at.
        const confused = sources
            .filter(({ anomalies }) => anomalies.length > 0)
            .map(({ path, anomalies }) => `${path}: ${anomalies.join('; ')}`);
        assert.deepEqual(
            confused,
            [],
            'The comment/string/regex scrub lost its place in these files, so everything ' +
                'after that point was scanned as the wrong kind of text:\n  ' +
                confused.join('\n  '),
        );
    });

    test('there are keys and call sites to look at', () => {
        assert.ok(
            annotatedKeys.length > 0,
            'no `InjectionKey` declaration found under src — the declaration scan stopped matching',
        );
        assert.ok(
            usedNames.size > 0,
            'no provide()/inject() call names an identifier — the call-site scan stopped matching',
        );
    });

    test('every injection key is created with Symbol.for', () => {
        const local = injectionKeys
            .filter(({ initializer }) => !/^Symbol\.for\s*\(/.test(initializer))
            .map(where);
        assert.deepEqual(
            local,
            [],
            'A Vue injection key has to be created with `Symbol.for(...)`. This package is ' +
                'loaded twice — pages from `src/`, the bootstrap from `dist/` — and a plain ' +
                '`Symbol()` is a different symbol in each copy, so `inject()` never finds what ' +
                '`provide()` wrote. See `CONTRIBUTING.md`:\n  ' +
                local.join('\n  '),
        );
    });

    test('every key a provide/inject call names is one the declaration scan found', () => {
        // This is what keeps the set above from shrinking in silence. A key
        // that loses its declaration, or whose declaration changes into a
        // shape the reader no longer parses, is still named at its call sites
        // — and turns up here instead of simply leaving the guard. Deleting a
        // key together with all of its uses is the one way it may leave, and
        // then there is nothing left to guard.
        const undeclared = [...usedNames]
            .filter((name) => !byName.has(name))
            .map((name) => {
                const site = sites.find((entry) => entry.name === name);
                return `${site.path}:${site.line} — ${name}`;
            });
        assert.deepEqual(
            undeclared,
            [],
            'These identifiers are handed to provide()/inject() but nothing under src declares ' +
                'them. Either the declaration was removed or reshaped past the reader in this ' +
                'file, or the key really comes from another package — in which case this guard ' +
                'has to be taught how to reach it, because it cannot check a spelling it never ' +
                'sees:\n  ' +
                undeclared.join('\n  '),
        );

        const annotatedNames = new Set(annotatedKeys.map(({ name }) => name));
        const unannounced = [...usedNames]
            .filter((name) => byName.has(name) && !annotatedNames.has(name))
            .flatMap((name) => byName.get(name).map(where));
        assert.deepEqual(
            unannounced,
            [],
            'These are used as injection keys but are not declared as `InjectionKey<T>`. Vue ' +
                'accepts a bare `symbol` there, so nothing else says what they are — annotate ' +
                'them, so the declaration alone carries the fact:\n  ' +
                unannounced.join('\n  '),
        );
    });

    test('every provide/inject call site was read', () => {
        // The set of used keys is only complete while every call site yields
        // one. A key passed as `keys.THEME` or through an alias would leave no
        // name behind, and the cross-check above would lose a member without
        // noticing — so an unreadable call site is a failure here.
        const unread = sites
            .filter(({ name, literal }) => !name && !literal)
            .map(({ path, line, excerpt }) => `${path}:${line} — provide/inject(${excerpt}…`);
        assert.deepEqual(
            unread,
            [],
            'The first argument of these provide()/inject() calls is neither a bare identifier ' +
                'nor a string literal, so this guard cannot tell which key they use. Pass the ' +
                'key by name:\n  ' +
                unread.join('\n  '),
        );
    });

    test('the annotated declarations survive the bracket walk', () => {
        // A second count, from a flat regex over the same text, against a
        // floor the sources set themselves: it says how many declarations
        // plainly spell out `: InjectionKey<`, and the depth-walking reader
        // above has to have found at least that many. A key gained through a
        // cast may exceed the floor — that direction adds a true statement
        // rather than losing one.
        //
        // Today this overlaps the cross-check, because every key the package
        // declares is also handed to a `provide()` or `inject()` inside `src`,
        // so losing one is reported there too. The overlap ends the moment a
        // key is declared here and used only by consumer apps: no call site in
        // `src` then misses it, and this count is the only thing left that can.
        const written = sources.reduce(
            (total, { code }) =>
                total +
                (code.match(/\bconst\s+[A-Za-z_$][\w$]*\s*:\s*InjectionKey\s*</g) ?? []).length,
            0,
        );
        assert.ok(
            annotatedKeys.length >= written,
            `${written} declarations spell out \`: InjectionKey<\` under src, but the ` +
                `declaration reader found only ${annotatedKeys.length} — it lost ` +
                `${written - annotatedKeys.length} of them`,
        );
    });
});
