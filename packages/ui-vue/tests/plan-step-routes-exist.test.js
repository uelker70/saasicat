import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { STANDARD_ADMIN_ROUTES } from '../dist/pages/index.js';

// The plan area is a wizard over three route-mounted pages, and each step
// navigates to the next by path. Those paths are written in the pages and
// the routes are written in `STANDARD_ADMIN_ROUTES`, and nothing tied the
// two together: the editor pushed `/admin/plans/review` while the table
// registered `plans/version/review`, so "Weiter · Review" landed on the
// manifest catch-all in every consumer. Found by vereinsfux's e2e at rc.2.
//
// Every `router.push(…)` target in the plan pages is read from the source
// and has to be a registered standard route — derived, not listed.

const PAGES_DIR = new URL('../src/pages/', import.meta.url).pathname;

/** `/admin/<path>` for every standard route and its children. */
function registeredPaths() {
    const paths = new Set();
    for (const route of STANDARD_ADMIN_ROUTES) {
        paths.add(`/admin/${route.path}`);
        for (const child of route.children ?? []) paths.add(`/admin/${route.path}/${child.path}`);
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
    const known = registeredPaths();
    const pages = readdirSync(PAGES_DIR).filter((name) => /^Plan.*\.vue$/.test(name));

    test('the plan pages are found', () => {
        assert.ok(pages.length >= 3, `only ${pages.length} plan pages under src/pages`);
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
