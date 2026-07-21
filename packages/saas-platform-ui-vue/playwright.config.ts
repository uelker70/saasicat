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
    webServer: {
        command: 'node tests-e2e/serve.mjs',
        url: 'http://localhost:5174/',
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
});
