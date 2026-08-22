import { defineConfig } from '@playwright/test';

// Playwright setup for the platform-ui-vue packages.
//
// A minimal Node HTTP server (see `tests/e2e/serve.mjs`) serves the package
// root at http://localhost:5174, so that `index.html` from
// `tests/e2e/fixtures/` can access `../../../dist/index.js` over HTTP.
// `file://` URLs reject ESM module imports due to CORS; a real HTTP server
// works around that without a Vite/Webpack toolchain.
//
// All app HTTP requests in the test (backend boot/manifest/publish) are
// mocked via `page.route()` — no backend needed.
//
// Consumer admin apps have their own playwright config (wired to vite
// preview); this one here covers the platform library itself.

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: /.*\.spec\.ts$/,
    // Outside CI every `webServer` below may attach to a server it did not start
    // (see `reuseExistingServer`), and a server from a second checkout of this
    // repository renders code nobody measured — as a PASS. This runs after the
    // servers are up and before the first test, and refuses the run when one of
    // them is serving somebody else's tree.
    globalSetup: './tests/e2e/assert-servers-serve-this-checkout.ts',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: 'http://localhost:5174',
        headless: true,
    },
    webServer: [
        {
            command: 'node tests/e2e/serve.mjs',
            url: 'http://localhost:5174/',
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
            stderr: 'pipe',
        },
        {
            // The visual baselines need the SFCs compiled and the real
            // stylesheet cascade, which the static server above cannot give
            // them — so they get their own Vite app (tests/e2e/visual/).
            command: 'pnpm exec vite --config tests/e2e/visual/vite.config.ts',
            url: 'http://localhost:5175/',
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
        {
            // The consumer example's OWN dev server, running its own `main.ts`,
            // its own router and its own bundler resolution. That is the point:
            // every other server here is one the platform controls, and the
            // defects this catches only exist in an assembled app.
            command: 'pnpm --filter notesapp-admin exec vite --port 5176 --strictPort',
            url: 'http://localhost:5176/login',
            reuseExistingServer: !process.env.CI,
            timeout: 180_000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
    ],
    projects: [
        {
            name: 'chromium',
            testIgnore: /(visual-baseline|theme-contrast|consumer-[\w-]+)\.spec\.ts$/,
            use: { browserName: 'chromium' },
        },
        {
            // Separate project: the visual baselines talk to the Vite fixture on
            // 5175, and they pin the viewport because a resized window would
            // move every breakpoint-dependent computed value at once.
            //
            // `theme-contrast` runs here too because it needs the same real
            // cascade — and `colorScheme: 'light'` matters to it twice over:
            // it is the starting state it compares the dark theme against.
            name: 'visual',
            testMatch: /(visual-baseline|theme-contrast)\.spec\.ts$/,
            use: {
                browserName: 'chromium',
                baseURL: 'http://localhost:5175',
                viewport: { width: 1440, height: 900 },
                deviceScaleFactor: 1,
                colorScheme: 'light',
                locale: 'en-GB',
                timezoneId: 'UTC',
            },
        },
        {
            // The integration level: the consumer app as a user gets it.
            //
            // Matched by the `consumer-` prefix rather than by name, so a spec
            // written against the assembled app runs against it by being called
            // what it is. A name list here and a second one in `testIgnore`
            // above are two places to forget, and a spec forgotten in either
            // one silently runs against the wrong server or not at all.
            name: 'consumer',
            testMatch: /consumer-[\w-]+\.spec\.ts$/,
            // Generous: each case logs in through the real form against a dev
            // server that compiles on demand.
            timeout: 120_000,
            use: {
                browserName: 'chromium',
                baseURL: 'http://localhost:5176',
                viewport: { width: 1440, height: 900 },
            },
        },
    ],
});
