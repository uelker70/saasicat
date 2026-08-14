import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    IDENTITY_ACCENTS,
    IDENTITY_ACCENT_VALUES,
    IDENTITY_NEUTRAL,
    IDENTITY_NEUTRAL_VALUE,
    identityChipStyle,
} from '../dist/client/index.js';

// Every pairing of a role background with a role foreground, resolved to real
// numbers and measured — in both themes, without rendering anything.
//
// This exists because the colour migration created PAIRINGS that nobody chose.
// The map decided each literal on its own, so a rule that had been
// `background: #0f172a; color: #fff` became `background: var(--sa-color-fg-heading)`.
// Correct in light, and white-on-white the moment the dark theme gave that role
// a near-white value. Fourteen readings across seven rules were under 3:1 when
// this test was first run, in four separate components.
//
// It is the source-level twin of `tests-e2e/theme-contrast.spec.ts`, and the
// two catch different things. The browser one sees what is actually on screen,
// including inheritance and Quasar's own paint, but only for elements a page
// renders at rest — it never saw any of these, because they sit behind a tab,
// a toast or an active state. This one sees every rule in the package and
// nothing about the page.
//
// The floor is the same 3:1, and for the same reason: it is the line below
// which text is not hard to read but gone.

const CONTRAST_FLOOR = 3;

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const THEME = join(SRC, 'ui', 'theme');

const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function declarationsOf(name) {
    const css = withoutComments(readFileSync(join(THEME, name), 'utf8'));
    return [...css.matchAll(/(--sa-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
        m[1],
        m[2].replace(/\s+/g, ' ').trim(),
    ]);
}

/** Token tables for the two themes: primitives and scales, then the roles. */
function themeTables() {
    const base = declarationsOf('tokens.primitive.css');
    const light = new Map([...base, ...declarationsOf('tokens.semantic.light.css')]);
    const dark = new Map([...light, ...declarationsOf('tokens.semantic.dark.css')]);
    return { light, dark };
}

function hexToRgba(hex) {
    let value = hex.trim();
    if (value.length === 4) value = `#${[...value.slice(1)].map((c) => c + c).join('')}`;
    return [
        parseInt(value.slice(1, 3), 16),
        parseInt(value.slice(3, 5), 16),
        parseInt(value.slice(5, 7), 16),
        1,
    ];
}

/**
 * Resolves a token expression to `[r, g, b, a]`, or `null` when it is not a
 * colour this resolver understands.
 *
 * Handles the three forms the theme actually uses: a hex literal, a `var()`
 * with an optional fallback, and the `color-mix(in srgb, X n%, Y)` that every
 * tint and every shadow is built from.
 */
function resolveColour(expression, table, depth = 0) {
    if (!expression || depth > 12) return null;
    const value = expression.trim();
    if (value.startsWith('#')) return hexToRgba(value);
    if (value === 'transparent') return [0, 0, 0, 0];

    const asVar = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(value);
    if (asVar) {
        const declared = table.get(asVar[1]);
        if (declared !== undefined) return resolveColour(declared, table, depth + 1);
        return asVar[2] ? resolveColour(asVar[2], table, depth + 1) : null;
    }

    const asMix = /^color-mix\(\s*in srgb,\s*([\s\S]+?)\s+([\d.]+)%,\s*([\s\S]+?)\s*\)$/.exec(
        value,
    );
    if (asMix) {
        const first = resolveColour(asMix[1], table, depth + 1);
        const second = resolveColour(asMix[3], table, depth + 1);
        if (!first || !second) return null;
        const share = Number(asMix[2]) / 100;
        const alpha = first[3] * share + second[3] * (1 - share);
        if (alpha === 0) return [0, 0, 0, 0];
        return [
            ...[0, 1, 2].map(
                (i) => (first[i] * first[3] * share + second[i] * second[3] * (1 - share)) / alpha,
            ),
            alpha,
        ];
    }
    return null;
}

/** Splits at commas that sit outside any parentheses. */
function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (char === '(') depth += 1;
        else if (char === ')') depth -= 1;
        else if (char === ',' && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

const GRADIENT = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(([\s\S]*)\)$/;

/**
 * Every opaque colour a text can end up sitting on, given a `background` value.
 *
 * A gradient is not one background but several, and until now it was none: the
 * pattern here demanded a value starting with `var(--sa-`, so
 * `background: var(--sa-admin-header-bg, linear-gradient(…))` resolved to
 * `null` and the rule was skipped in silence. That is the shape of the header,
 * the drawer logo, the login badge and the diff hero — in other words, exactly
 * the surfaces that produced C10, C19 and C20. Both contrast checkers were
 * blind to them, from opposite ends: this one could not read a gradient, and
 * the browser one skips any element with a `background-image`.
 *
 * Every stop is judged rather than an average of them, because a gradient
 * renders all of its stops somewhere by construction. Passing on the mean would
 * be a verdict about a colour that appears nowhere on screen.
 */
function backgroundColours(expression, table, depth = 0) {
    if (!expression || depth > 12) return [];
    const value = expression.trim();

    // Layered backgrounds: `background: <gradient>, <gradient>`. Judging every
    // layer is the conservative direction — it can only add candidates.
    const layers = splitTopLevel(value);
    if (layers.length > 1) return layers.flatMap((l) => backgroundColours(l, table, depth + 1));

    const gradient = GRADIENT.exec(value);
    if (gradient) {
        return splitTopLevel(gradient[1]).flatMap((argument) =>
            // A stop is a colour followed by optional positions; the direction
            // (`90deg`, `to right`, `in oklab`) is an argument that is not a
            // colour. Both are handled by simply trying to resolve them: what
            // is not a colour returns nothing and drops out.
            backgroundColours(argument.trim().replace(/(\s+[^\s()]+)+$/, ''), table, depth + 1),
        );
    }

    // A `var()` whose value may itself be a gradient, so this cannot delegate
    // to `resolveColour` — that one only ever yields a single colour.
    const asVar = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(value);
    if (asVar) {
        const declared = table.get(asVar[1]);
        if (declared !== undefined) return backgroundColours(declared, table, depth + 1);
        return asVar[2] ? backgroundColours(asVar[2], table, depth + 1) : [];
    }

    const rgba = resolveColour(value, table, depth);
    return rgba ? [{ label: value, rgba }] : [];
}

const relativeLuminance = ([r, g, b]) => {
    const channel = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const flatten = (over, under) => [
    ...[0, 1, 2].map((i) => over[3] * over[i] + (1 - over[3]) * under[i]),
    1,
];

function contrast(a, b) {
    const [brighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
    return (brighter + 0.05) / (darker + 0.05);
}

function walk(dir) {
    const found = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) found.push(...walk(full));
        else if (/\.(vue|css)$/.test(entry)) found.push(full);
    }
    return found;
}

const styleSource = (file, content) =>
    file.endsWith('.css')
        ? content
        : [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style[^>]*>/gi)]
              .map((m) => m[1])
              .join('\n');

/** Rules that set BOTH a background and a colour, each from a role. */
function rolePairedRules() {
    const rules = [];
    for (const file of walk(SRC)) {
        const css = withoutComments(styleSource(file, readFileSync(file, 'utf8')));
        for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            // ANY `var(--sa-…)`, not only a bare role. Most of the admin
            // chrome wraps its roles in a consumer knob —
            // `var(--sa-admin-user-avatar-bg, var(--sa-color-inverse-accent))`
            // — and a pattern anchored on `--sa-color-` saw none of it. That is
            // where the avatar hid: white initials on amber at 1.67:1, two
            // lines below a badge paired correctly. The resolver already walks
            // a fallback chain, so it decides what this cannot.
            // The whole value, not a value that must START with `var(--sa-`.
            // The narrower pattern was what hid every gradient: a background
            // written as `var(--knob, linear-gradient(…))` matched it, resolved
            // to null one step later, and left no trace of having been skipped.
            const background = /(?:^|;|\s)background(?:-color)?\s*:\s*([^;]+?)\s*(?:;|$)/.exec(
                body,
            );
            const foreground = /(?:^|;|\s)color\s*:\s*(var\(--sa-[^;]+?)\s*(?:;|$)/.exec(body);
            if (!background || !foreground) continue;
            rules.push({
                file: relative(SRC, file),
                selector: selector.trim().replace(/\s+/g, ' '),
                background: background[1],
                isGradient: /-gradient\(/.test(background[1]),
                foreground: foreground[1],
            });
        }
    }
    return rules;
}

describe('a role background and a role foreground stay readable together', () => {
    const { light, dark } = themeTables();
    const rules = rolePairedRules();

    test('the sweep found rules and can resolve the palette', () => {
        // Both halves matter. Zero rules would pass every assertion below, and
        // so would a resolver that returns null for everything.
        assert.ok(rules.length > 150, `only ${rules.length} role-paired rules found`);
        assert.deepEqual(resolveColour('var(--sa-color-bg-surface)', light), [255, 255, 255, 1]);
        assert.ok(
            resolveColour('var(--sa-color-negative-surface)', dark)[3] < 1,
            'a color-mix() tint no longer resolves to a translucent colour',
        );
    });

    test('gradient backgrounds are read, not skipped', () => {
        // Without this the gradient support can rot back to `null` and every
        // assertion below stays green — which is precisely how the surfaces
        // behind C10, C19 and C20 went unjudged in the first place.
        //
        // Six is the measured number of rules that paint a gradient AND name a
        // foreground in the same rule: the production banner, the header, the
        // drawer logo, the login badge, the setup badge and the draft segment
        // of the plan timeline. The package has 19 gradient backgrounds; the
        // other 13 set no `color`, so they are the split-rule shape from C14
        // and belong to the invariance rule in `theme-layer-discipline`, which
        // reads role names and therefore sees through a gradient too.
        const gradients = rules.filter((r) => r.isGradient);
        assert.ok(gradients.length >= 6, `only ${gradients.length} gradient-backed rules found`);

        const judged = gradients.filter((r) => backgroundColours(r.background, light).length > 1);
        assert.ok(
            judged.length >= 6,
            `only ${judged.length} gradients yielded more than one colour stop`,
        );

        // The direction argument must not be mistaken for a stop, and a stop's
        // position must not stop it being read.
        assert.deepEqual(
            backgroundColours(
                'linear-gradient(90deg, var(--sa-color-inverse-bg) 0%, #ffffff 100%)',
                light,
            ).map((c) => c.rgba),
            [resolveColour('var(--sa-color-inverse-bg)', light), [255, 255, 255, 1]],
        );
    });

    for (const [themeName, tokens] of [
        ['light', light],
        ['dark', dark],
    ]) {
        test(`nothing falls under ${CONTRAST_FLOOR}:1 in the ${themeName} theme`, () => {
            const failures = [];
            let judged = 0;

            for (const rule of rules) {
                const foreground = resolveColour(rule.foreground, tokens);
                if (!foreground) continue;

                for (const stop of backgroundColours(rule.background, tokens)) {
                    // A translucent background sits on a backdrop this file
                    // cannot know — the element's parent. Guessing the page
                    // surface would report `.pve-tab--active .pve-tab-count`
                    // (a white wash inside a dark tab) as white-on-white, which
                    // is a verdict about the guess rather than about the code.
                    // Those stay with the browser check, which sees the real
                    // ancestor.
                    if (stop.rgba[3] < 1) continue;

                    judged += 1;
                    const ratio = contrast(flatten(foreground, stop.rgba), stop.rgba);
                    if (ratio < CONTRAST_FLOOR) {
                        failures.push(
                            `${ratio.toFixed(2)}:1  ${rule.file}  ${rule.selector}\n` +
                                `            ${rule.foreground} on ${stop.label}`,
                        );
                    }
                }
            }

            assert.ok(judged > 100, `only ${judged} pairings were opaque enough to judge`);
            assert.deepEqual(
                failures,
                [],
                `unreadable role pairings in the ${themeName} theme. A foreground role ` +
                    'used as a background is the usual cause — `--sa-color-fg-heading` is ' +
                    'near-black in light and near-white in dark, so a rule that pairs it ' +
                    'with `--sa-color-fg-on-accent` is white on white in one of the two.',
            );
        });
    }
});

// ─── The one foreground that is computed rather than declared ────────────────
//
// `identityChipStyle()` is the only place in the package that decides a text
// colour in JavaScript, and everything above is a sweep of CSS RULES — so the
// sweep cannot see it, and neither can the browser check, which skips an
// element whose background is translucent. The helper's background IS
// translucent by construction: it is an 8 % wash of the same accent it paints
// the text with. That blind spot is what let the chip go on painting an accent
// on a wash of itself, and it survived the rule-level fix that put
// `--sa-color-accent-strong` into the selected states around it, because an
// inline `style` beats a class.
//
// The helper is also the only one whose input is not a role. A
// `var(--sa-color-identity-N)` has a value per theme and comes out readable on
// its own; a stored plan colour is a fixed hex chosen against the LIGHT theme,
// and a consumer's `planAccents` can be any colour at all. So the assertions
// below are of two kinds: real product values, and a bound over the whole cube.

describe('the identity chip stays readable on its own tint', () => {
    const { light, dark } = themeTables();

    // The chip is drawn on a card (`.pc-plan-opt`, the plan list row, a tenant
    // avatar) or on the raised variant of one. Both are judged, and raised is
    // the harder of the two in either theme: it sits between the plain surface
    // and the mixed text, so it leaves the text less room.
    const SURFACES = ['var(--sa-color-bg-surface)', 'var(--sa-color-bg-surface-raised)'];

    /** The helper's own foreground on the helper's own background, flattened. */
    function chipContrast(accent, tokens, surfaceExpression) {
        const style = identityChipStyle(accent);
        const surface = resolveColour(surfaceExpression, tokens);
        const wash = resolveColour(style.background, tokens);
        const foreground = resolveColour(style.color, tokens);
        if (!surface || !wash || !foreground) return null;
        const background = flatten(wash, surface);
        return contrast(flatten(foreground, background), background);
    }

    test('the helper no longer hands back the bare accent as text', () => {
        // The regression has one shape: `color: accent`. Naming it directly
        // means the guard fails on the edit itself rather than only on whichever
        // colour happens to drop under the floor.
        for (const accent of [...IDENTITY_ACCENTS, ...IDENTITY_ACCENT_VALUES]) {
            assert.notEqual(
                identityChipStyle(accent).color,
                accent,
                'the chip text is the accent itself again, painted on a wash of that ' +
                    'same accent, so it follows the theme only when the caller happens ' +
                    'to pass a role',
            );
        }
    });

    test('the resolver reaches real numbers for both input shapes', () => {
        // Without this every assertion below could pass on nulls, and a `var()`
        // input and a hex input travel different branches of the resolver.
        assert.ok(chipContrast('var(--sa-color-identity-1)', light, SURFACES[0]) > 1);
        assert.ok(chipContrast('#10b981', dark, SURFACES[0]) > 1);
    });

    for (const [themeName, tokens] of [
        ['light', light],
        ['dark', dark],
    ]) {
        test(`every colour the product itself stores clears ${CONTRAST_FLOOR}:1 in ${themeName}`, () => {
            const failures = [];
            for (const accent of [
                ...IDENTITY_ACCENTS,
                IDENTITY_NEUTRAL,
                ...IDENTITY_ACCENT_VALUES,
                IDENTITY_NEUTRAL_VALUE,
            ]) {
                for (const surface of SURFACES) {
                    const ratio = chipContrast(accent, tokens, surface);
                    if (ratio < CONTRAST_FLOOR) {
                        failures.push(`${ratio.toFixed(2)}:1  ${accent} on ${surface}`);
                    }
                }
            }
            assert.deepEqual(
                failures,
                [],
                "the stored half of the identity ramp is the light theme's values by " +
                    'design, so in the dark theme these are light-theme colours on a dark ' +
                    'surface — the case the token half never exercises.',
            );
        });

        test(`no colour in sRGB falls under ${CONTRAST_FLOOR}:1 in ${themeName}`, () => {
            // `planAccents` is a public prop and takes any CSS colour, so the
            // guarantee has to be a bound rather than a sample. The extremes are
            // the degenerate accents — an accent that already IS the theme's own
            // extreme cannot be pushed further away from the surface — and both
            // corners are in the grid below.
            let worst = { ratio: Infinity };
            const STEP = 51;
            for (let r = 0; r <= 255; r += STEP) {
                for (let g = 0; g <= 255; g += STEP) {
                    for (let b = 0; b <= 255; b += STEP) {
                        const accent = `#${[r, g, b]
                            .map((c) => c.toString(16).padStart(2, '0'))
                            .join('')}`;
                        for (const surface of SURFACES) {
                            const ratio = chipContrast(accent, tokens, surface);
                            if (ratio < worst.ratio) worst = { ratio, accent, surface };
                        }
                    }
                }
            }
            assert.ok(
                worst.ratio >= CONTRAST_FLOOR,
                `${worst.ratio.toFixed(2)}:1 for ${worst.accent} on ${worst.surface} — the ` +
                    'share of the accent that survives into the text is too high for an ' +
                    'input nobody curates',
            );
        });
    }
});
