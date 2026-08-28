import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declarations, withoutComments } from '../scripts/gen-docs/design-tokens.mjs';

// A `--sa-*` role that nothing defines fails silently.
//
// CSS answers an unresolved custom property with the guaranteed-invalid value:
// the declaration around it is dropped and the element renders as if the line
// had never been written. Nothing throws, nothing logs, no build says a word.
// `var(--sa-radius-md)` stood in two of the tenant package's style blocks and
// shipped that way in 1.0.0-rc.6 and rc.7 — the theme's radius ladder is named
// by role and has no `-md` step — so both elements rendered with square corners
// while the five sibling notice boxes beside them were rounded.
//
// `@saasicat/ui-vue-tenant` is where that costs the most, which is why the
// scan is pointed at it. The package ships `.vue`, `.ts` and one `.css` out of
// `src/`, so those declarations are compiled by the CONSUMER's bundler against
// the roles `@saasicat/ui-vue/theme.css` brought into their application. No
// build in this repository resolves them and no fixture here renders them, so
// the only thing that can see the defect is a comparison of two sets.
//
// Both sets come from the sources, and neither is a list:
//
//   - defined — every `--sa-*` declaration in the stylesheets reachable from
//     the `./theme.css` export, followed through the `@import` graph. That is
//     the entry the package README tells a consumer to load, so a token file
//     counts the moment the theme pulls it in, and stops counting when it does
//     not.
//   - read — every `var(--sa-…)` in the package's own source.
//
// There is no exception table either. A role the theme deliberately leaves to
// the consumer is read with a fallback, and the fallback is what keeps the
// declaration alive when nobody sets it.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UI_VUE = join(ROOT, 'packages', 'ui-vue');
const TENANT_SRC = join(ROOT, 'packages', 'ui-vue-tenant', 'src');

const NAME_CHARACTER = /[\w-]/;
const WHITESPACE = /\s/;

/**
 * The `@import` targets of a stylesheet, resolved against its own directory.
 *
 * Scanned by index rather than matched by pattern: the target is the first
 * quoted string after the at-rule, whether it is written bare or wrapped in
 * `url()`, and one forward walk cannot divide the same input two ways.
 */
export function importedStylesheets(css, fromDir) {
    const source = withoutComments(css);
    const found = [];
    for (let at = source.indexOf('@import'); at !== -1; at = source.indexOf('@import', at + 1)) {
        let index = at + '@import'.length;
        while (index < source.length && source[index] !== "'" && source[index] !== '"') {
            // An unterminated at-rule ends at its semicolon, not at the quote of
            // whatever declaration follows it.
            if (source[index] === ';') break;
            index += 1;
        }
        const quote = source[index];
        if (quote !== "'" && quote !== '"') continue;
        const end = source.indexOf(quote, index + 1);
        if (end === -1) continue;
        found.push(resolve(fromDir, source.slice(index + 1, end)));
    }
    return found;
}

/**
 * Every `var(--sa-…)` a source reads, with its line and whether it names a
 * fallback.
 *
 * Comments are blanked first — this repository's style blocks discuss token
 * names in prose, and a scanner that reads prose reports roles nobody wrote.
 * `withoutComments` keeps every other byte where it was, so the offset still
 * describes the text the caller passed in and the line number is counted there.
 */
export function roleReads(source) {
    const css = withoutComments(source);
    const reads = [];
    for (let at = css.indexOf('var('); at !== -1; at = css.indexOf('var(', at + 1)) {
        let index = at + 'var('.length;
        while (index < css.length && WHITESPACE.test(css[index])) index += 1;
        if (!css.startsWith('--sa-', index)) continue;

        let end = index;
        while (end < css.length && NAME_CHARACTER.test(css[end])) end += 1;
        let after = end;
        while (after < css.length && WHITESPACE.test(css[after])) after += 1;

        reads.push({
            name: css.slice(index, end),
            hasFallback: css[after] === ',',
            line: source.slice(0, at).split('\n').length,
        });
    }
    return reads;
}

/** The reads nothing answers: no definition in the theme, and no fallback. */
export function unresolvedReads(reads, defined) {
    return reads.filter((read) => !read.hasFallback && !defined.has(read.name));
}

/** The stylesheet graph a consumer loads, starting at the published entry. */
function themeStylesheets() {
    const manifest = JSON.parse(readFileSync(join(UI_VUE, 'package.json'), 'utf8'));
    const entry = manifest.exports?.['./theme.css'];
    assert.equal(typeof entry, 'string', '`./theme.css` is no longer a plain export path');

    const seen = new Set();
    const queue = [resolve(UI_VUE, entry)];
    while (queue.length > 0) {
        const file = queue.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        queue.push(...importedStylesheets(readFileSync(file, 'utf8'), dirname(file)));
    }
    return [...seen];
}

/** Every `.vue`, `.ts` and `.css` under the tenant package's source tree. */
function sourceFiles(dir = TENANT_SRC, found = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, found);
        else if (/\.(vue|ts|css)$/.test(entry.name)) found.push(full);
    }
    return found;
}

describe('a role that is read is a role the theme defines', () => {
    const stylesheets = themeStylesheets();
    const defined = new Set(
        stylesheets.flatMap((file) =>
            declarations(readFileSync(file, 'utf8')).map(({ name }) => name),
        ),
    );
    const files = sourceFiles();
    const reads = files.flatMap((file) =>
        roleReads(readFileSync(file, 'utf8')).map((read) => ({ ...read, file })),
    );

    test('both sides of the comparison were actually read', () => {
        // The assertion below is a set difference, and an empty left side
        // satisfies it perfectly. A moved theme directory, a renamed export
        // condition or a source tree that stopped matching the extension list
        // would each report a clean bill of health for nothing at all.
        assert.ok(stylesheets.length >= 10, `only ${stylesheets.length} theme stylesheets found`);
        assert.ok(defined.size >= 200, `only ${defined.size} roles defined`);
        assert.ok(files.length >= 20, `only ${files.length} tenant source files found`);
        assert.ok(reads.length >= 500, `only ${reads.length} role reads found`);
    });

    test('the definitions reach the scale, not only the colours', () => {
        // The narrower version of the guard above. The defect this file was
        // written for is a size, and the two semantic files carry no size at
        // all: a theme graph that lost `tokens.scale.css` would still hold 150
        // colour roles, clear the count above, and call every radius, space and
        // type step in the package undefined.
        assert.ok(defined.has('--sa-radius-badge'), 'the radius ladder is not in the defined set');
        assert.ok(defined.has('--sa-space-3'), 'the spacing scale is not in the defined set');
        assert.ok(defined.has('--sa-color-fg-body'), 'the roles are not in the defined set');
    });

    test('the reads reach the two files the defect shipped in', () => {
        // Both offenders sat in a `<style scoped>` block of an SFC, which is the
        // one place a `.vue` walker can lose without losing the file itself.
        for (const name of ['TenantPlanSection.vue', 'PlanChangeWizard.vue']) {
            assert.ok(
                reads.some((read) => read.file.endsWith(name)),
                `no role read found in ${name}`,
            );
        }
    });

    test('no role is read that the theme leaves undefined', () => {
        const offenders = unresolvedReads(reads, defined).map(
            (read) => `${relative(ROOT, read.file)}:${read.line} ${read.name}`,
        );
        assert.deepEqual(
            offenders,
            [],
            "this package renders on the consumer's copy of `@saasicat/ui-vue/theme.css`, so a " +
                'role it does not define resolves to nothing and the whole declaration is ' +
                'dropped. Read a role the theme has, or name a fallback value',
        );
    });

    test('the rule is not vacuous: an undefined role is reported, with its line', () => {
        // The counter-check, run against the real set of definitions rather than
        // an invented one — `--sa-radius-md` is the role this guard was opened
        // for, and `--sa-space-3` on the line above it is a defined neighbour
        // that has to stay quiet in the same input.
        const source =
            '.a {\n    padding: var(--sa-space-3);\n    border-radius: var(--sa-radius-md);\n}';
        assert.deepEqual(unresolvedReads(roleReads(source), defined), [
            { name: '--sa-radius-md', hasFallback: false, line: 3 },
        ]);
    });

    test('and a role the theme defines is not reported', () => {
        const source = '.a { border-radius: var(--sa-radius-badge); }';
        assert.deepEqual(unresolvedReads(roleReads(source), defined), []);
    });

    test('a fallback answers for the role it stands in for', () => {
        // The escape hatch, and the reason this guard needs no exception list:
        // a declaration with a fallback survives an undefined role, so reading
        // one is a deliberate act rather than a typo.
        const source = '.a { border-radius: var(--sa-radius-md, 8px); }';
        assert.deepEqual(unresolvedReads(roleReads(source), defined), []);
    });

    test('a nested read is a read of its own', () => {
        // The fallback covers the role it is written beside, not the one inside
        // it. `var(--defined, var(--invented))` renders nothing when the outer
        // role is missing from a consumer's theme, which is precisely when the
        // inner one is reached.
        const source = '.a { color: var(--sa-color-fg-body, var(--sa-color-invented)); }';
        assert.deepEqual(
            unresolvedReads(roleReads(source), defined).map((read) => read.name),
            ['--sa-color-invented'],
        );
    });

    test('a role named in a comment is not a read', () => {
        assert.deepEqual(roleReads('/* var(--sa-radius-md) was here */\n.a { color: red; }'), []);
    });

    test('a comment above a read does not move its line', () => {
        // Blanking rather than deleting is what makes the line number right, and
        // the newlines a multi-line comment carries are the case that proves it.
        const source = '/* one\n   two */\n.a { color: var(--sa-color-fg-body); }';
        assert.deepEqual(
            roleReads(source).map((read) => read.line),
            [3],
        );
    });

    test('the import graph is followed, not guessed', () => {
        // `themeStylesheets` is worth nothing if it returns the entry alone, and
        // the entry declares no roles of its own.
        const entry = join(UI_VUE, 'src', 'ui', 'theme', 'index.css');
        const imported = importedStylesheets(readFileSync(entry, 'utf8'), dirname(entry));
        assert.ok(imported.length >= 10, `only ${imported.length} imports read from the entry`);
        assert.deepEqual(importedStylesheets('.a { color: red; }', '/x'), []);
    });
});
