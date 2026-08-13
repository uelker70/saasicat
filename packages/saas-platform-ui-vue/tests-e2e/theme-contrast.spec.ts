import { expect, test, type Page } from '@playwright/test';

import { VISUAL_CASES } from './visual/pages.js';

declare global {
    interface Window {
        __saasicatSetTheme?: (scheme: 'light' | 'dark' | 'system') => Promise<void>;
    }
}

// Does the dark theme work? Three questions, and a snapshot answers none of them.
//
// Recording a second set of baselines in dark mode would freeze whatever the
// dark theme happens to render — including white text on a white card, which is
// precisely the failure this theme can produce. A baseline cannot tell a design
// from a defect; it can only tell a change from no change.
//
// So this asks the questions directly, on all 19 standard pages:
//
//   1. Did the switch DO anything? The page canvas must actually get darker.
//      Without this the other two pass vacuously on a light page.
//   2. Did it reach the whole surface? A majority of painted elements must
//      change colour. A component that reads a primitive instead of a role
//      stays light while everything around it flips, and that shows up here as
//      a share that stopped rising.
//   3. Is anything unreadable — in EITHER theme? A role missing from the dark
//      file silently keeps its light value, and the usual result is text at
//      1.0:1 against its own background.
//
// The contrast floor is 3.0:1, not the 4.5:1 that WCAG AA asks for normal text.
// That is deliberate and this test does not certify AA: 3.0 is the line below
// which text is not "hard to read" but *gone*, and a guard that fires on
// borderline greys would be switched off within a week. Tightening it is a
// separate piece of work with its own findings.

const CONTRAST_FLOOR = 3;

/**
 * Known offenders, each with the reason it is not fixed here.
 *
 * An allow-list rather than a lower floor: a floor of 2.9 would hide every
 * future 2.9 too, and nobody would ever learn which one. Every entry is checked
 * for staleness below, so an exception cannot outlive the thing it describes.
 */
const ACCEPTED: readonly { page: string; selector: string; why: string }[] = [
    {
        page: 'plans',
        selector: '.sa-plan-list-plan-mark',
        why:
            'The plan identity chip takes its colour from a palette in TypeScript ' +
            '(PlanList `DEFAULT_ACCENTS`/`FALLBACK_ACCENTS`), applied as an inline ' +
            'style. Those are outside the token migration by construction — the ' +
            'codemod never touches a template or a script — and they do not follow ' +
            'the theme, so the violet mark lands at 2.96:1 on a dark surface. ' +
            'Making per-plan accents theme-aware is its own change, with a prop ' +
            '(`planAccents`) that consumers already set.',
    },
];

/** Per-element colour facts, gathered in the page. */
interface Painted {
    path: string;
    color: string;
    background: string;
    contrast: number;
    text: string;
}

interface Reading {
    canvasLuminance: number;
    painted: Painted[];
}

const COLLECT = (): Reading => {
    const parse = (value: string): [number, number, number, number] => {
        const nums = value.match(/[\d.]+/g)?.map(Number) ?? [];
        if (value.startsWith('color(')) {
            // Chromium serialises color-mix() as `color(srgb r g b / a)` with
            // 0..1 channels. Reading those as 0..255 would make every mixed
            // colour look black and the whole suite fail on formatting.
            const [r = 0, g = 0, b = 0, a = 1] = nums.slice(value.includes('srgb') ? 0 : 0);
            return [r * 255, g * 255, b * 255, a];
        }
        const [r = 0, g = 0, b = 0, a = 1] = nums;
        return [r, g, b, a];
    };

    const relativeLuminance = (rgb: [number, number, number, number]): number => {
        const channel = (v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    };

    /** Flattens `over` onto `under`; both premultiplied-free sRGB. */
    const composite = (
        over: [number, number, number, number],
        under: [number, number, number, number],
    ): [number, number, number, number] => [
        over[3] * over[0] + (1 - over[3]) * under[0],
        over[3] * over[1] + (1 - over[3]) * under[1],
        over[3] * over[2] + (1 - over[3]) * under[2],
        1,
    ];

    /**
     * What this element is actually drawn on.
     *
     * Walks up compositing every translucent layer, because the dark theme's
     * tinted surfaces are `color-mix(… , transparent)` on purpose — reading
     * only the nearest opaque ancestor would judge a chip against the page
     * instead of against the tint it sits in.
     */
    const effectiveBackground = (el: Element): [number, number, number, number] => {
        let layers: [number, number, number, number][] = [];
        let node: Element | null = el;
        while (node) {
            const bg = parse(window.getComputedStyle(node).backgroundColor);
            if (bg[3] > 0) layers.push(bg);
            if (bg[3] >= 1) break;
            node = node.parentElement;
        }
        // The document's own paper, in case everything above was translucent.
        layers.push([255, 255, 255, 1]);
        layers = layers.reverse();
        return layers.reduce((under, over) => composite(over, under));
    };

    const contrast = (
        a: [number, number, number, number],
        b: [number, number, number, number],
    ): number => {
        const la = relativeLuminance(a);
        const lb = relativeLuminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };

    const pathOf = (el: Element): string => {
        const parts: string[] = [];
        let node: Element | null = el;
        while (node && node !== document.body) {
            const cls =
                typeof node.className === 'string' && node.className.trim()
                    ? `.${node.className.trim().split(/\s+/)[0]}`
                    : '';
            parts.unshift(node.tagName.toLowerCase() + cls);
            node = node.parentElement;
        }
        return parts.join('>');
    };

    const root = document.getElementById('visual-root') ?? document.body;
    const painted: Painted[] = [];

    for (const el of [root, ...root.querySelectorAll('*')]) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (Number(style.opacity) < 0.5) continue;

        // An icon's "text" is a ligature name — `chevron_right` renders as a
        // glyph, and a decorative affordance is not held to a text-contrast
        // floor. Matched on the class rather than on the font family, because
        // the fixture does not load the icon webfont: with it, the family says
        // "Material Icons"; without it, the ligature name renders as literal
        // words in the body font and the family says nothing.
        if (el.classList.contains('q-icon')) continue;

        // A gradient cannot be reduced to one background colour, and this
        // checker only composites `background-color`. Two elements are painted
        // that way — the login and setup logo badges — and reading through the
        // gradient to the white card below reported their white text at 1:1.
        // Skipping is the honest answer; a wrong verdict would be worse than
        // no verdict, and it would be the verdict people learn to ignore.
        if (style.backgroundImage !== 'none') continue;

        // Only elements with their OWN visible text: a wrapper inherits its
        // child's characters and would be judged against the wrong background.
        const own = [...el.childNodes]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent ?? '')
            .join('')
            .trim();
        if (!own) continue;
        if (el.getBoundingClientRect().height === 0) continue;

        const fg = parse(style.color);
        if (fg[3] === 0) continue;
        const bg = effectiveBackground(el);
        painted.push({
            path: pathOf(el),
            color: style.color,
            background: `rgb(${bg.slice(0, 3).map(Math.round).join(', ')})`,
            contrast: Math.round(contrast(composite(fg, bg), bg) * 100) / 100,
            text: own.slice(0, 40),
        });
    }

    const canvas =
        document.querySelector('.sa-page, .sa-admin-layout, #visual-root') ?? document.body;
    return {
        canvasLuminance: relativeLuminance(effectiveBackground(canvas)),
        painted,
    };
};

/**
 * Reads once the page has stopped moving.
 *
 * Switching the theme changes custom properties on `<html>`, and Chromium does
 * not finish resolving everything that depends on them within the tick that
 * sets them: the first version of this test caught the paginator with its text
 * already flipped to light and its background still white, and reported the
 * page as broken. Two identical readings in a row is the same settle condition
 * the visual baselines use, and it needs no knowledge of what is still
 * resolving.
 */
async function read(page: Page): Promise<Reading> {
    let previous = '';
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const current = await page.evaluate(COLLECT);
        const serialised = JSON.stringify(current);
        if (serialised === previous) return current;
        previous = serialised;
        await page.waitForTimeout(50);
    }
    throw new Error('the page never stopped changing — nothing settled within two seconds');
}

const isAccepted = (path: string) => ACCEPTED.some((entry) => path.includes(entry.selector));

const unreadable = (reading: Reading) =>
    reading.painted
        .filter((p) => p.contrast < CONTRAST_FLOOR && !isAccepted(p.path))
        .map((p) => `${p.path} — ${p.contrast}:1  "${p.text}"  ${p.color} on ${p.background}`);

test.describe('both themes are readable', () => {
    // An exception that no longer describes anything is worse than no exception:
    // it reads as "known and accepted" while the element it suppresses has moved
    // out from under the guard entirely. Each entry names the page it lives on,
    // so this check is one test rather than a tally spread over four workers —
    // the first version summed matches in `afterAll` and failed on whichever
    // worker happened not to render `plans`.
    for (const entry of ACCEPTED) {
        test(`the accepted exception ${entry.selector} still exists`, async ({ page }) => {
            await page.goto(`/?page=${entry.page}`);
            await page.waitForSelector('body[data-visual-ready="true"]');
            await expect(
                page.locator(entry.selector).first(),
                `${entry.selector} is no longer rendered on "${entry.page}" — ` +
                    'delete the exception or point it at where the element went',
            ).toBeAttached();
        });
    }

    for (const visualCase of VISUAL_CASES) {
        test(`${visualCase.id} — light and dark`, async ({ page }) => {
            await page.goto(`/?page=${visualCase.id}`);
            await page.waitForSelector('body[data-visual-ready="true"]');
            await expect(page.locator('#visual-error')).toHaveCount(0);

            // The readiness marker says the PAGE rendered, not that the theme
            // stylesheet arrived — on a cold Vite start those are seconds
            // apart, and a contrast reading taken in between is a list of
            // findings about a stylesheet that is not there yet. That happened
            // once, on one worker, and looked exactly like a real defect.
            await expect
                .poll(
                    () =>
                        page.evaluate(() =>
                            getComputedStyle(document.documentElement)
                                .getPropertyValue('--sa-color-bg-app')
                                .trim(),
                        ),
                    { message: 'the theme stylesheet never loaded' },
                )
                .not.toBe('');

            const light = await read(page);
            expect(
                light.painted.length,
                `${visualCase.id} rendered no text to judge`,
            ).toBeGreaterThan(5);
            expect(
                unreadable(light),
                `${visualCase.id}: unreadable text in the LIGHT theme`,
            ).toEqual([]);

            // Through the shipped switch, not through `setAttribute`: the
            // attribute alone leaves Quasar in light mode, and a test that
            // imitates half the bridge measures a screen that cannot occur.
            await page.evaluate(() => window.__saasicatSetTheme?.('dark'));
            const dark = await read(page);

            // 1. The switch did something.
            expect(
                dark.canvasLuminance,
                `${visualCase.id}: the page canvas did not get darker — the dark theme did not apply at all`,
            ).toBeLessThan(light.canvasLuminance);

            // 2. It reached the surface rather than just the canvas.
            const byPath = new Map(light.painted.map((p) => [p.path, p]));
            const comparable = dark.painted.filter((p) => byPath.has(p.path));
            const changed = comparable.filter((p) => byPath.get(p.path)?.color !== p.color);
            expect(
                changed.length / Math.max(1, comparable.length),
                `${visualCase.id}: only ${changed.length} of ${comparable.length} text colours ` +
                    `moved — something is painting from a primitive instead of a role`,
            ).toBeGreaterThan(0.5);

            // 3. Nothing disappeared into its own background.
            expect(unreadable(dark), `${visualCase.id}: unreadable text in the DARK theme`).toEqual(
                [],
            );
        });
    }
});

test.describe('an embedded consumer stays in step with its host', () => {
    // The case: an app that loads `theme.css` for the tenant-facing pages and
    // never runs the bridge, on a machine whose OS is set to dark. That is
    // `examples/notesapp/web`, and every consumer embedding `pages-tenant/*`.
    //
    // The stylesheet used to answer the operating system directly, and the
    // measurement below is why it no longer does: it paints the platform's
    // surfaces and Quasar paints its own cards, steppers and separators, and
    // Quasar follows only `body--dark`. One of them moved, the other did not.
    test.use({ colorScheme: 'dark' });

    test('the OS alone does not put the platform into dark mode', async ({ page }) => {
        await page.goto('/?page=audit');
        await page.waitForSelector('body[data-visual-ready="true"]');

        const reading = await page.evaluate(() => {
            // Undo what the fixture's bridge did, leaving the embedded case.
            document.documentElement.removeAttribute('data-sa-theme');
            document.body.classList.remove('body--dark');

            const host = document.querySelector('.sa-section') as HTMLElement;
            const quasarPaints = (className: string) => {
                const el = document.createElement('div');
                el.className = className;
                host.appendChild(el);
                const background = getComputedStyle(el).backgroundColor;
                el.remove();
                return background;
            };
            return {
                osPrefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
                platformSurface: getComputedStyle(host).backgroundColor,
                quasarCard: quasarPaints('q-card'),
            };
        });

        // Without this the case is vacuous: it only means something while the
        // browser really is reporting a dark preference.
        expect(reading.osPrefersDark, 'the dark OS preference was not emulated').toBe(true);

        expect(
            reading.platformSurface,
            'the platform went dark from the operating system while Quasar did not — ' +
                `its cards are still ${reading.quasarCard}. The application has to ` +
                'decide, because it is the only one that can move both halves.',
        ).toBe(reading.quasarCard);
    });
});
