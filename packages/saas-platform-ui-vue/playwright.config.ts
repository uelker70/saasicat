import { defineConfig } from '@playwright/test';

// Playwright-Setup für die Plattform-UI-Vue-Pakete.
//
// Ein minimaler Node-HTTP-Server (siehe `tests-e2e/serve.mjs`) serviert das
// Paket-Root unter http://localhost:5174, sodass `index.html` aus
// `tests-e2e/fixtures/` per HTTP auf `../../dist/index.js` zugreifen kann.
// `file://`-URLs lehnen ESM-Module-Imports wegen CORS ab; ein echter
// HTTP-Server umgeht das ohne Vite-/Webpack-Toolchain.
//
// Alle App-HTTP-Requests im Test (Backend-Boot/Manifest/Publish) werden
// per `page.route()` gemockt — kein Backend nötig.
//
// Konsumenten-Admin-Apps haben ihre eigene playwright-Config (verbunden mit
// vite preview); diese hier deckt die Plattform-Bibliothek selbst ab.

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
