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
const ACCEPTED: readonly { page: string; selector: string; why: string }[] = [];

/**
 * Pages in the roster that paint text directly on a gradient.
 *
 * Both are logo badges on a permanently dark wash — `.sa-login-logo--text` and
 * `.sa-setup-badge` — and both were unjudged until this checker learned to read
 * a gradient's stops. They are named here so the capability has a precondition
 * rather than only a consequence.
 */
const GRADIENT_TEXT_PAGES = new Set(['login', 'setup-wizard']);

/** Per-element colour facts, gathered in the page. */
interface Painted {
    path: string;
    color: string;
    background: string;
    contrast: number;
    text: string;
    /** Judged against a gradient stop rather than against a flat background. */
    viaGradient: boolean;
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

    // Quasar teleports every dialog, menu and tooltip to a node at `<body>`,
    // so a checker that walks `#visual-root` alone has never judged one — and
    // the package has twenty-one dialog sites. The visual baselines already
    // gather them this way; this one did not, which is why a case whose whole
    // subject is a dialog reported zero elements to judge.
    const dialogs = [...document.querySelectorAll('.q-dialog')].filter((d) => !root.contains(d));
    const painted: Painted[] = [];

    for (const el of [root, ...root.querySelectorAll('*')].concat(
        dialogs.flatMap((d) => [d, ...d.querySelectorAll('*')]),
    )) {
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

        // A gradient cannot be reduced to ONE background colour — but it can be
        // reduced to the handful of colours it is made of, and text has to be
        // readable on every one of them. The earlier version skipped any
        // element with a `background-image`, which was honest about not being
        // able to composite one but left the header, the drawer logo and both
        // logo badges unjudged. Those are painted permanently dark, so they are
        // exactly the surfaces where a role that flips goes unnoticed.
        //
        // So: read the stops the browser has already resolved, and judge each.
        // Anything that is not a gradient of solid colours — a `url()`, an
        // image — is still skipped, because there is no colour to compare to.
        const gradientStops: [number, number, number, number][] = [];
        if (style.backgroundImage !== 'none') {
            if (!/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/.test(style.backgroundImage))
                continue;
            const stops = style.backgroundImage.match(/(?:rgba?|color)\([^)]*\)/g) ?? [];
            if (stops.length === 0) continue;
            for (const stop of stops) {
                const colour = parse(stop);
                // A translucent stop needs the backdrop below it, which is what
                // `effectiveBackground` gives us for this element's ancestors.
                gradientStops.push(
                    colour[3] >= 1 ? colour : composite(colour, effectiveBackground(el)),
                );
            }
        }

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

        // One entry per element, not per colour stop: the light/dark comparison
        // below is keyed on the element path, and several rows sharing a path
        // would quietly collapse into whichever came last. A gradient therefore
        // reports its WORST stop — text has to survive all of them.
        const candidates = gradientStops.length > 0 ? gradientStops : [effectiveBackground(el)];
        const bg = candidates.reduce((worst, candidate) =>
            contrast(composite(fg, candidate), candidate) < contrast(composite(fg, worst), worst)
                ? candidate
                : worst,
        );
        painted.push({
            path: pathOf(el),
            color: style.color,
            background: `rgb(${bg.slice(0, 3).map(Math.round).join(', ')})`,
            contrast: Math.round(contrast(composite(fg, bg), bg) * 100) / 100,
            text: own.slice(0, 40),
            viaGradient: gradientStops.length > 0,
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
        // Sample after a paint, not just after a delay. `background: var(…)` is
        // a pending-substitution shorthand, and Chromium resolves those lazily:
        // under parallel load the paginator was caught with its text already on
        // the dark value and its background still white, twice in a row, and
        // "two identical readings" settled on the half-applied state. A frame
        // has to have been rendered for the substitution to be finished.
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
        );
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

            // The roster already knows how to open these — `revealBy` is the
            // field the visual baselines have used since they were written —
            // and this check simply never asked for it. So a surface behind one
            // click was unjudged for contrast while its computed styles were
            // under baseline, which is the shape of a guard that looks thorough
            // and is not: the fixture knows about the screen, and the checker
            // does not.
            for (const selector of visualCase.revealBy ?? []) {
                await page.locator(selector).first().click();
            }

            const light = await read(page);
            expect(
                light.painted.length,
                `${visualCase.id} rendered no text to judge`,
            ).toBeGreaterThan(5);

            // Preconditon for the pages that put text on a gradient: those
            // elements have to have been READ, not skipped. Without this, the
            // whole suite stays green if the gradient reading is removed again
            // — which is exactly the state it was in before, when every one of
            // these surfaces was silently excluded.
            if (GRADIENT_TEXT_PAGES.has(visualCase.id)) {
                expect(
                    light.painted.filter((p) => p.viaGradient).map((p) => p.path),
                    `${visualCase.id} paints text on a gradient, but nothing was judged ` +
                        'against a gradient stop — the reading fell back to skipping',
                ).not.toEqual([]);
            }

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

            // 4. And nothing disappears while the pointer is on it.
            //
            // Read in the DARK theme, which is where every hover defect found
            // so far has been: a tint over slate moves further than the same
            // tint over white. The page is already dark at this point.
            for (const selector of visualCase.hoverBy ?? []) {
                const target = page.locator(selector).first();
                await expect(
                    target,
                    `${visualCase.id}: nothing matches "${selector}" — the case names a hover ` +
                        'target its own fixture does not render',
                ).toBeVisible();
                // The precondition, and it has to be about the TARGET rather
                // than about the page.
                //
                // The first version asked "did anything change anywhere", and a
                // counter-check pointed `hoverBy` at a label with no hover rule
                // of its own — it PASSED, because putting the pointer there
                // fired a `:hover` on an ancestor card. A check that something
                // adjacent satisfies is the exact failure this suite exists to
                // catch, one state further in.
                //
                // So the subtree under the hovered element has to paint
                // differently. Descendants included, because a rule may restyle
                // only a child — `.sa-marketing-tf-chip:hover em` would.
                const subtreePaint = () =>
                    target.evaluate((el) =>
                        [el, ...el.querySelectorAll('*')]
                            .map((node) => {
                                const s = getComputedStyle(node);
                                return `${s.color}|${s.backgroundColor}|${s.borderTopColor}`;
                            })
                            .join('\n'),
                    );

                const atRest = await subtreePaint();
                await target.hover();
                const underPointer = await subtreePaint();
                expect(
                    underPointer,
                    `${visualCase.id}: hovering "${selector}" changed nothing on that element ` +
                        'or inside it — the selector resolves, but no rule fires, so the ' +
                        'reading below proves nothing',
                ).not.toBe(atRest);

                const hovered = await read(page);

                expect(
                    unreadable(hovered),
                    `${visualCase.id}: unreadable text while hovering "${selector}" (dark)`,
                ).toEqual([]);
            }
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

test.describe('a consumer can override a role', () => {
    // The documented recipe (docs/design-guide.md#overriding-a-role) and the
    // warning that comes with it, both pinned by measurement.
    //
    // The warning is the half worth testing: `:root` alone LOOKS like it works,
    // because it does in light mode and in one of the two dark paths. It fails
    // silently in the other — Quasar's trigger declares the roles on `<body>`,
    // and a value on a closer ancestor beats an inherited one whatever the
    // specificity says. A caveat nobody can reproduce becomes folklore and then
    // gets deleted; this one stays reproducible.

    const OVERRIDE = '--sa-color-negative';

    async function sweep(page: Page, css: string) {
        return page.evaluate(
            ({ css, name }) => {
                const sheet = document.createElement('style');
                sheet.textContent = css;
                document.head.appendChild(sheet);

                const target = document.querySelector('.sa-section') as HTMLElement;
                const read = () => getComputedStyle(target).getPropertyValue(name).trim();
                const set = (mode: 'light' | 'attribute' | 'quasar') => {
                    document.documentElement.removeAttribute('data-sa-theme');
                    document.body.classList.remove('body--dark');
                    if (mode === 'attribute') {
                        document.documentElement.setAttribute('data-sa-theme', 'dark');
                    }
                    if (mode === 'quasar') document.body.classList.add('body--dark');
                };

                const result = {
                    light: (set('light'), read()),
                    darkViaAttribute: (set('attribute'), read()),
                    darkViaQuasar: (set('quasar'), read()),
                };
                sheet.remove();
                set('light');
                return result;
            },
            { css, name: OVERRIDE },
        );
    }

    test('written per theme, it takes effect everywhere', async ({ page }) => {
        await page.goto('/?page=audit');
        await page.waitForSelector('body[data-visual-ready="true"]');

        const result = await sweep(
            page,
            `:root { ${OVERRIDE}: rgb(1, 2, 3); }\n` +
                `[data-sa-theme='dark'], body.body--dark { ${OVERRIDE}: rgb(4, 5, 6); }`,
        );

        expect(result).toEqual({
            light: 'rgb(1, 2, 3)',
            darkViaAttribute: 'rgb(4, 5, 6)',
            darkViaQuasar: 'rgb(4, 5, 6)',
        });
    });

    test('a runtime brand change reaches the accent — from the root', async ({ page }) => {
        // The documented runtime path, and the reason the third argument of
        // `setCssVar` is not optional. Quasar writes to `<body>` by default; the
        // accent role is computed on `:root`, one level above, and a custom
        // property resolves where it is DECLARED. Written below, it is invisible
        // — Quasar's own components would recolour and the admin would not.
        await page.goto('/?page=audit');
        await page.waitForSelector('body[data-visual-ready="true"]');

        const readings = await page.evaluate(() => {
            const target = document.querySelector('.sa-section') as HTMLElement;
            const read = () =>
                getComputedStyle(target).getPropertyValue('--sa-color-accent').trim();

            const before = read();
            document.body.style.setProperty('--q-primary', 'rgb(1, 2, 3)');
            const writtenToBody = read();
            document.body.style.removeProperty('--q-primary');

            document.documentElement.style.setProperty('--q-primary', 'rgb(4, 5, 6)');
            const writtenToRoot = read();
            document.documentElement.style.removeProperty('--q-primary');

            return { before, writtenToBody, writtenToRoot };
        });

        expect(readings.writtenToRoot, 'the documented runtime path does not work').toBe(
            'rgb(4, 5, 6)',
        );
        expect(
            readings.writtenToBody,
            'a brand written to <body> now reaches the accent. If that is so — check ' +
                'the selectors — the design guide can drop its warning about the third ' +
                'argument of setCssVar.',
        ).toBe(readings.before);
    });

    test('a legacy alias follows both dark triggers', async ({ page }) => {
        // `tokens.legacy.css` promises that reading an old `--sa-*` name keeps
        // working for one release. An alias is computed WHERE it is declared,
        // so one written only on `:root` substitutes the light value and is
        // then inherited as a finished value — Quasar's trigger redeclares the
        // roles on `<body>` and never re-evaluates it. A consumer still reading
        // `var(--sa-heading)` kept light text while everything around it went
        // dark, which is the opposite of the promise.
        await page.goto('/?page=audit');
        await page.waitForSelector('body[data-visual-ready="true"]');

        const readings = await page.evaluate(() => {
            const target = document.querySelector('.sa-section') as HTMLElement;
            const read = () => {
                const style = getComputedStyle(target);
                return {
                    alias: style.getPropertyValue('--sa-heading').trim(),
                    role: style.getPropertyValue('--sa-color-fg-heading').trim(),
                };
            };
            const set = (mode: 'light' | 'attribute' | 'quasar') => {
                document.documentElement.removeAttribute('data-sa-theme');
                document.body.classList.remove('body--dark');
                if (mode === 'attribute') {
                    document.documentElement.setAttribute('data-sa-theme', 'dark');
                }
                if (mode === 'quasar') document.body.classList.add('body--dark');
            };
            const result = {
                light: (set('light'), read()),
                darkViaAttribute: (set('attribute'), read()),
                darkViaQuasar: (set('quasar'), read()),
            };
            set('light');
            return result;
        });

        for (const [state, reading] of Object.entries(readings)) {
            expect(
                reading.alias,
                `the legacy alias and the role it aliases disagree in ${state}`,
            ).toBe(reading.role);
        }
        expect(
            readings.darkViaQuasar.alias,
            'the alias did not move at all — the two themes resolve it the same',
        ).not.toBe(readings.light.alias);
    });

    test('written on :root alone, it does not — and that is why the guide says so', async ({
        page,
    }) => {
        await page.goto('/?page=audit');
        await page.waitForSelector('body[data-visual-ready="true"]');

        const result = await sweep(page, `:root { ${OVERRIDE}: rgb(1, 2, 3); }`);

        expect(result.light, 'light mode is the case that makes this look fine').toBe(
            'rgb(1, 2, 3)',
        );
        expect(
            result.darkViaQuasar,
            'the override survived Quasar-triggered dark mode. If CSS or this ' +
                'stylesheet changed so that it now does, delete the warning from the ' +
                'design guide — it would be describing a problem that no longer exists.',
        ).not.toBe('rgb(1, 2, 3)');
    });
});
