/**
 * Reading the rendered DOM, and opening what a case says has to be opened.
 *
 * Both visual specs need this and neither may own it. `theme-contrast` used to
 * click `revealBy` and read immediately, while `visual-baseline` polled until
 * something new had actually rendered — so the contrast checker could judge a
 * page it only believed it had opened. It did: `bundles` names a hover target
 * behind its reveal, and the element was simply not there yet.
 *
 * One definition of "revealed", used by both.
 */
import { expect, type Page } from '@playwright/test';

export const COLLECT = ({ properties }: { properties: readonly string[] }) => {
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

    // The page, plus anything teleported out of it. A dialog renders into a
    // node appended to <body>, so one opened by `revealBy` sits outside
    // `#visual-root` entirely — collecting only the root would record the click
    // and none of its result.
    //
    // Derived from where the node SITS, not from what it is called. This asked
    // for `.q-dialog` until the tenant package stopped using Quasar, and then
    // `tenant-plan-change` — a case whose entire subject is a dialog — recorded
    // ONE line and `--update-snapshots` wrote that down as the new truth. A
    // baseline cannot tell a design from a defect; a gathering rule tied to
    // another library's class name cannot tell an empty page from a renamed one.
    const roots: Element[] = [
        root,
        ...[...document.body.children].filter(
            (node) =>
                !root.contains(node) &&
                !node.contains(root) &&
                // Empty scaffolding is not a teleported surface. Quasar's
                // notification host is nine always-present containers with
                // nothing in them, and recording those put twelve lines of
                // somebody else's chrome into all nineteen baselines — churn
                // that moves when Quasar moves and never when a page does.
                node.textContent?.trim(),
        ),
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
 * The set of structural paths the collector can see, classes and styles dropped.
 *
 * `COLLECT` writes each element as `path.class.class  prop=value …`, and a path
 * is `tag:index` segments joined by `>` — it contains no dot, so everything from
 * the first dot on is class names and style values. What is left is the shape of
 * the DOM: what exists and where, independent of how it is painted.
 */
/**
 * The fixture has finished mounting.
 *
 * `attached`, not the default `visible`. The attribute IS the readiness signal;
 * whether `<body>` has a box is a question about layout, and for a case whose
 * whole output is teleported and fixed the honest answer is that it does not.
 * `tenant-plan-change` is exactly that case — the plan wizard is a dialog, so
 * `#app` renders nothing and `<body>` measures 1280x0.
 *
 * It passed before this was written, and for a reason nobody chose: Quasar's
 * scroll lock made `<body>` `position: fixed` with explicit offsets, which gave
 * it a box. A gate that holds because of a side effect of somebody else's
 * scroll lock is a gate that will fail the day that side effect leaves.
 */
export async function visualReady(page: Page): Promise<void> {
    await page.waitForSelector('body[data-visual-ready="true"]', { state: 'attached' });
}

export function structuralPaths(collected: string): Set<string> {
    return new Set(collected.split('\n').map((line) => line.split('.')[0].trimEnd()));
}

/**
 * Performs a case's `revealBy` clicks and waits until the page has changed.
 *
 * "Changed" is counted as NEW PATHS rather than as more elements: a tab switch
 * replaces one panel with another, so opening the smaller of two panels shrinks
 * the page and reads as a click that did nothing. Paths carry no classes, so a
 * click that only toggles a class adds none either — which is the same
 * question, asked directly.
 *
 * The pointer is taken off the last target afterwards. `click()` leaves the
 * mouse where it landed, and whatever `:hover` that element carries would
 * otherwise be recorded as its resting appearance.
 */
export async function reveal(page: Page, selectors: readonly string[], caseId: string) {
    if (!selectors.length) return;

    const paths = async () =>
        structuralPaths(await page.evaluate(COLLECT, { properties: [] as readonly string[] }));
    const before = await paths();

    for (const selector of selectors) {
        await page.locator(selector).first().click();
    }

    await expect
        .poll(async () => [...(await paths())].filter((path) => !before.has(path)).length, {
            message: `${caseId}: revealBy clicked, but nothing new rendered`,
        })
        .toBeGreaterThan(0);

    await page.mouse.move(0, 0);
}
