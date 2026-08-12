import { expect, test } from '@playwright/test';

import { VISUAL_CASES } from './visual/pages.js';

declare global {
    interface Window {
        __saasicatUnmatchedRequests?: string[];
    }
}

// Visual baselines for the design-token migration.
//
// AP2 §2.5 replaces 644 literal colours, 80 pixel values and 23 font sizes with
// tokens across 60 files. "No visual regression" is an opinion until there is a
// recorded before-state to compare against. This is that state.
//
// It snapshots COMPUTED STYLES, not pixels, and that is a deliberate choice:
//
//   - The failure mode of a token migration is `#64748b` mapped to the wrong
//     role. A computed-style diff names the element and prints both values; a
//     pixel diff reports "0.3% of pixels differ" and leaves you bisecting.
//   - Computed styles are platform-independent. Pixel baselines are not: font
//     hinting and anti-aliasing differ between a dev machine and CI, so pixel
//     snapshots need everyone to run the same Playwright Docker image or they
//     produce false failures until people stop trusting them.
//   - Layout still shows up, because the captured set includes the resolved box
//     metrics.
//
// What it does NOT catch: a change with no computed-style footprint — a swapped
// background-image, an SVG path edit, a z-index reshuffle that only matters
// while something overlaps. Those stay a review responsibility.

/** Properties a token migration can move. Everything else would be noise. */
const TRACKED_PROPERTIES = [
    'color',
    'background-color',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'border-top-width',
    'border-bottom-width',
    'border-radius',
    'box-shadow',
    'font-size',
    'font-weight',
    'line-height',
    'letter-spacing',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'margin-top',
    'margin-bottom',
    'gap',
    'display',
    'flex-direction',
    'align-items',
    'justify-content',
    'opacity',
] as const;

/**
 * Collects a stable, diffable description of the rendered page.
 *
 * The path is structural (`div>section:2>h2`) rather than a generated id, so a
 * snapshot survives everything except an actual change in structure or style.
 */
const COLLECT = ({ properties }: { properties: readonly string[] }) => {
    const lines: string[] = [];

    const pathOf = (el: Element): string => {
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node !== document.body) {
            const parent: Element | null = node.parentElement;
            const tag = node.tagName.toLowerCase();
            if (parent) {
                const sameTag = [...parent.children].filter(
                    (c) => c.tagName === (node as Element).tagName,
                );
                const index = sameTag.indexOf(node);
                parts.unshift(sameTag.length > 1 ? `${tag}:${index}` : tag);
            } else {
                parts.unshift(tag);
            }
            node = parent;
        }
        return parts.join('>');
    };

    const root = document.getElementById('visual-root') ?? document.body;
    for (const el of [root, ...root.querySelectorAll('*')]) {
        // Skip what the browser cannot lay out — invisible nodes have no
        // meaningful computed geometry and would only add churn.
        const style = window.getComputedStyle(el);
        if (style.display === 'none') continue;

        const values = properties
            .map((prop) => `${prop}=${style.getPropertyValue(prop).trim()}`)
            .join(' ');
        const classes =
            el.className && typeof el.className === 'string'
                ? `.${el.className.trim().split(/\s+/).join('.')}`
                : '';
        lines.push(`${pathOf(el)}${classes}  ${values}`);
    }

    return lines.join('\n');
};

test.describe('design-token visual baselines', () => {
    test('the roster still covers every page it claims to', () => {
        // A shrinking roster is the quiet way this suite stops protecting
        // anything: remove a case, and its page is simply no longer watched.
        expect(VISUAL_CASES.length).toBeGreaterThanOrEqual(18);
        expect(new Set(VISUAL_CASES.map((c) => c.id)).size).toBe(VISUAL_CASES.length);
    });

    for (const visualCase of VISUAL_CASES) {
        test(`${visualCase.id} — computed styles`, async ({ page }) => {
            const problems: string[] = [];
            page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

            await page.goto(`/?page=${visualCase.id}`);
            await page.waitForSelector('body[data-visual-ready="true"]');

            // The fixture renders this only when the page module failed to load
            // — a baseline of an error string proves nothing.
            await expect(page.locator('#visual-error')).toHaveCount(0);
            await expect(page.locator('#visual-root')).toHaveCount(1);

            // Surfaces that only exist once something is opened. `click()`
            // already waits for the element, so a selector that stops matching
            // fails the case instead of quietly baselining the closed state.
            for (const selector of visualCase.revealBy ?? []) {
                await page.locator(selector).first().click();
            }

            // A request the fixture cannot answer gets an empty array, which
            // renders as an empty card — indistinguishable from a deliberate
            // empty state, and exactly how two baselines came to record
            // nothing at all. Naming the endpoint beats debugging a snapshot.
            const unmatched = await page.evaluate(() => window.__saasicatUnmatchedRequests ?? []);
            expect(
                unmatched,
                `${visualCase.id} requested endpoints the fixture does not define`,
            ).toEqual([]);

            const styles = await page.evaluate(COLLECT, { properties: TRACKED_PROPERTIES });

            expect(styles.length, `${visualCase.id} rendered nothing to measure`).toBeGreaterThan(
                200,
            );
            expect(styles).toMatchSnapshot(`${visualCase.id}.styles.txt`);
            expect(problems, `${visualCase.id} threw while rendering`).toEqual([]);
        });
    }
});
