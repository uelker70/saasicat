import { expect, test } from '@playwright/test';
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

const ADMIN_ROOT = fileURLToPath(new URL('../../../examples/notesapp/admin', import.meta.url));

/**
 * The app's own route table, read from its source.
 *
 * Derived rather than listed, because a hand-kept copy goes stale silently — and
 * did: a first sweep of this app used invented URLs, four of which hit the
 * catch-all redirect and rendered the dashboard. Every one "passed", and the
 * result was a statement about the guesses rather than about the app.
 */
function consumerRoutes(): string[] {
    const source = readFileSync(`${ADMIN_ROOT}/src/router/routes.ts`, 'utf8');

    // Children of the `/admin` record, which is where every guarded page lives.
    const paths = [...source.matchAll(/\{\s*path:\s*'([^']*)'\s*,\s*component:/g)].map((m) => m[1]);

    return paths
        .filter((path) => path && !path.startsWith('/'))
        .map((path) =>
            // One sample value per parameter. The parameterised routes are the
            // ones that matter most here: reading a param is what needs the
            // router instance, and it is the case that broke.
            path.replace(/:(\w+)/g, (_, name) => (name === 'slug' ? 'globex' : 'sample')),
        )
        .map((path) => `/admin/${path}`);
}

const ROUTES = consumerRoutes();

test.describe('an assembled consumer app resolves every one of its routes', () => {
    test('the route table was actually read', () => {
        // A parse that silently returns nothing would make every case below
        // vacuous — there would be no cases at all, and the suite would be green.
        expect(ROUTES.length, 'no routes parsed from the consumer route table').toBeGreaterThan(8);
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
            const OBJECT_VALUED = /\/discovery$/;
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
