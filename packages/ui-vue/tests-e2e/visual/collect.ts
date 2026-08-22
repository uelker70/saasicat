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
 * The set of structural paths the collector can see, classes and styles dropped.
 *
 * `COLLECT` writes each element as `path.class.class  prop=value …`, and a path
 * is `tag:index` segments joined by `>` — it contains no dot, so everything from
 * the first dot on is class names and style values. What is left is the shape of
 * the DOM: what exists and where, independent of how it is painted.
 */
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
