// Quasar's stylesheet reaches an assembled application through the one import
// it writes, `@saasicat/ui-vue/quasar.css`. That file only imports
// `quasar/dist/quasar.css`, which the application's own bundler resolves from
// the package's Quasar — so what this checks is the whole path: the consumer's
// Vite following the import out of `node_modules` and the rules arriving on the
// page. Every other consumer spec here stays green with an empty stylesheet,
// because none of them reads a style Quasar alone sets.

// @requirement SC-UI-027 — The administration's framework stylesheet is the one of the framework it runs

import { expect, test } from '@playwright/test';

test.describe("an assembled application's Quasar stylesheet", () => {
    test("carries Quasar's own rule for a button", async ({ page }) => {
        // No backend: the login page needs none, and the setup check reads
        // `null` as "set up".
        await page.route('**/api/**', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
        );

        await page.goto('/login');
        // The consumer's own dev server compiles a real app on demand; the
        // earliest worker would otherwise race that first build.
        await expect(page.locator('button.q-btn[type="submit"]')).toBeVisible({ timeout: 90_000 });

        // Read off the stylesheets the page holds rather than off one button:
        // a page's own rules may set a button's display, but no stylesheet of
        // the platform's writes a bare `.q-btn` rule — only Quasar's does.
        const quasarButtonDisplay = await page.evaluate(() => {
            for (const sheet of Array.from(document.styleSheets)) {
                for (const rule of Array.from(sheet.cssRules)) {
                    if (rule instanceof CSSStyleRule && rule.selectorText === '.q-btn') {
                        if (rule.style.display) return rule.style.display;
                    }
                }
            }
            return null;
        });

        expect(quasarButtonDisplay).toBe('inline-flex');
    });
});
