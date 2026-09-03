import { expect, test } from '@playwright/test';

import { STANDARD_ADMIN_ROUTES } from '../../src/pages/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The level that was missing: an ASSEMBLED consumer application.
//
// Every other frontend guard in this repo drives platform components inside a
// harness the platform itself controls — `route-mounted-pages` mounts them in
// jsdom, the visual and contrast suites render one page into `#visual-root` with
// a catch-all router stub. None of them boots an app, resolves a route, or uses
// the consumer's own bundler. So a defect that exists only in the assembly has
// no test that can fail.
//
// Three of the five runtime findings in phase 0 had exactly that shape, and the
// most recent one is why this file exists: `useRoute()` returned `undefined` in
// a consumer page because the bundle contained two copies of `vue-router` — the
// platform CREATES the router, the app's pages read it back, and the two APIs
// only meet through module identity. The admin shell rendered, the content area
// was blank, and every suite stayed green.
//
// **This asserts WIRING, not data.** `/api/**` is answered with empty bodies on
// purpose: the questions here are "does the route resolve", "does the page mount
// without warning", "does anything render". Do not add fixture payloads to make
// it assert more — a green run here would then look like data coverage, which it
// is not and which the visual suite already provides.

const ADMIN_ROOT = fileURLToPath(new URL('../../../../examples/notesapp/admin', import.meta.url));

/**
 * The app's own route table, read from its source.
 *
 * Derived rather than listed, because a hand-kept copy goes stale silently — and
 * did: a first sweep of this app used invented URLs, four of which hit the
 * catch-all redirect and rendered the dashboard. Every one "passed", and the
 * result was a statement about the guesses rather than about the app.
 *
 * The first parser then made the same mistake one level down. It matched
 * `path: '…'` followed IMMEDIATELY by `component:`, so an ordinary record like
 * `{ path: 'x', name: 'x', component: X }` was skipped in silence — and the
 * floor assertion would still have passed on whatever survived. A guard
 * satisfied exactly when coverage shrinks is the failure this file exists to
 * prevent.
 *
 * Now every record is found by its `path:` alone, whatever else it declares and
 * in whatever order, so a record cannot be missed: a route without a path is not
 * a route. Field order is irrelevant, and the record's own extent is found by
 * matching braces, so a nested `meta: { … }` does not end it early.
 */
interface RouteRecord {
    path: string;
    hasComponent: boolean;
}

/** The record a `path:` belongs to, from its declaration to its closing brace. */
function recordAt(source: string, from: number): string {
    let depth = 0;
    for (let i = from; i < source.length; i += 1) {
        const c = source[i];
        if (c === '{') depth += 1;
        else if (c === '}') {
            if (depth === 0) return source.slice(from, i);
            depth -= 1;
        }
    }
    return source.slice(from);
}

/**
 * One sample value per parameter.
 *
 * The parameterised routes matter most here: reading a param is what needs the
 * router instance, and it is the case that broke.
 */
function sample(path: string): string {
    return path.replace(/:(\w+)/g, (_, name) => (name === 'slug' ? 'globex' : 'sample'));
}

function readRouteTable(): {
    visit: string[];
    shell: RouteRecord[];
    records: RouteRecord[];
    /** `component:` occurrences in the SOURCE, counted without this parser. */
    componentsInSource: number;
} {
    const source = readFileSync(`${ADMIN_ROOT}/src/router/routes.ts`, 'utf8');

    const records: RouteRecord[] = [...source.matchAll(/\bpath:\s*'([^']*)'/g)].map((m) => ({
        path: m[1],
        hasComponent: /\bcomponent:/.test(recordAt(source, m.index + m[0].length)),
    }));

    // Absolute paths are the shell's own records — login, the error page, the
    // layout root, the index redirect and the catch-all. What remains are the
    // children mounted under `/admin`: every guarded page, and the only thing
    // worth sweeping.
    const isShell = (r: RouteRecord) => r.path === '' || r.path.startsWith('/');

    return {
        records,
        // Counted straight off the text. The first version of the cross-check
        // below derived this from `records` too, which made it circular: a
        // record this parser missed dropped out of BOTH sides and the totals
        // still balanced. A check whose two halves come from the same parse
        // cannot detect that parse being wrong.
        componentsInSource: [...source.matchAll(/\bcomponent:/g)].length,
        shell: records.filter(isShell),
        visit: records
            .filter((r) => !isShell(r))
            .map((r) => sample(r.path))
            .map((path) => `/admin/${path}`),
    };
}

const TABLE = readRouteTable();

/**
 * Every path the assembled app resolves — the consumer's own records AND the
 * standard ones `standardAdminChildren()` fills in behind them.
 *
 * Reading only the consumer's file was right while a consumer wrote every
 * route. Since the helper exists it writes six and the platform supplies the
 * rest, so a sweep of the file alone stopped visiting most of the app: the
 * pages an integrator never sees the wiring for are exactly the ones nothing
 * was checking.
 */
const PLATFORM_ROUTES = STANDARD_ADMIN_ROUTES.flatMap((route) => [
    route.path,
    ...(route.children ?? []).map((child) => `${route.path}/${child.path}`),
]);

const ROUTES = [
    ...new Set([...TABLE.visit, ...PLATFORM_ROUTES.map((path) => `/admin/${sample(path)}`)]),
];

test.describe('an assembled consumer app resolves every one of its routes', () => {
    test('every record in the route table was accounted for', () => {
        // The parse reached the file, and the platform table reached this spec.
        // Six is what the example writes since `standardAdminChildren` fills in
        // the rest; the number that has to stay large is the platform's.
        expect(
            TABLE.records.length,
            'no route records found — did the table move?',
        ).toBeGreaterThan(0);
        expect(
            PLATFORM_ROUTES.length,
            'the standard route table is empty — this sweep would visit only the example',
        ).toBeGreaterThan(15);

        // Every record went somewhere. Tautological today, and deliberately
        // kept: it is what fails first if a future filter drops a record.
        expect(TABLE.visit.length + TABLE.shell.length).toBe(TABLE.records.length);

        // The cross-check that can actually fail: every record that mounts a
        // component is either one this sweep visits or one of the shell's own.
        // A record whose path this parser misread would show up as a component
        // belonging to neither.
        // The cross-check that can actually fail, because its two halves come
        // from different places: every `component:` in the file belongs to a
        // record this sweep visits or to one of the shell's own. A path written
        // in a shape the matcher does not read — double quotes, a template
        // literal — leaves a component belonging to neither, and the counts
        // stop adding up. Verified against both of those shapes.
        const shellWithComponent = TABLE.shell.filter((r) => r.hasComponent).length;
        expect(
            TABLE.visit.length,
            'a record mounts a component but is neither visited nor part of the shell — ' +
                'its `path` is probably written in a form this parser does not read',
        ).toBe(TABLE.componentsInSource - shellWithComponent);

        expect(ROUTES, 'the parameterised route is what this file exists for').toContain(
            '/admin/tenants/globex',
        );
    });

    for (const route of ROUTES) {
        test(`${route} mounts`, async ({ page }) => {
            const problems: string[] = [];
            page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
            page.on('console', (message) => {
                const type = message.type();
                // Vue reports a missing required prop as a WARNING and renders
                // anyway, handing the component `undefined` — defect L1, which
                // shipped. A warning is a finding here, not noise.
                if (type === 'error' || type === 'warning') {
                    problems.push(`${type}: ${message.text().slice(0, 200)}`);
                }
            });

            // No backend. Empty bodies rather than failures, so that a console
            // error means a defect rather than an absent server.
            //
            // Empty of the right SHAPE, though — `[]` for a collection and
            // `null` for an endpoint whose contract is a single object. A
            // blanket `[]` handed `DiscoveryPage` an array where its prop
            // declares `DiscoverySnapshot | null`, and the page threw on it.
            // That says nothing about the app; it says the stub broke the
            // contract, which is the one thing a stub must not do.
            //
            // This is still not fixture data and must not grow into it: the
            // shape comes from the prop type, the content stays empty.
            //
            // `/settings` is the one endpoint whose contract has no empty body
            // at all — the page's resource refuses `null` — so that route is
            // swept in its failure state on purpose: it proves the page mounts
            // and shows its error banner, no more. The visual suite renders it
            // with data.
            const OBJECT_VALUED =
                /\/discovery(\/rescan)?$|\/manifest$|\/setup\/status$|\/settings$/;
            await page.route('**/api/**', (route) =>
                route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: OBJECT_VALUED.test(new URL(route.request().url()).pathname)
                        ? 'null'
                        : '[]',
                }),
            );

            await page.goto('/login');
            // Waited for rather than filled straight away: this is the consumer's
            // own Vite dev server, and its first compile of a real app takes far
            // longer than a fixture's. Without the wait the earliest workers race
            // the compile and fail with a locator timeout that looks like a
            // broken login page.
            await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 90_000 });
            await page.fill('input[type="email"]', 'admin@notesapp.example');
            await page.fill('input[type="password"]', 'demo');
            await page.click('button[type="submit"], button:has-text("ANMELDEN")');
            await expect(page).toHaveURL(/\/admin\//, { timeout: 15_000 });

            problems.length = 0;
            await page.goto(route);
            await page.waitForLoadState('networkidle');

            // Landed where we asked. A silent redirect to the dashboard is how
            // a route that does not exist looks exactly like one that works.
            expect(new URL(page.url()).pathname, `${route} redirected`).toBe(route);

            // The routed area rendered. Measured on the page container rather
            // than the body, or the shell's own navigation would carry every
            // assertion on its own.
            const rendered = await page.evaluate(
                () => document.querySelector('.q-page-container')?.textContent?.trim().length ?? 0,
            );
            expect(rendered, `${route} rendered no content inside the shell`).toBeGreaterThan(0);

            expect(problems, `${route} reported problems while mounting`).toEqual([]);
        });
    }
});
