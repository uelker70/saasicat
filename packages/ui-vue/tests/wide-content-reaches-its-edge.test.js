// A table that does not fit has to be reachable, not cut off.
//
// The failure is silent by construction: on the machine the page was built on
// the table fits, and the row that falls off the right edge on a phone is a row
// nobody scrolls to because there is nothing to scroll. Clipping does not throw
// and does not look broken — it looks like a table with fewer columns.
//
// So the guard is static, and it is derived rather than listed: every `<table>`
// a shipped component renders is found by sweeping the sources, and each one
// has to be reachable one of the two honest ways — inside a container that
// scrolls, or narrow enough that there is nothing to scroll to.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [join(HERE, '..', 'src'), join(HERE, '..', '..', 'ui-vue-tenant', 'src')];

function components(dir, found = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) components(full, found);
        else if (full.endsWith('.vue')) found.push(full);
    }
    return found;
}

/**
 * Rule bodies by selector, split on braces rather than matched.
 *
 * The selector is the *last* line before the brace: everything earlier in the
 * chunk is the template, or the rule before it. Taking the whole chunk gave
 * every first rule in a component a selector with the markup glued to it, and
 * nothing was ever found.
 */
function rules(source) {
    const found = new Map();
    for (const chunk of source.split('}')) {
        const at = chunk.indexOf('{');
        if (at === -1) continue;
        const line = chunk.slice(0, at).split('\n').at(-1) ?? '';
        for (const selector of line.split(',')) {
            const name = selector.trim();
            if (name) found.set(name, chunk.slice(at + 1));
        }
    }
    return found;
}

/** The classes a `<table>` in this source carries. */
function tableClasses(source) {
    const found = [];
    for (const line of source.split('\n')) {
        const at = line.indexOf('<table');
        if (at === -1) continue;
        const quoted = /class="([^"]*)"/.exec(line.slice(at));
        if (quoted) found.push(...quoted[1].split(/\s+/).filter(Boolean));
    }
    return found;
}

/**
 * Whether a table is reachable rather than clipped.
 *
 * Two honest ways, and the first is the one to check precisely. A table bound
 * to `width: 100%` cannot run off its container — the cells wrap instead — so
 * there is nothing to scroll to. One with a `min-width` or a fixed width can,
 * and then it needs an ancestor that scrolls.
 *
 * The width is read from the table's *own* rule. An earlier version asked
 * whether the file contained `width: 100%` anywhere, which every stylesheet
 * does, and the predicate answered yes to everything.
 */
function tableIsReachable(source) {
    const bySelector = rules(source);
    const scrolls = [...bySelector.values()].some((body) =>
        /overflow(-x)?:\s*(auto|scroll)/.test(body),
    );
    const bounded = tableClasses(source).some((name) => {
        const body = bySelector.get(`.${name}`);
        if (!body) return false;
        if (/min-width:\s*\d/.test(body)) return false;
        return /(max-)?width:\s*100%/.test(body);
    });
    return bounded || scrolls;
}

describe('wide content reaches its edge rather than being cut off', () => {
    const withTables = ROOTS.flatMap((root) => components(root))
        .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
        .filter(({ source }) => /<table[\s>]/.test(source));

    test('the sweep found the tables', () => {
        // Every assertion below is vacuously true on an empty list, and the
        // whole point is that the set is read off the sources.
        assert.ok(withTables.length > 0, 'no shipped component renders a table');
    });

    // @requirement SC-A11Y-010 — Wide content scrolls rather than being cut off
    test('every table either scrolls or is bound to its container', () => {
        const clipped = withTables
            .filter(({ source }) => !tableIsReachable(source))
            .map(({ path }) => relative(join(HERE, '..', '..'), path));
        assert.deepEqual(clipped, [], 'a table can run off the right edge with no way back');
    });

    test('a table with neither is refused', () => {
        // The counter-check, and it took two attempts. The first predicate
        // asked whether the file mentioned `width: 100%` at all, which every
        // stylesheet does — it answered yes to everything, including the page
        // this test was written to catch.
        const fixed = '<table class="t"></table>\n.t { width: 900px; }\n.wrap { padding: 0; }';
        assert.equal(tableIsReachable(fixed), false);

        const scrolled =
            '<table class="t"></table>\n.t { width: 900px; }\n.wrap { overflow: auto; }';
        assert.equal(tableIsReachable(scrolled), true);

        const bounded = '<table class="t"></table>\n.t { width: 100%; }\n.wrap { padding: 0; }';
        assert.equal(tableIsReachable(bounded), true);

        // A minimum width is a width that can exceed the container, whatever
        // the percentage beside it says.
        const wide = '<table class="t"></table>\n.t { width: 100%; min-width: 900px; }';
        assert.equal(tableIsReachable(wide), false);
    });
});
