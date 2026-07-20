// Geteiltes E2E-Test-Skelett für die SuperAdmin-UI-Pages.
//
// App-spezifische Specs (die `tests-e2e/` der Konsumenten-Admins)
// reichen ihre Konfiguration via `runAdminPagesSuite(config)` durch — die
// Suite klickt sich dann durch Login + alle deklarierten Standard-Pages und
// prüft jeweils:
//   - keine pageerror-Events
//   - keine console.error-Events (außer whitelisted)
//   - keine HTTP-4xx/5xx auf `/api/`-Calls (außer whitelisted)
//
// Plus ein Dashboard-Test, der die KPI-Card-Labels, Distribution-Header und
// Shortcut-Titel gegen eine deklarative Liste assert-checkt.
//
// `import { test, expect } from '@playwright/test'` muss vom Konsumenten
// importiert werden, damit Playwrights Test-Runner die `test`-Calls findet.

import type { Page, expect as PwExpect, test as PwTest } from '@playwright/test';

export interface AdminPagesSuiteConfig {
    /** Anzeigename, z. B. 'demoapp' / 'clubapp'. */
    appName: string;
    /** URL der Login-Seite (vollständig). */
    loginUrl: string;
    /** Test-Account. */
    email: string;
    password: string;
    /** Pfade, durch die der Smoke-Test klicken soll. */
    pages: ReadonlyArray<{
        /** Anzeigename in der Test-Description. */
        name: string;
        /** Pfad relativ zum Origin (z. B. '/admin/tenants'). */
        path: string;
        /** Optional: Wenn gesetzt, prüfen dass dieser Selektor existiert. */
        expectVisible?: string;
        /** Optional: HTTP-Patterns die als 4xx/5xx OK sind (z. B. fehlende Backend-Endpoints). */
        allowedFailures?: readonly RegExp[];
    }>;
    /** Erwartete KPI-Card-Labels auf der Dashboard-Page. */
    expectedKpiLabels: readonly string[];
    /** Erwartete Distribution-Section-Titel. */
    expectedDistributionTitles?: readonly string[];
    /** Erwartete Shortcut-Titel auf dem Dashboard. */
    expectedShortcutTitles: readonly string[];
    /** Shortcuts, die NICHT auftauchen dürfen (z. B. „Dashboard"). */
    forbiddenShortcutTitles?: readonly string[];
    /** Console-Error-Patterns, die ignoriert werden sollen. */
    consoleErrorAllowlist?: readonly RegExp[];
    /** Pfad zur Dashboard-Page (Default `/admin/`). */
    dashboardPath?: string;
}

interface PageErrors {
    pageErrors: string[];
    consoleErrors: string[];
    networkErrors: string[];
}

// "Failed to load resource: the server responded with a status of …" ist
// vom Browser dupliziert mit den separat erfassten Network-Errors. Wir
// behandeln es nicht als eigenständigen console.error — sonst zählt jeder
// 404 doppelt und das Signal aus echtem App-Code geht im Rauschen unter.
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
    if (!page.url().includes('/login')) return; // schon eingeloggt
    await page.locator('input[type="email"]').first().fill(config.email);
    const pw = page.locator('input[type="password"]').first();
    await pw.fill(config.password);
    // Enter triggert q-form @submit zuverlässiger als button-Click (Quasar
    // vereinheitlicht Form-Submit auf submit-Event, nicht auf button).
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
            test(`${pageDef.name} rendert ohne Fehler`, async ({ page }) => {
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
                expect(errors.pageErrors, `pageerror-Events auf ${pageDef.path}`).toHaveLength(0);
                expect(
                    errors.consoleErrors,
                    `console.error-Events auf ${pageDef.path}`,
                ).toHaveLength(0);
                expect(
                    errors.networkErrors,
                    `HTTP-Errors auf /api/ während ${pageDef.path}`,
                ).toHaveLength(0);
            });
        }

        test('Dashboard zeigt erwartete KPIs, Distributions und Shortcuts', async ({ page }) => {
            attachListeners(page, config.consoleErrorAllowlist);
            await loginIfNeeded(page, config);
            const origin = new URL(config.loginUrl).origin;
            await page.goto(`${origin}${dashboardPath}`, {
                waitUntil: 'networkidle',
                timeout: 15_000,
            });
            // KPI-Strip: Plattform-CSS-Klasse `.sa-kpi__label`
            const kpiLabels = await page.locator('.sa-kpi__label').allTextContents();
            const normalizedKpis = kpiLabels.map((s) => s.trim());
            for (const expected of config.expectedKpiLabels) {
                expect(normalizedKpis, `KPI '${expected}' fehlt auf Dashboard`).toContain(expected);
            }

            if (config.expectedDistributionTitles?.length) {
                const distTitles = await page
                    .locator('.sa-dashboard__row-head h2')
                    .allTextContents();
                const normalizedDist = distTitles.map((s) => s.trim());
                for (const expected of config.expectedDistributionTitles) {
                    expect(
                        normalizedDist,
                        `Distribution '${expected}' fehlt auf Dashboard`,
                    ).toContain(expected);
                }
            }

            const shortcutTitles = await page
                .locator('.sa-dashboard__shortcut-title')
                .allTextContents();
            const normalizedShortcuts = shortcutTitles.map((s) => s.trim());
            for (const expected of config.expectedShortcutTitles) {
                expect(normalizedShortcuts, `Shortcut '${expected}' fehlt auf Dashboard`).toContain(
                    expected,
                );
            }
            for (const forbidden of config.forbiddenShortcutTitles ?? []) {
                expect(
                    normalizedShortcuts,
                    `Shortcut '${forbidden}' darf nicht auf Dashboard sein`,
                ).not.toContain(forbidden);
            }
        });
    });
}
