import { expect, test, type Page } from '@playwright/test';

// Can an operator still reach the shell's controls on a phone?
//
// `AdminLayout`'s header is a `nowrap` flex row that grows with the product:
// a menu button, the page title, whatever a consumer puts in `#header-actions`,
// the locale switcher, the theme switcher, a role badge and the user block with
// its sign-out button. Nothing in that row wraps, and a flex line that runs out
// of space does not report an error — it shrinks whatever can shrink and lets
// the rest run past the edge.
//
// Past the edge is the whole problem, and it is quieter than it sounds. The
// header is `position: fixed`, and a fixed box is excluded from the viewport's
// scrollable overflow, so `documentElement.scrollWidth` stays exactly equal to
// `clientWidth` while a control sits 22px beyond the right edge. There is no
// scrollbar, no visual seam, nothing to drag — the button is simply not there.
// Adding the theme switcher did that to the sign-out button at 320 and 360:
// measured on this app, the row's right edge moved from 319.4px to 382px while
// the viewport stayed 360px.
//
// **Why this file, when the repo already measures overflow.**
// `visual-baseline.spec.ts` asks the same question of every page in the visual
// roster — and `AdminLayout` is in no case in that roster, because it is the
// frame those pages render inside rather than one of them. So the shell chrome,
// which every admin page in every consumer app sits underneath, had no rendered
// coverage at all. This gives it some, at the level where it is real: the
// example app, assembled by its own bundler, with the layout mounted the way a
// consumer mounts it.
//
// **What it asserts, and why in this shape.** Not "the switcher is 38px wide" —
// that is a design decision that may move, and a test repeating it only proves
// somebody typed it twice. The invariant is the one the operator cares about: a
// control they cannot reach is broken, whatever its width. So the controls are
// COLLECTED from the header rather than listed, and each is asked whether it is
// inside the viewport. A control added to this row later is covered the day it
// is added, without anyone remembering this file.

const WIDTHS = [
    // 320 is below the band the page-overflow guard sweeps, and deliberately
    // included: it is the narrowest phone still in use, the shell is chrome
    // rather than page content, and it is one of the two widths that regressed.
    // The pages that overflow at 320 are a separate, older debt.
    { width: 320, label: 'narrowest phone' },
    { width: 360, label: 'xs' },
    { width: 390, label: 'xs, common phone' },
    { width: 599, label: 'xs upper edge' },
    { width: 600, label: 'sm lower edge' },
    { width: 1023, label: 'sm upper edge' },
    { width: 1024, label: 'md lower edge' },
    { width: 1440, label: 'lg lower edge' },
];

/**
 * Every control in the header, and whether the viewport contains it.
 *
 * Focusable elements rather than a selector list, so the answer follows the
 * markup instead of a copy of it. `q-tooltip` and `q-menu` are teleported out
 * of the header by Quasar, so they cannot be caught here by accident.
 */
const READ_CONTROLS = () => {
    const header = document.querySelector('.q-header');
    if (!header) return null;

    const limit = document.documentElement.clientWidth;
    const toolbar = header.querySelector('.q-toolbar');
    const controls = [...header.querySelectorAll('button, a[href], [role="button"], input')]
        .filter((el) => {
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map((el) => {
            const box = el.getBoundingClientRect();
            const cls = String(el.className || '')
                .trim()
                .split(/\s+/)
                .find((c) => c.startsWith('sa-'));
            return {
                name:
                    cls ??
                    el.getAttribute('aria-label') ??
                    el.querySelector('.q-icon')?.textContent?.trim() ??
                    el.tagName.toLowerCase(),
                left: box.left,
                right: box.right,
                width: box.width,
            };
        })
        // A zero-width box is not a control anybody can press, and it is not
        // what this file is about either — it would report the same element
        // twice under a different failure.
        .filter((c) => c.width > 0);

    return {
        limit,
        controls,
        offenders: controls
            .filter((c) => c.right > limit + 1 || c.left < -1)
            .map((c) => `${c.name} spans ${Math.round(c.left)}…${Math.round(c.right)}px`),
        // The row itself, as a second reading of the same fact: a `nowrap` flex
        // line whose content is wider than its box has already overflowed, even
        // where the last control happens to land just inside the edge.
        toolbarOverflow: toolbar ? toolbar.scrollWidth - toolbar.clientWidth : 0,
    };
};

/**
 * Fills the identity block the way a consumer passing `userName`/`userEmail`
 * fills it.
 *
 * `examples/notesapp` mounts `AdminLayout` as a bare route record and passes
 * neither, so its header renders an empty name and an empty email — and the
 * widest state of this row is therefore one no app in this repository shows.
 * The other two consumers do pass them. Writing the text into the nodes the
 * layout always renders reaches exactly the state those props produce: same
 * elements, same classes, same rules — only characters that were not there.
 */
async function fillIdentity(page: Page): Promise<void> {
    const filled = await page.evaluate(() => {
        const user = document.querySelector('.sa-admin-user');
        const name = user?.querySelector('.sa-admin-user__name .text-body2');
        const mail = user?.querySelector('.sa-admin-user__email');
        const initials = user?.querySelector('.q-avatar__content');
        if (!name || !mail || !initials) return false;
        name.textContent = 'Alexandra Schmidt';
        mail.textContent = 'alexandra.schmidt@notesapp.example';
        initials.textContent = 'AS';
        return true;
    });
    // A silent no-op here would make the populated half of this file assert the
    // empty header twice, which is the shape of "green because it looked at
    // nothing" this suite exists to avoid.
    expect(filled, 'the identity block was not found — has the header markup moved?').toBe(true);
}

async function signIn(page: Page): Promise<void> {
    // No backend. Shapes rather than payloads, exactly as the route-wiring
    // sweep does it: this file asserts geometry, not data.
    const OBJECT_VALUED = /\/discovery(\/rescan)?$|\/manifest$|\/setup\/status$/;
    await page.route('**/api/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: OBJECT_VALUED.test(new URL(route.request().url()).pathname) ? 'null' : '[]',
        }),
    );

    await page.goto('/login');
    // The consumer's own dev server compiles a real app on demand; the earliest
    // worker would otherwise race that first build.
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 90_000 });
    await page.fill('input[type="email"]', 'admin@notesapp.example');
    await page.fill('input[type="password"]', 'demo');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/admin\//, { timeout: 15_000 });
}

test.describe('the shell header keeps its controls reachable', () => {
    for (const identity of ['as the example ships it', 'with a name and an email'] as const) {
        test(`${identity} — every breakpoint band`, async ({ page }) => {
            await signIn(page);

            const offenders: string[] = [];
            let fewestControls = Number.POSITIVE_INFINITY;

            for (const { width, label } of WIDTHS) {
                await page.setViewportSize({ width, height: 900 });
                await page.goto('/admin/tenants');
                await page.waitForSelector('.q-header .q-toolbar');
                if (identity === 'with a name and an email') await fillIdentity(page);

                const reading = await page.evaluate(READ_CONTROLS);
                expect(reading, 'the shell header did not render').not.toBeNull();

                fewestControls = Math.min(fewestControls, reading!.controls.length);
                for (const offender of reading!.offenders)
                    offenders.push(
                        `${width}px (${label}): ${offender}, viewport ${reading!.limit}px`,
                    );
                if (reading!.toolbarOverflow > 1)
                    offenders.push(
                        `${width}px (${label}): the toolbar row is ${Math.round(reading!.toolbarOverflow)}px wider than its box`,
                    );
            }

            expect(
                offenders,
                'a control in the shell header is outside the viewport — the header is ' +
                    '`position: fixed`, so nothing scrolls to bring it back',
            ).toEqual([]);

            // The counter-check, without which every assertion above passes by
            // finding nothing: the sweep has to have seen the row's controls.
            // Three is the floor the layout always renders — the drawer toggle,
            // a switcher and sign-out — and it is what fails if the collector
            // stops matching rather than the layout stops overflowing.
            expect(
                fewestControls,
                'the control sweep found almost nothing — it is no longer reading the header',
            ).toBeGreaterThanOrEqual(3);
        });
    }

    test('the theme switcher is one of the controls it protects', async ({ page }) => {
        // The narrowest band, because that is where a row under pressure drops
        // things — and this control is the one the branch exists to add. Its
        // LABEL is allowed to collapse there; the button is not.
        await signIn(page);
        await page.setViewportSize({ width: 320, height: 900 });
        await page.goto('/admin/tenants');
        await page.waitForSelector('.q-header .q-toolbar');

        const reading = await page.evaluate(READ_CONTROLS);
        expect(reading!.controls.map((c) => c.name)).toContain('sa-theme-switcher');

        // And it still opens: a button inside the viewport that cannot be
        // pressed would satisfy every measurement above.
        await page.locator('.sa-theme-switcher').click();
        await expect(page.locator('.q-menu')).toBeVisible();
    });
});
