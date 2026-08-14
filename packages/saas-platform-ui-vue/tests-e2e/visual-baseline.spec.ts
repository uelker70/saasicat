import { expect, test, type Page } from '@playwright/test';

import { VISUAL_CASES } from './visual/pages.js';

declare global {
    interface Window {
        __saasicatUnmatchedRequests?: string[];
        __saasicatVueWarnings?: string[];
        __saasicatEscapedRequests?: string[];
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

    // Paths are relative to the collected root, not to <body>. Anything above
    // it belongs to the harness, and describing it made every baseline churn
    // the day the fixture wrapped the page in the layout class a real app has.
    // A baseline should move when the PAGE moves.
    const pathOf = (el: Element): string => {
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node !== document.body && node.id !== 'visual-root') {
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

    // The page, plus any dialog Quasar teleported out of it. QDialog renders
    // into a portal appended to <body>, so a detail dialog opened by
    // `revealBy` sits outside `#visual-root` entirely — collecting only the
    // root would record the click and none of its result.
    const roots: Element[] = [
        root,
        ...[...document.querySelectorAll('.q-dialog')].filter((d) => !root.contains(d)),
    ];
    const collected = roots.flatMap((r) => [r, ...r.querySelectorAll('*')]);

    for (const el of collected) {
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

/**
 * Collects once the page has stopped moving.
 *
 * Opening something animates it, and a snapshot taken mid-flight records an
 * opacity or a colour that is different on every run — a baseline that fails
 * against itself, which is the fastest way to teach everyone to ignore this
 * suite. Waiting for Vue's transition classes covered only half of it: the
 * marketing tabs move via a plain CSS `transition`, which adds no class at all.
 *
 * So the condition is the honest one — two identical readings in a row — and it
 * needs no knowledge of what is animating or how.
 */
async function settledStyles(page: Page): Promise<string> {
    let previous = '';
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const current = await page.evaluate(COLLECT, { properties: TRACKED_PROPERTIES });
        if (current === previous) return current;
        previous = current;
        await page.waitForTimeout(50);
    }
    throw new Error('the page never stopped changing — nothing settled within two seconds');
}

/** Element count across the page and any teleported dialog. */
const COUNT_ELEMENTS = () => {
    const root = document.getElementById('visual-root') ?? document.body;
    const dialogs = [...document.querySelectorAll('.q-dialog')].filter((d) => !root.contains(d));
    return (
        root.querySelectorAll('*').length +
        dialogs.reduce((n, d) => n + 1 + d.querySelectorAll('*').length, 0)
    );
};

test.describe('design-token visual baselines', () => {
    test('the roster still covers every page it claims to', () => {
        // A shrinking roster is the quiet way this suite stops protecting
        // anything: remove a case, and its page is simply no longer watched.
        expect(VISUAL_CASES.length).toBeGreaterThanOrEqual(22);
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
            const before = await page.evaluate(COUNT_ELEMENTS);
            for (const selector of visualCase.revealBy ?? []) {
                await page.locator(selector).first().click();
            }
            if (visualCase.revealBy?.length) {
                // A click that opens nothing is the quiet failure this whole
                // field exists to prevent: the case looks like it covers the
                // opened state and covers the closed one. It happened — the
                // email detail is a QDialog, and clicking its row changed
                // nothing the collector could see.
                await expect
                    .poll(() => page.evaluate(COUNT_ELEMENTS), {
                        message: `${visualCase.id}: revealBy clicked, but nothing new rendered`,
                    })
                    .toBeGreaterThan(before);
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

            // A page that never asked the fixture at all. `unmatchedRequests`
            // cannot see this one: the request went round the stub to the real
            // network, so the fixture has no record of having been consulted.
            const escaped = await page.evaluate(() => window.__saasicatEscapedRequests ?? []);
            expect(
                escaped,
                `${visualCase.id} went round the fixture's HttpClient — it is missing an ` +
                    '`http` prop, or the component has no seam for one',
            ).toEqual([]);

            // Same reasoning one level up: Vue warns about a missing required
            // prop and renders anyway, so a case can be "covered" while the
            // component it covers is missing the callback its buttons call.
            const warnings = await page.evaluate(() => window.__saasicatVueWarnings ?? []);
            expect(
                warnings,
                `${visualCase.id} rendered with Vue warnings — the case is under-specified`,
            ).toEqual([]);

            const styles = await settledStyles(page);

            expect(styles.length, `${visualCase.id} rendered nothing to measure`).toBeGreaterThan(
                200,
            );
            expect(styles).toMatchSnapshot(`${visualCase.id}.styles.txt`);
            expect(problems, `${visualCase.id} threw while rendering`).toEqual([]);
        });
    }
});

// Does anything break when the viewport is not 1440 wide?
//
// Nothing in this suite asked that before, and it is the one question a
// breakpoint change is about. The baselines and the contrast checks both run at
// a single fixed width, so moving a `max-width` from 1100px to Quasar's 1023.98
// is a change with no observation at all — the layout would simply stay in its
// wide arrangement for another 76 pixels, and the first person to see it would
// be a user on a 1080p laptop.
//
// Horizontal overflow rather than a snapshot per width: a snapshot at five
// widths times twenty-two pages is 110 files nobody reads, and it would fail on
// every legitimate reflow. Overflow is the actual defect — content pushed off
// the side of the page — and it is one number.
const BREAKPOINT_WIDTHS = [
    // Just inside and just outside each of the five Quasar bounds, because a
    // breakpoint bug lives at the edge, not in the middle of a band.
    { width: 360, label: 'xs' },
    { width: 599, label: 'xs upper edge' },
    { width: 600, label: 'sm lower edge' },
    { width: 1023, label: 'sm upper edge' },
    { width: 1024, label: 'md lower edge' },
    { width: 1439, label: 'md upper edge' },
    { width: 1440, label: 'lg lower edge' },
];

test.describe('no page overflows its viewport', () => {
    for (const visualCase of VISUAL_CASES) {
        test(`${visualCase.id} — every breakpoint band`, async ({ page }) => {
            const offenders: string[] = [];
            for (const { width, label } of BREAKPOINT_WIDTHS) {
                await page.setViewportSize({ width, height: 900 });
                await page.goto(`/?page=${visualCase.id}`);
                await page.waitForSelector('body[data-visual-ready="true"]');

                // The widest ELEMENT that sticks out, not the root's scroll
                // delta. The delta alone reported a constant 13px on six pages
                // at every width, which is the shape of a scrollbar artefact
                // rather than a layout bug — `100vw` and a few of Quasar's
                // helpers measure the viewport including the scrollbar that
                // `clientWidth` excludes. Naming the element tells the two
                // apart, and it is what a reader needs anyway.
                const overflow = await page.evaluate(() => {
                    const limit = document.documentElement.clientWidth;
                    // A pixel of slack absorbs fractional layout rounding.
                    const slack = 1;
                    let worst: { path: string; right: number } | null = null;
                    for (const el of document.querySelectorAll('body *')) {
                        const style = getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden') continue;
                        // An element that scrolls its own content is doing its
                        // job — a wide table inside `overflow-x: auto` is the
                        // fix, not the defect.
                        if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
                        const box = el.getBoundingClientRect();
                        if (box.width === 0 || box.height === 0) continue;
                        if (box.right <= limit + slack) continue;
                        // EVERY ancestor, not just the parent. A wide table's
                        // `thead` is three levels below the element that
                        // scrolls it (`.q-table__middle`), and checking one
                        // level reported thirteen pages as broken when what
                        // they were doing was scrolling a table correctly.
                        //
                        // Only SCROLLABLE ancestors, though — `hidden` is not
                        // the same thing and is the worse of the two: `auto`
                        // means the reader can still reach the content,
                        // `hidden` means it is cut off. Treating them alike is
                        // how a squeezed editor column got past this check. Its
                        // content was never pushed off the page; it was clipped
                        // inside an `overflow: hidden` grid cell, which is
                        // precisely the state the skip was excusing.
                        let scrollable = false;
                        for (let up = el.parentElement; up; up = up.parentElement) {
                            const upStyle = getComputedStyle(up).overflowX;
                            if (upStyle === 'auto' || upStyle === 'scroll') {
                                scrollable = true;
                                break;
                            }
                        }
                        if (scrollable) continue;
                        if (!worst || box.right > worst.right) {
                            // Named through its ancestry when it has no class
                            // of its own: `div.` tells a reader nothing, and a
                            // guard whose report cannot be acted on is a guard
                            // people learn to re-record instead of read.
                            const name = (node: Element) => {
                                const cls = String(node.className || '')
                                    .trim()
                                    .split(/\s+/)[0];
                                return node.tagName.toLowerCase() + (cls ? `.${cls}` : '');
                            };
                            const trail = [];
                            for (
                                let n: Element | null = el;
                                n && trail.length < 4;
                                n = n.parentElement
                            ) {
                                trail.unshift(name(n));
                                if (String(n.className || '').trim()) break;
                            }
                            worst = { path: trail.join('>'), right: box.right };
                        }
                    }
                    return worst ? { ...worst, limit } : null;
                });
                if (overflow)
                    offenders.push(
                        `${width}px (${label}): ${overflow.path} reaches ${Math.round(overflow.right)}px, viewport is ${overflow.limit}px`,
                    );
            }
            expect(offenders, `${visualCase.id} pushes content off the side of the page`).toEqual(
                [],
            );
        });
    }
});
