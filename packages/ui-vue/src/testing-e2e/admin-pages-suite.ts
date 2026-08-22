// Shared E2E test skeleton for the SuperAdmin UI pages.
//
// App-specific specs (the consumer admins' `tests-e2e/`) pass their
// configuration through via `runAdminPagesSuite(config)` — the suite then
// clicks through login + all declared standard pages and checks for each:
//   - no pageerror events
//   - no console.error events (except whitelisted)
//   - no HTTP 4xx/5xx on `/api/` calls (except whitelisted)
//
// Plus a dashboard test that asserts the KPI card labels, distribution headers
// and shortcut titles against a declarative list.
//
// `import { test, expect } from '@playwright/test'` must be imported by the
// consumer so that Playwright's test runner finds the `test` calls.

import type { Page, expect as PwExpect, test as PwTest } from '@playwright/test';

export interface AdminPagesSuiteConfig {
    /** Display name, e.g. 'demoapp' / 'clubapp'. */
    appName: string;
    /** URL of the login page (full). */
    loginUrl: string;
    /** Test account. */
    email: string;
    password: string;
    /** Paths the smoke test should click through. */
    pages: ReadonlyArray<{
        /** Display name in the test description. */
        name: string;
        /** Path relative to the origin (e.g. '/admin/tenants'). */
        path: string;
        /** Optional: if set, check that this selector exists. */
        expectVisible?: string;
        /** Optional: HTTP patterns that are OK as 4xx/5xx (e.g. missing backend endpoints). */
        allowedFailures?: readonly RegExp[];
    }>;
    /** Expected KPI card labels on the dashboard page. */
    expectedKpiLabels: readonly string[];
    /** Expected distribution section titles. */
    expectedDistributionTitles?: readonly string[];
    /** Expected shortcut titles on the dashboard. */
    expectedShortcutTitles: readonly string[];
    /** Shortcuts that must NOT appear (e.g. "Dashboard"). */
    forbiddenShortcutTitles?: readonly string[];
    /** Console error patterns that should be ignored. */
    consoleErrorAllowlist?: readonly RegExp[];
    /** Path to the dashboard page (default `/admin/`). */
    dashboardPath?: string;
}

interface PageErrors {
    pageErrors: string[];
    consoleErrors: string[];
    networkErrors: string[];
}

// "Failed to load resource: the server responded with a status of …" is
// duplicated by the browser with the separately captured network errors. We
// don't treat it as a standalone console.error — otherwise every 404 counts
// twice and the signal from real app code gets lost in the noise.
const RESOURCE_FAILURE_MARKER = /Failed to load resource:/;

function attachListeners(
    page: Page,
    consoleAllowlist: readonly RegExp[] = [],
    networkAllowlist: readonly RegExp[] = [],
): PageErrors {
    const out: PageErrors = { pageErrors: [], consoleErrors: [], networkErrors: [] };
    page.on('pageerror', (err) => out.pageErrors.push(err.message));
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (RESOURCE_FAILURE_MARKER.test(text)) return;
        if (consoleAllowlist.some((re) => re.test(text))) return;
        out.consoleErrors.push(text);
    });
    page.on('response', (resp) => {
        if (resp.status() < 400) return;
        const url = resp.url();
        if (!url.includes('/api/')) return;
        if (networkAllowlist.some((re) => re.test(url))) return;
        out.networkErrors.push(`HTTP ${resp.status()} ${url}`);
    });
    return out;
}

async function loginIfNeeded(page: Page, config: AdminPagesSuiteConfig): Promise<void> {
    if (!page.url().includes('/login')) {
        await page.goto(config.loginUrl, { waitUntil: 'networkidle' });
    }
    if (!page.url().includes('/login')) return; // already logged in
    await page.locator('input[type="email"]').first().fill(config.email);
    const pw = page.locator('input[type="password"]').first();
    await pw.fill(config.password);
    // Enter triggers q-form @submit more reliably than a button click (Quasar
    // unifies form submit on the submit event, not on the button).
    await pw.press('Enter');
    await page.waitForURL((u) => !u.toString().includes('/login'), {
        timeout: 15_000,
    });
}

export function runAdminPagesSuite(
    test: typeof PwTest,
    expect: typeof PwExpect,
    config: AdminPagesSuiteConfig,
): void {
    const dashboardPath = config.dashboardPath ?? '/admin/';

    test.describe(`${config.appName}: SuperAdmin-Pages Smoke`, () => {
        for (const pageDef of config.pages) {
            test(`${pageDef.name} renders without errors`, async ({ page }) => {
                const errors = attachListeners(
                    page,
                    config.consoleErrorAllowlist,
                    pageDef.allowedFailures,
                );
                await loginIfNeeded(page, config);
                const origin = new URL(config.loginUrl).origin;
                await page.goto(`${origin}${pageDef.path}`, {
                    waitUntil: 'networkidle',
                    timeout: 15_000,
                });
                await page.waitForTimeout(800);
                if (pageDef.expectVisible) {
                    await expect(page.locator(pageDef.expectVisible).first()).toBeVisible({
                        timeout: 5_000,
                    });
                }
                expect(errors.pageErrors, `pageerror events on ${pageDef.path}`).toHaveLength(0);
                expect(
                    errors.consoleErrors,
                    `console.error events on ${pageDef.path}`,
                ).toHaveLength(0);
                expect(
                    errors.networkErrors,
                    `HTTP errors on /api/ during ${pageDef.path}`,
                ).toHaveLength(0);
            });
        }

        test('Dashboard shows the expected KPIs, distributions and shortcuts', async ({ page }) => {
            attachListeners(page, config.consoleErrorAllowlist);
            await loginIfNeeded(page, config);
            const origin = new URL(config.loginUrl).origin;
            await page.goto(`${origin}${dashboardPath}`, {
                waitUntil: 'networkidle',
                timeout: 15_000,
            });
            // KPI strip: platform CSS class `.sa-kpi__label`
            const kpiLabels = await page.locator('.sa-kpi__label').allTextContents();
            const normalizedKpis = kpiLabels.map((s) => s.trim());
            for (const expected of config.expectedKpiLabels) {
                expect(normalizedKpis, `KPI '${expected}' missing on the dashboard`).toContain(
                    expected,
                );
            }

            if (config.expectedDistributionTitles?.length) {
                const distTitles = await page
                    .locator('.sa-dashboard__row-head h2')
                    .allTextContents();
                const normalizedDist = distTitles.map((s) => s.trim());
                for (const expected of config.expectedDistributionTitles) {
                    expect(
                        normalizedDist,
                        `Distribution '${expected}' missing on the dashboard`,
                    ).toContain(expected);
                }
            }

            const shortcutTitles = await page
                .locator('.sa-dashboard__shortcut-title')
                .allTextContents();
            const normalizedShortcuts = shortcutTitles.map((s) => s.trim());
            for (const expected of config.expectedShortcutTitles) {
                expect(
                    normalizedShortcuts,
                    `Shortcut '${expected}' missing on the dashboard`,
                ).toContain(expected);
            }
            for (const forbidden of config.forbiddenShortcutTitles ?? []) {
                expect(
                    normalizedShortcuts,
                    `Shortcut '${forbidden}' must not be on the dashboard`,
                ).not.toContain(forbidden);
            }
        });
    });
}
