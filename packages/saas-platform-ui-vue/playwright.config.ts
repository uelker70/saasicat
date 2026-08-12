import { defineConfig } from '@playwright/test';

// Playwright setup for the platform-ui-vue packages.
//
// A minimal Node HTTP server (see `tests-e2e/serve.mjs`) serves the package
// root at http://localhost:5174, so that `index.html` from
// `tests-e2e/fixtures/` can access `../../dist/index.js` over HTTP.
// `file://` URLs reject ESM module imports due to CORS; a real HTTP server
// works around that without a Vite/Webpack toolchain.
//
// All app HTTP requests in the test (backend boot/manifest/publish) are
// mocked via `page.route()` — no backend needed.
//
// Consumer admin apps have their own playwright config (wired to vite
// preview); this one here covers the platform library itself.

export default defineConfig({
    testDir: './tests-e2e',
    testMatch: /.*\.spec\.ts$/,
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
            command: 'node tests-e2e/serve.mjs',
            url: 'http://localhost:5174/',
            reuseExistingServer: !process.env.CI,
            stdout: 'pipe',
            stderr: 'pipe',
        },
        {
            // The visual baselines need the SFCs compiled and the real
            // stylesheet cascade, which the static server above cannot give
            // them — so they get their own Vite app (tests-e2e/visual/).
            command: 'pnpm exec vite --config tests-e2e/visual/vite.config.ts',
            url: 'http://localhost:5175/',
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
            stdout: 'pipe',
            stderr: 'pipe',
        },
    ],
    projects: [
        {
            name: 'chromium',
            testIgnore: /(visual-baseline|theme-contrast)\.spec\.ts$/,
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
    ],
});
