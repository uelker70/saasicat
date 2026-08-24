// `@saasicat/ui-vue-tenant` renders in somebody else's application.
//
// ADR 0010: these components are a guest, and a guest does not bring a
// framework. The decision is only worth as much as what holds it, and prose
// held it for exactly as long as it took someone to write the next `q-btn`
// beside the seventeen hand-written buttons.
//
// Three sources answer the question, and none of them is a list:
//
//   1. the package manifest — `quasar` may not appear in any dependency field
//   2. the package's own source — no import of it, and no `<q-*>` element
//   3. Quasar's OWN stylesheet — no class it defines may be written here
//
// The third is the one a prefix check misses. `q-mb-md`, `q-ml-sm`, `q-mr-sm`,
// `q-mr-xs`, `q-mt-lg`, `q-mt-md`, `q-pt-none` and `text-h6` were in this
// package's markup when the migration started; they render as nothing at all
// without Quasar's stylesheet, and only the last of them would survive a rule
// that looked for a `q-` prefix. Asking Quasar what Quasar defines needs no
// list and stays right when Quasar adds a class.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGE = join(ROOT, 'packages', 'ui-vue-tenant');
const SRC = join(PACKAGE, 'src');

/** Every `.vue` and `.ts` under the package's source tree. */
function sourceFiles(dir = SRC, found = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, found);
        else if (/\.(vue|ts)$/.test(entry.name)) found.push(full);
    }
    return found;
}

/**
 * The `<template>` half of an SFC.
 *
 * Scripts and styles are excluded so that a comment ABOUT a Quasar component —
 * of which this package now has several, explaining what it replaced — is not
 * mistaken for one.
 */
function templateOf(text) {
    const open = text.indexOf('<template>');
    if (open === -1) return '';
    const close = text.lastIndexOf('</template>');
    return close === -1 ? '' : text.slice(open, close);
}

/**
 * Element names in a template, both spellings Vue accepts.
 *
 * Scanned by index rather than matched by pattern: a tag name is a run of name
 * characters after a `<`, and that is one forward walk with no way for the same
 * input to be divided twice.
 */
function elementNames(template) {
    const names = [];
    for (let at = template.indexOf('<'); at !== -1; at = template.indexOf('<', at + 1)) {
        let end = at + 1;
        while (end < template.length && /[\w-]/.test(template[end])) end++;
        const name = template.slice(at + 1, end);
        if (name) names.push(name);
    }
    return names;
}

/** `QDialog` → `q-dialog`; a name already kebab comes back unchanged. */
function kebabCase(name) {
    let out = '';
    for (const [index, character] of [...name].entries()) {
        const lower = character.toLowerCase();
        if (character !== lower && index > 0) out += '-';
        out += lower;
    }
    return out;
}

/**
 * The classes a template writes.
 *
 * Static `class="a b"` contributes every word; a bound `:class` contributes the
 * quoted strings inside its expression, which is where a conditional class is
 * spelled. What it cannot see is a name a component composes at runtime — and
 * this package composes none from a framework prefix, which is what the
 * assertion below is about.
 */
function writtenClasses(template) {
    const classes = new Set();
    for (let at = template.indexOf('class='); at !== -1; at = template.indexOf('class=', at + 1)) {
        const bound = template[at - 1] === ':' || template.slice(0, at).endsWith('v-bind:');
        const quote = template.indexOf('"', at);
        if (quote === -1) continue;
        const close = template.indexOf('"', quote + 1);
        if (close === -1) continue;
        const value = template.slice(quote + 1, close);
        if (!bound) {
            for (const word of value.split(/\s+/)) if (word) classes.add(word);
            continue;
        }
        // Inside an expression, only string literals are class names; the rest
        // is JavaScript.
        for (let from = value.indexOf("'"); from !== -1; from = value.indexOf("'", from + 1)) {
            const end = value.indexOf("'", from + 1);
            if (end === -1) break;
            for (const word of value.slice(from + 1, end).split(/\s+/)) if (word) classes.add(word);
            from = end;
        }
    }
    return classes;
}

/**
 * The module specifiers a file imports.
 *
 * Every quoted string whose preceding word is `from` or `import` — which covers
 * the bare side-effect form as well. A counter-check found that gap: the first
 * version of this test asked for `from 'quasar'`, and `import 'quasar';` — the
 * exact shape that pulls in a stylesheet or a plugin — walked past it.
 *
 * Walking back from the quote rather than matching a pattern forwards, so a
 * comment that names the package in prose (this file's subject has several)
 * is not read as an import.
 */
function moduleSpecifiers(text) {
    const specifiers = [];
    for (let at = 0; at < text.length; at++) {
        const quote = text[at];
        if (quote !== "'" && quote !== '"') continue;
        const end = text.indexOf(quote, at + 1);
        if (end === -1) break;

        let before = at - 1;
        while (before >= 0 && (text[before] === ' ' || text[before] === '(')) before--;
        let wordEnd = before + 1;
        while (before >= 0 && /[\w]/.test(text[before])) before--;
        const word = text.slice(before + 1, wordEnd);
        if (word === 'from' || word === 'import') specifiers.push(text.slice(at + 1, end));
        at = end;
    }
    return specifiers;
}

/** The class names a stylesheet defines — selector text only. */
function definedClasses(css) {
    const names = new Set();
    for (const block of css.split('}')) {
        const brace = block.indexOf('{');
        const head = block.slice(0, brace === -1 ? block.length : brace);
        for (let at = head.indexOf('.'); at !== -1; at = head.indexOf('.', at + 1)) {
            let end = at + 1;
            while (end < head.length && /[\w-]/.test(head[end])) end++;
            const name = head.slice(at + 1, end);
            if (name && !/^\d/.test(name[0])) names.add(name);
        }
    }
    return names;
}

/**
 * Quasar's stylesheet, resolved from the package that still depends on it.
 *
 * Resolved rather than pathed, and a failure to find it fails the test: a check
 * whose subject went missing has to say so, not pass because it compared
 * against an empty set.
 */
function quasarClasses() {
    const require = createRequire(join(ROOT, 'packages', 'ui-vue', 'package.json'));
    const stylesheet = require.resolve('quasar/dist/quasar.css');
    assert.ok(existsSync(stylesheet), `Quasar stylesheet not found at ${stylesheet}`);
    return definedClasses(readFileSync(stylesheet, 'utf8'));
}

describe('the tenant package needs no Quasar', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
    const files = sourceFiles();

    test('there is a source tree to judge', () => {
        // Everything below is a set difference, and a moved directory would
        // satisfy all of them by having nothing to compare.
        assert.ok(files.length >= 20, `only ${files.length} source files found`);
    });

    test('no dependency field names it', () => {
        const fields = Object.keys(manifest).filter((key) => key.endsWith('ependencies'));
        const naming = fields.filter((field) => 'quasar' in (manifest[field] ?? {}));
        assert.deepEqual(
            naming,
            [],
            `ADR 0010 removed this requirement. Found \`quasar\` in: ${naming.join(', ')}`,
        );
    });

    test('the keywords do not advertise it', () => {
        // A keyword is what someone searching npm reads before the README.
        assert.ok(!(manifest.keywords ?? []).includes('quasar'));
    });

    test('nothing in the source imports it', () => {
        const found = [];
        for (const file of files) {
            for (const specifier of moduleSpecifiers(readFileSync(file, 'utf8'))) {
                if (specifier === 'quasar' || specifier.startsWith('quasar/')) {
                    found.push(`${relative(ROOT, file)}: ${specifier}`);
                } else if (specifier.endsWith('/quasar')) {
                    // `@saasicat/ui-vue/quasar` is the admin's bootstrap entry.
                    // Reaching it from here would pull the framework in through
                    // the side door, with the manifest still saying nothing.
                    found.push(`${relative(ROOT, file)}: ${specifier}`);
                }
            }
        }
        assert.deepEqual(found, []);
    });

    test('no template writes a Quasar component', () => {
        const found = [];
        for (const file of files.filter((f) => f.endsWith('.vue'))) {
            const template = templateOf(readFileSync(file, 'utf8'));
            for (const name of elementNames(template)) {
                if (kebabCase(name).startsWith('q-'))
                    found.push(`${relative(ROOT, file)}: <${name}>`);
            }
        }
        assert.deepEqual(
            found,
            [],
            "Write a plain element or one of this package's own primitives in `src/ui/`.",
        );
    });

    test('no template writes a class Quasar defines', () => {
        const quasar = quasarClasses();
        assert.ok(quasar.size > 500, `only ${quasar.size} classes read from Quasar's stylesheet`);

        const found = [];
        for (const file of files.filter((f) => f.endsWith('.vue'))) {
            const template = templateOf(readFileSync(file, 'utf8'));
            for (const name of writtenClasses(template)) {
                if (quasar.has(name)) found.push(`${relative(ROOT, file)}: .${name}`);
            }
        }
        assert.deepEqual(
            found,
            [],
            "These render as nothing without Quasar's stylesheet, which this package " +
                'no longer asks anyone to load. Use a token from the theme instead.',
        );
    });
});
