// Every class a stylesheet defines is written somewhere that renders.
//
// Dead CSS is quiet: the rule stays, the class it names is gone from the
// markup, and the next reader assumes the styling still matters. Three such
// families were found by hand while moving one page under its line budget —
// 49 lines for four classes no template had used since some earlier refactor.
// By hand is the wrong instrument for that.
//
// The check is a set difference: names that appear in selector text, minus
// names that appear anywhere a class can be written — a template, a script, a
// document. It cannot see through a name a component composes at runtime, and
// it does not try: three derivations below name the cases where the class is
// real and the writing of it is not literal. Each derives from the sources
// (the framework's prefix, the template's own interpolation, the transition's
// declared name) rather than listing files.
//
// One consequence is deliberate: a class meant for a CONSUMER to write — the
// theme has a few — is invisible to this check unless the repository writes it
// too. `docs/` is searched for exactly that reason, and it is the right price:
// a class nobody here uses and nothing documents cannot be told apart from one
// that was left behind, and the reader who finds it cannot either.

// @requirement SC-READ-008 — There is one way to do each thing, not two right answers

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SEARCHED = ['packages', 'examples', 'docs'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', 'test-results']);

/** Quasar writes its own classes at runtime; the theme only styles them. */
const FRAMEWORK_PREFIX = 'q-';

function filesUnder(dir, found = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) filesUnder(full, found);
        else found.push(full);
    }
    return found;
}

/** The `<style>` blocks of an SFC, or the whole file for a stylesheet. */
function styleOf(file, text) {
    if (file.endsWith('.css')) return text;
    let css = '';
    let at = text.indexOf('<style');
    while (at !== -1) {
        const open = text.indexOf('>', at);
        const close = text.indexOf('</style>', open);
        if (open === -1 || close === -1) break;
        css += `${text.slice(open + 1, close)}\n`;
        at = text.indexOf('<style', close);
    }
    return css;
}

/**
 * Everything except stylesheet text.
 *
 * A `.css` file contributes nothing: its whole content is selectors, so
 * counting it as writing would let every stylesheet vouch for itself. That is
 * not theoretical — it made the check vacuous for the 14 standalone
 * stylesheets, which are the theme, and it hid two orphans in
 * `pilot-dialog.css` while reporting 25 in SFCs.
 */
function markupOf(file, text) {
    if (file.endsWith('.css')) return '';
    if (!file.endsWith('.vue')) return text;
    let kept = '';
    let from = 0;
    let at = text.indexOf('<style');
    while (at !== -1) {
        const close = text.indexOf('</style>', at);
        if (close === -1) break;
        kept += text.slice(from, at);
        from = close + '</style>'.length;
        at = text.indexOf('<style', from);
    }
    return kept + text.slice(from);
}

/**
 * The class names a stylesheet defines.
 *
 * Selector text only — the part before each `{` — so a `.foo` inside a string
 * or a `content:` declaration is not mistaken for a definition.
 */
function definedClasses(css) {
    const names = new Set();
    for (const block of stripComments(css).split('}')) {
        const head = block.slice(0, block.indexOf('{') === -1 ? block.length : block.indexOf('{'));
        let at = head.indexOf('.');
        while (at !== -1) {
            let end = at + 1;
            while (end < head.length && isNameChar(head[end])) end++;
            const name = head.slice(at + 1, end);
            if (name && !isDigit(name[0])) names.add(name);
            at = head.indexOf('.', end);
        }
    }
    return names;
}

function stripComments(css) {
    let out = '';
    let from = 0;
    let at = css.indexOf('/*');
    while (at !== -1) {
        const close = css.indexOf('*/', at + 2);
        if (close === -1) break;
        out += css.slice(from, at);
        from = close + 2;
        at = css.indexOf('/*', from);
    }
    return out + css.slice(from);
}

const isNameChar = (char) => /[\w-]/.test(char);
const isDigit = (char) => char >= '0' && char <= '9';

/** Every `[\w-]+` run in a text, which is every way a class can be written. */
function tokensOf(text) {
    const tokens = new Set();
    let start = -1;
    for (let i = 0; i <= text.length; i++) {
        if (i < text.length && isNameChar(text[i])) {
            if (start === -1) start = i;
            continue;
        }
        if (start !== -1) {
            tokens.add(text.slice(start, i));
            start = -1;
        }
    }
    return tokens;
}

/**
 * The literal head of a class a template interpolates —
 * `` `sa-accordion__mark--${markTone}` `` contributes `sa-accordion__mark--`.
 */
function composedPrefixes(text) {
    const prefixes = new Set();
    let at = text.indexOf('${');
    while (at !== -1) {
        let start = at;
        while (start > 0 && isNameChar(text[start - 1])) start--;
        const prefix = text.slice(start, at);
        if (prefix.length > 2) prefixes.add(prefix);
        at = text.indexOf('${', at + 2);
    }
    return prefixes;
}

/** `<transition name="x">` styles `x-enter-active` and its five siblings. */
function transitionPrefixes(text) {
    const prefixes = new Set();
    for (const tag of ['<transition', '<Transition']) {
        let at = text.indexOf(tag);
        while (at !== -1) {
            const end = text.indexOf('>', at);
            const attribute = text.slice(at, end === -1 ? text.length : end);
            const marker = attribute.indexOf('name="');
            if (marker !== -1) {
                const from = marker + 'name="'.length;
                const close = attribute.indexOf('"', from);
                if (close !== -1) prefixes.add(`${attribute.slice(from, close)}-`);
            }
            at = text.indexOf(tag, at + tag.length);
        }
    }
    return prefixes;
}

describe('CSS classes have a user', () => {
    test('no stylesheet defines a class nothing writes', () => {
        const files = SEARCHED.flatMap((dir) => filesUnder(join(ROOT, dir)));
        const readable = files.filter((f) => /\.(vue|css|ts|js|mjs|cjs|html|md)$/.test(f));

        const written = new Set();
        const prefixes = new Set();
        const defined = new Map();

        for (const file of readable) {
            const text = readFileSync(file, 'utf8');
            const markup = markupOf(file, text);
            for (const token of tokensOf(markup)) written.add(token);
            for (const prefix of composedPrefixes(markup)) prefixes.add(prefix);
            for (const prefix of transitionPrefixes(markup)) prefixes.add(prefix);

            const css = styleOf(file, text);
            if (!css.trim()) continue;
            for (const name of definedClasses(css)) {
                if (!defined.has(name)) defined.set(name, relative(ROOT, file));
            }
        }

        const orphaned = [...defined]
            .filter(([name]) => !name.startsWith(FRAMEWORK_PREFIX))
            .filter(([name]) => !written.has(name))
            .filter(([name]) => ![...prefixes].some((prefix) => name.startsWith(prefix)))
            .map(([name, file]) => `${file}: .${name}`)
            .sort();

        assert.deepEqual(
            orphaned,
            [],
            `Stylesheets define classes no markup writes:\n  ${orphaned.join('\n  ')}`,
        );
    });
});
