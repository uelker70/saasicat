// @requirement SC-UI-002 — Mounting a shipped screen costs no wiring

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The plan area is a wizard over three route-mounted pages, and each step
// navigates to the next by path. Those paths are written in the pages and
// the routes are written in `STANDARD_ADMIN_ROUTES`, and nothing tied the
// two together: the editor pushed `/admin/plans/review` while the table
// registered `plans/version/review`, so "Weiter · Review" landed on the
// manifest catch-all in every consumer. Found by vereinsfux's e2e at rc.2.
//
// Every `router.push(…)` target in the plan pages is read from the source
// and has to be a registered standard route — derived, not listed. The route
// table is read from the source too: `./pages` ships as source and has no
// built artifact to import, which is how the first version of this test
// failed to load on a clean checkout.

const PAGES_DIR = new URL('../src/pages/', import.meta.url).pathname;

/**
 * `/admin/<path>` for every entry of `STANDARD_ADMIN_ROUTES` and its children,
 * read off the barrel's text. A `path:` at bracket depth 0 is a route, one
 * at depth 1 a child of the last route — the only two shapes the table has.
 */
function registeredPaths(barrel) {
    const start = barrel.indexOf('export const STANDARD_ADMIN_ROUTES');
    assert.notEqual(start, -1, 'STANDARD_ADMIN_ROUTES is not in the barrel');
    const open = barrel.indexOf('= [', start) + 2;
    let depth = 0;
    let close = open;
    for (; close < barrel.length; close += 1) {
        if (barrel[close] === '[') depth += 1;
        if (barrel[close] === ']') {
            depth -= 1;
            if (depth === 0) break;
        }
    }
    const body = barrel.slice(open + 1, close);

    const paths = new Set();
    let parent = null;
    depth = 0;
    for (const token of body.matchAll(/path: '([^']+)'|\[|\]/g)) {
        if (token[0] === '[') depth += 1;
        else if (token[0] === ']') depth -= 1;
        else if (depth === 0) {
            parent = token[1];
            paths.add(`/admin/${parent}`);
        } else paths.add(`/admin/${parent}/${token[1]}`);
    }
    return paths;
}

/** The string targets of `router.push(…)` in one file; `${plansBase()}` reads as `/admin/plans`. */
function pushTargets(source) {
    const targets = [];
    const call = 'router.push(';
    for (let at = source.indexOf(call); at !== -1; at = source.indexOf(call, at + call.length)) {
        const open = at + call.length;
        const quote = source[open];
        if (quote !== "'" && quote !== '"' && quote !== '`') continue;
        const close = source.indexOf(quote, open + 1);
        if (close === -1) continue;
        targets.push(source.slice(open + 1, close).replace('${plansBase()}', '/admin/plans'));
    }
    return targets;
}

describe('every step of the plan wizard navigates to a registered route', () => {
    const known = registeredPaths(readFileSync(join(PAGES_DIR, 'index.ts'), 'utf8'));
    const pages = readdirSync(PAGES_DIR).filter((name) => /^Plan.*\.vue$/.test(name));

    test('the plan pages and their routes are found', () => {
        assert.ok(pages.length >= 3, `only ${pages.length} plan pages under src/pages`);
        for (const path of [
            '/admin/plans',
            '/admin/plans/version/edit',
            '/admin/plans/version/review',
        ]) {
            assert.ok(known.has(path), `${path} was not read out of STANDARD_ADMIN_ROUTES`);
        }
    });

    for (const page of pages) {
        test(`${page} pushes only to standard routes`, () => {
            const targets = pushTargets(readFileSync(join(PAGES_DIR, page), 'utf8'));
            const unknown = targets.filter((target) => !known.has(target));
            assert.deepEqual(
                unknown,
                [],
                `${page} navigates to a path STANDARD_ADMIN_ROUTES does not register`,
            );
        });
    }
});
