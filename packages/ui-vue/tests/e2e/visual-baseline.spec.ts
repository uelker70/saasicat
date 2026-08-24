import { expect, test, type Page } from '@playwright/test';

import { VISUAL_CASES } from './visual/pages.js';
import { COLLECT, reveal } from './visual/collect.js';

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
//   - Computed styles are almost all platform-independent. Pixel baselines are
//     not: font hinting and anti-aliasing differ between a dev machine and CI,
//     so pixel snapshots need everyone to run the same Playwright Docker image
//     or they produce false failures until people stop trusting them. The one
//     exception in the captured set is `width`/`height`; see the note on them.
//   - Layout shows up, because the captured set includes the resolved box
//     metrics. It did not always: this list recorded two of four margins, none
//     of the four insets and neither dimension, so a card could change from
//     280px wide to 320px and all 22 baselines stayed green.
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

    // ── The box, added later and added at the END on purpose ─────────────
    //
    // The ORDER of this list is the recorded line format: every element is one
    // line of `property=value` pairs in exactly this sequence. Insert a
    // property in the middle and every line of every baseline is rewritten, and
    // a re-record that rewrites everything cannot show that it changed nothing.
    // Appended, each recorded line keeps its old text as a prefix, so
    // "additive only" is something a script can check rather than something a
    // pull request has to assert. Keep adding at the end.
    //
    // What they close: `pnpm run tokens` counts pixel literals on the
    // properties a scale governs and on the ones it does not. When these were
    // added, 33 of the first group and 233 of the second sat on properties
    // nothing above recorded — the insets, the horizontal margins, and every
    // explicit box dimension. A page could hardcode a 220px column, and this
    // suite's answer to "what does this look like" left the number out.
    'margin-left',
    'margin-right',
    'top',
    'right',
    'bottom',
    'left',
    // `border-right-width` is not a finding today. It is here because the list
    // above records all four border COLOURS and two of the four widths, and a
    // set that can answer "did this border move" for three sides is the same
    // hole one side narrower.
    'border-left-width',
    'border-right-width',
    // The used box — and the one pair here that is NOT platform-independent:
    // these resolve against the text inside the element, so a machine with
    // different font metrics reads different numbers. That cost is paid
    // deliberately, because an explicit `width: 220px` is invisible without
    // them and they were 133 of those 233 findings. If CI and a
    // developer machine ever disagree here, the fix is to pin the font the
    // fixture renders with, not to stop recording the box.
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
] as const;

/**
 * Collects a stable, diffable description of the rendered page.
 *
 * The path is structural (`div>section:2>h2`) rather than a generated id, so a
 * snapshot survives everything except an actual change in structure or style.
 */
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
 *
 * Two readings alone were not enough, and the gap is worth writing down: a
 * transition that is REMOVING a node changes nothing between two samples 50 ms
 * apart, and the node is still there for both. `AdminRefreshBtn`'s spinner
 * fades out over 300 ms after the page's first load resolves, so on a slow
 * runner three extra nodes — the fade wrapper, its `svg`, its `circle` — got
 * into the reading. Locally they never did, and the pages it hit differed per
 * run. Hence the wait below, which asks the browser what is still moving
 * instead of naming anything.
 */
async function settledStyles(page: Page): Promise<string> {
    let previous = '';
    for (let attempt = 0; attempt < 40; attempt += 1) {
        await animationsFinished(page);
        const current = await page.evaluate(COLLECT, { properties: TRACKED_PROPERTIES });
        const stillMoving = await page.evaluate(PAGE_IS_MOVING);
        // A reading taken while something is mid-flight cannot be half of a
        // matching pair: two readings 50 ms apart both land inside a 300 ms
        // departure and agree with each other about a node on its way out.
        if (!stillMoving && current === previous) return current;
        previous = stillMoving ? '' : current;
        await page.waitForTimeout(50);
    }
    throw new Error('the page never stopped changing — nothing settled within two seconds');
}

/**
 * Waits out every animation that has an end.
 *
 * A spinner repeats forever, so waiting for all of them would wait for the test
 * timeout. The distinction is in the animation itself — its computed iteration
 * count — rather than in a list of selectors that would have to be maintained.
 */
async function animationsFinished(page: Page): Promise<void> {
    await page.evaluate(async () => {
        // A frame first: a transition begins on the frame after its class is
        // applied, so asking before that returns nothing and the wait would
        // pass through the very thing it exists to wait for.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const ending = document
            .getAnimations()
            .filter((animation) =>
                Number.isFinite(animation.effect?.getComputedTiming().iterations ?? 1),
            );
        // A cancelled animation rejects; that is still "no longer moving".
        await Promise.all(ending.map((animation) => animation.finished.catch(() => undefined)));
    });
}

/**
 * Whether anything on the page is still on its way in or out.
 *
 * Two conditions, because animations alone missed the case that started this:
 * Quasar's refresh spinner leaves from `opacity: 0`, so its fade transitions
 * from a value to itself and the browser starts NO animation at all —
 * `getAnimations()` is empty while three nodes sit in the DOM for the length of
 * a transition nobody is running. What marks them is Vue's own class
 * convention: an element being removed carries `<name>-leave-active` until the
 * transition it is not performing is deemed over.
 */
const PAGE_IS_MOVING = () => {
    const running = document
        .getAnimations()
        .filter((animation) =>
            Number.isFinite(animation.effect?.getComputedTiming().iterations ?? 1),
        ).length;
    return running + document.querySelectorAll('[class*="-leave-active"]').length;
};

test.describe('the collector reads a page at rest', () => {
    // `marketing-catalog` failed twice on CI with three extra nodes in its
    // reading: the refresh button's spinner, mid-departure. It never failed
    // locally, not even under an 8x CPU throttle — the window is a few frames
    // wide and the runner is where they come apart.
    //
    // So this makes the window rather than waiting for one. Vue keeps a
    // departing element in the DOM for the length of its transition, and
    // Quasar's spinner leaves from `opacity: 0`: the transition animates a
    // value to itself, the browser starts nothing, and `getAnimations()` is
    // empty while the nodes are still there. That is why waiting on animations
    // alone did not fix it, and why this test still fails if the collector goes
    // back to that.
    test('a node on its way out never reaches the reading', async ({ page }) => {
        await page.goto('/?page=marketing-catalog');
        await page.waitForSelector('body[data-visual-ready="true"]');

        const leaving = () =>
            page.evaluate(() => document.querySelectorAll('[class*="-leave-active"]').length);

        // The departure lasts a few frames, which is short enough that both
        // readings of a settle can miss it — on this machine. Widening it to
        // 700 ms makes the window observable here instead of only on a loaded
        // runner, and it does NOT create an animation to wait for: the spinner
        // leaves from `opacity: 0`, so a longer duration on a value that does
        // not change still animates nothing. That is the whole point.
        await page.addStyleTag({
            content: '[class*="-leave-active"] { transition-duration: 700ms !important; }',
        });

        await page.locator('header button').last().click();

        // The premise: the state this guards against does occur here. Without
        // it a green run would only mean the click did nothing.
        let sawDeparture = false;
        for (let attempt = 0; attempt < 40 && !sawDeparture; attempt += 1) {
            sawDeparture = (await leaving()) > 0;
            if (!sawDeparture) await page.waitForTimeout(10);
        }
        expect(sawDeparture, 'clicking refresh no longer makes anything leave').toBe(true);

        expect(await settledStyles(page)).not.toContain('-leave-active');
    });
});

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
            await reveal(page, visualCase.revealBy ?? [], visualCase.id);

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

// The brand mark on the two card pages is a fixed square, and a flex row takes
// its shortfall out of every item that can give — including that one. Adding a
// second switcher gave those rows a shortfall to distribute, and nothing looked
// broken while they distributed it: measured before the fix, the login mark read
// 23.47px wide at 360 and 0px at 320, and the setup mark was squeezed at every
// width in this list, 1440 included, where it read 35.61.
//
// Shape rather than "44px": the number is a design decision that may move, and
// a test repeating it only proves somebody typed it twice. Flex shrinks along
// the main axis alone, so a mark that lost width and kept its height is exactly
// the defect, and squareness is the invariant that says so without knowing what
// the design chose. The two marks are named here because only they claim it —
// every other item in those rows is text, and shrinking is what text is for.
const SQUARE_MARKS = [
    { page: 'login', selector: '.sa-login-logo' },
    { page: 'setup-wizard', selector: '.sa-setup-badge' },
];

test.describe('the brand mark keeps its shape', () => {
    for (const mark of SQUARE_MARKS) {
        test(`${mark.page} — every breakpoint band`, async ({ page }) => {
            const offenders: string[] = [];
            for (const { width, label } of BREAKPOINT_WIDTHS) {
                await page.setViewportSize({ width, height: 900 });
                await page.goto(`/?page=${mark.page}`);
                await page.waitForSelector('body[data-visual-ready="true"]');

                const box = await page
                    .locator(mark.selector)
                    .first()
                    .evaluate((el) => {
                        const r = el.getBoundingClientRect();
                        return { width: r.width, height: r.height };
                    });
                if (box.width === 0 || box.height === 0) {
                    offenders.push(`${width}px (${label}): squeezed to nothing`);
                } else if (Math.abs(box.width - box.height) > 1) {
                    offenders.push(
                        `${width}px (${label}): ${box.width.toFixed(2)}×${box.height.toFixed(2)}`,
                    );
                }
            }
            expect(offenders, `${mark.selector} is squeezed out of shape`).toEqual([]);
        });
    }
});
