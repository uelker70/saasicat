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
// It is the source-level twin of `tests/e2e/theme-contrast.spec.ts`, and the
// two catch different things. The browser one sees what is actually on screen,
// including inheritance and Quasar's own paint, but only for elements a page
// renders at rest — it never saw any of these, because they sit behind a tab,
// a toast or an active state. This one sees every rule in the package and
// nothing about the page.
//
// The floor is the same 3:1, and for the same reason: it is the line below
// which text is not hard to read but gone.
//
// Every pairing this file finds is therefore either measured or named. A skip
// that leaves no trace turns a checker into a decoration: it keeps passing, and
// the passing says nothing about the rules it stopped reading.

const CONTRAST_FLOOR = 3;

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const THEME = join(SRC, 'ui', 'theme');

const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function declarationsOf(name) {
    const css = withoutComments(readFileSync(join(THEME, name), 'utf8'));
    return [...css.matchAll(/(--sa-[\w-]+)\s*:([^;]+);/g)].map((m) => [
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

    const asVar = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/.exec(value);
    if (asVar) {
        const declared = table.get(asVar[1]);
        if (declared !== undefined) return resolveColour(declared, table, depth + 1);
        return asVar[2] ? resolveColour(asVar[2], table, depth + 1) : null;
    }

    const asMix = colourMix(value);
    if (asMix) {
        const first = resolveColour(asMix.first, table, depth + 1);
        const second = resolveColour(asMix.second, table, depth + 1);
        if (!first || !second) return null;
        const share = asMix.share;
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

/**
 * `color-mix(in srgb, <first> <share>%, <second>)` taken apart at its top-level
 * commas, so a `var(--x, fallback)` inside an argument keeps its own comma.
 * Null for anything else, including a fourth argument.
 */
function colourMix(value) {
    if (!value.startsWith('color-mix(') || !value.endsWith(')')) return null;
    const args = splitTopLevel(value.slice('color-mix('.length, -1)).map((a) => a.trim());
    if (args.length !== 3 || args[0] !== 'in srgb') return null;
    const stop = /^([\s\S]*\S)\s+([\d.]+)%$/.exec(args[1]);
    if (!stop) return null;
    return { first: stop[1], share: Number(stop[2]) / 100, second: args[2] };
}

/**
 * A gradient stop without its positions: the trailing whitespace-separated
 * tokens that contain no parenthesis, so `var(--x) 20% 40%` keeps `var(--x)`
 * and `#fff` keeps itself. A trailing space ends the walk, as the anchored
 * pattern this replaces never matched past one.
 */
function withoutStopPositions(argument) {
    let end = argument.length;
    for (;;) {
        let at = end;
        while (at > 0 && !/\s/.test(argument[at - 1])) at -= 1;
        const token = argument.slice(at, end);
        let before = at;
        while (before > 0 && /\s/.test(argument[before - 1])) before -= 1;
        if (token === '' || before === at || /[()]/.test(token)) return argument.slice(0, end);
        end = before;
    }
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
 * Whether a gradient argument is a parameter rather than a colour stop.
 *
 * A gradient's argument list mixes the two: `90deg`, `to bottom right`,
 * `in oklab longer hue`, `circle closest-side at 50% 50%`, `from 45deg` and the
 * bare `50%` interpolation hint are not colours, and everything else in the
 * list is. Telling them apart on syntax is the whole point — the earlier
 * version told them apart by handing each to the resolver and dropping whatever
 * came back empty, which made a stop whose token was renamed indistinguishable
 * from a direction. That is the silence this file exists to remove, reproduced
 * one level down.
 *
 * This half is the safer half to enumerate: the CSS grammar keeps the set of
 * gradient parameters closed, while the set of colour syntaxes grows with every
 * colour level. And it errs in the direction that gets looked at — a parameter
 * mistaken for a stop is reported as unresolvable and someone reads it, whereas
 * a stop mistaken for a parameter says nothing at all.
 */
const isGradientParameter = (argument) =>
    // An angle, a length, a percentage or a position. No colour starts this way.
    /^[-+.\d]/.test(argument) ||
    /^(?:to|in|at|from|circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner)\b/i.test(
        argument,
    );

/**
 * Every colour a text can end up sitting on, given a `background` value — one
 * entry per stop, with `rgba: null` for a stop that could not be read.
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
 *
 * And an unreadable stop is reported rather than dropped, because a background
 * is not all-or-nothing. `linear-gradient(90deg, var(--a), var(--b))` with only
 * `--a` declared used to come back as one perfectly readable stop and a
 * nonempty result, so the caller's "did the background yield anything?" check
 * was satisfied and half the strip went unmeasured with nothing to say so —
 * measured on `.sa-admin-banner--prod`, the one rule whose white text has no
 * second chance. The number of stops in now equals the number of outcomes out.
 */
function backgroundColours(expression, table, depth = 0) {
    if (!expression || depth > 12) return [];
    const value = expression.trim();

    // `background: none` is the shorthand resetting the layer to its initial
    // value, which is `transparent` — so it paints nothing and the backdrop is
    // whatever the ancestor paints. Saying that as a transparent stop rather
    // than as an empty result puts it on the same footing as every other
    // translucent background: counted, named, and left to the browser check.
    // Only `none` is spelled out, because only `none` occurs; anything else the
    // resolver cannot read is meant to fail loudly below.
    if (value === 'none') return [{ label: value, rgba: [0, 0, 0, 0] }];

    // Layered backgrounds: `background: <gradient>, <gradient>`. Judging every
    // layer is the conservative direction — it can only add candidates.
    const layers = splitTopLevel(value);
    if (layers.length > 1) return layers.flatMap((l) => backgroundColours(l, table, depth + 1));

    const gradient = GRADIENT.exec(value);
    if (gradient) {
        return splitTopLevel(gradient[1]).flatMap((raw) => {
            const argument = raw.trim();
            if (isGradientParameter(argument)) return [];
            // What is left is a colour stop: a colour followed by optional
            // positions. It owes an outcome whether or not it can be read.
            const stop = withoutStopPositions(argument);
            const read = backgroundColours(stop, table, depth + 1);
            return read.length > 0 ? read : [{ label: stop, rgba: null }];
        });
    }

    // A `var()` whose value may itself be a gradient, so this cannot delegate
    // to `resolveColour` — that one only ever yields a single colour.
    const asVar = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/.exec(value);
    if (asVar) {
        const declared = table.get(asVar[1]);
        if (declared !== undefined) return backgroundColours(declared, table, depth + 1);
        if (asVar[2]) return backgroundColours(asVar[2], table, depth + 1);
        return [{ label: value, rgba: null }];
    }

    return [{ label: value, rgba: resolveColour(value, table, depth) }];
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

/**
 * A declaration value without its priority.
 *
 * The captures below run to the semicolon, so `!important` travels with the
 * value and every resolver pattern is anchored — `var(…) !important` matches
 * none of them and used to resolve to `null`. That is one of the four rules
 * this sweep dropped in silence, and the priority says nothing about the
 * colour, so it comes off before anything tries to read it.
 */
const withoutPriority = (value) => value.replace(/!\s*important\s*$/i, '').trimEnd();

/** Rules that set BOTH a background and a colour, each from a role. */
function rolePairedRules() {
    const rules = [];
    for (const file of walk(SRC)) {
        const css = withoutComments(styleSource(file, readFileSync(file, 'utf8')));
        for (const [, selector, body] of css.matchAll(/(?<=^|[{}])([^{}]+)\{([^{}]*)\}/g)) {
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
            const background = /(?<=^|[;\s])background(?:-color)?\s*:([^;]*)(?=;|$)/.exec(body);
            const foreground = [...body.matchAll(/(?<=^|[;\s])color\s*:([^;]*)(?=;|$)/g)]
                .map((match) => match[1].trim())
                .find((declared) => declared.startsWith('var(--sa-'));
            if (!background || !foreground) continue;
            const backgroundValue = withoutPriority(background[1].trim());
            rules.push({
                file: relative(SRC, file),
                selector: selector.trim().replace(/\s+/g, ' '),
                background: backgroundValue,
                isGradient: /-gradient\(/.test(backgroundValue),
                foreground: withoutPriority(foreground),
            });
        }
    }
    return rules;
}

// Why a pairing can be counted and still not measured. The first is a decision
// this file makes on purpose; the other two are the checker admitting it could
// not read a value, and the assertions below hold both at zero.
const NO_OPAQUE_BACKDROP = 'paints no opaque background of its own';
const UNREADABLE_FOREGROUND = 'the foreground value did not resolve to a colour';
const UNREADABLE_BACKGROUND = 'the background value yielded no colour';

/**
 * One outcome per pairing of a rule with a background stop: either a measured
 * `ratio` or a stated `reason` for not measuring.
 *
 * Returning the reasons instead of `continue`-ing past them is the whole point.
 * Every earlier version dropped an unreadable value in silence, and four rules
 * — one `!important`, three `background: none` — sat outside the sweep for as
 * long as it existed with nothing to say so. A checker that looks away has to
 * leave a mark, or "no failures" and "no verdicts" read the same from outside.
 *
 * The mark is per STOP, not per background. Asking only whether the background
 * yielded any colour at all leaves the mixed case unnamed: one readable stop
 * next to one whose token was renamed satisfies the question and hides the
 * other half of a gradient. So the reason below is raised for the individual
 * stop that could not be read, and `background:` prefixes the whole value only
 * when there was no stop to name.
 */
function outcomesFor(rule, tokens) {
    const foreground = resolveColour(rule.foreground, tokens);
    if (!foreground) {
        return [{ reason: UNREADABLE_FOREGROUND, detail: `color: ${rule.foreground}` }];
    }

    const stops = backgroundColours(rule.background, tokens);
    if (stops.length === 0) {
        return [{ reason: UNREADABLE_BACKGROUND, detail: `background: ${rule.background}` }];
    }

    return stops.map((stop) => {
        const detail = `${rule.foreground} on ${stop.label}`;
        if (!stop.rgba) return { reason: UNREADABLE_BACKGROUND, detail };
        // A translucent background sits on a backdrop this file cannot know —
        // the element's parent. Guessing the page surface would report
        // `.pve-tab--active .pve-tab-count` (a white wash inside a dark tab) as
        // white-on-white, which is a verdict about the guess rather than about
        // the code. Those stay with the browser check, which sees the real
        // ancestor.
        if (stop.rgba[3] < 1) return { reason: NO_OPAQUE_BACKDROP, detail };
        return { ratio: contrast(flatten(foreground, stop.rgba), stop.rgba), detail };
    });
}

const describeOutcome = (rule, outcome) =>
    `${rule.file}  ${rule.selector}\n            ${outcome.detail}`;

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

        // Derived from the sweep rather than counted against a remembered
        // number: CSS requires two colour stops for a gradient to be valid, so
        // every one of them owes more than one stop, and the ones that do not
        // are named. The earlier form asserted `>= 6` — which happened to equal
        // the total, so losing any single stop tripped it, but only by
        // coincidence and with a message that named no rule.
        const thin = gradients
            .filter((r) => backgroundColours(r.background, light).length < 2)
            .map((r) => `${r.file}  ${r.selector}`);
        assert.deepEqual(thin, [], 'a gradient background was parsed into fewer than two stops');

        // The direction argument must not be mistaken for a stop, and a stop's
        // position must not stop it being read.
        assert.deepEqual(
            backgroundColours(
                'linear-gradient(90deg, var(--sa-color-inverse-bg) 0%, #ffffff 100%)',
                light,
            ).map((c) => c.rgba),
            [resolveColour('var(--sa-color-inverse-bg)', light), [255, 255, 255, 1]],
        );

        // The mixed case, asserted directly rather than only through the sweep:
        // a stop that cannot be read is still a stop. Dropping it left the
        // result nonempty, so the caller's "did this yield a colour?" question
        // was answered yes and the other half of the gradient went unmeasured.
        assert.deepEqual(
            backgroundColours(
                'linear-gradient(90deg, var(--sa-color-inverse-bg), var(--sa-nothing-declares-this))',
                light,
            ).map((c) => c.rgba),
            [resolveColour('var(--sa-color-inverse-bg)', light), null],
        );

        // An interpolation hint and a colour space are parameters, not stops —
        // otherwise the rule above would report every one of them unreadable.
        assert.deepEqual(
            backgroundColours('linear-gradient(in oklab, #000000 0%, 50%, #ffffff)', light).map(
                (c) => c.rgba,
            ),
            [
                [0, 0, 0, 1],
                [255, 255, 255, 1],
            ],
        );
    });

    for (const [themeName, tokens] of [
        ['light', light],
        ['dark', dark],
    ]) {
        const outcomes = rules.map((rule) => ({ rule, outcomes: outcomesFor(rule, tokens) }));
        const skipped = outcomes.flatMap(({ rule, outcomes: list }) =>
            list.filter((outcome) => outcome.reason).map((outcome) => ({ rule, outcome })),
        );

        test(`nothing falls under ${CONTRAST_FLOOR}:1 in the ${themeName} theme`, () => {
            const failures = [];
            let judged = 0;

            for (const { rule, outcomes: list } of outcomes) {
                for (const outcome of list) {
                    if (outcome.reason) continue;
                    judged += 1;
                    if (outcome.ratio < CONTRAST_FLOOR) {
                        failures.push(
                            `${outcome.ratio.toFixed(2)}:1  ${describeOutcome(rule, outcome)}`,
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

        test(`every pairing the ${themeName} sweep leaves unjudged says why`, () => {
            // Structural, and the reason this is not simply a count: a future
            // branch that skips a pairing without recording anything produces a
            // rule with no outcome at all, and the sweep above would go quiet
            // about it exactly the way it went quiet about the four.
            const unaccounted = outcomes
                .filter(({ outcomes: list }) => list.length === 0)
                .map(({ rule }) => `${rule.file}  ${rule.selector}`);
            assert.deepEqual(
                unaccounted,
                [],
                'a paired rule produced neither a ratio nor a reason — the sweep grew a ' +
                    'branch that drops a pairing without saying so',
            );

            // The two reasons that mean the checker could not read the value.
            // Zero, and named individually rather than counted, because the
            // number alone would say a rule went unjudged without saying which.
            const unreadable = skipped
                .filter(({ outcome }) => outcome.reason !== NO_OPAQUE_BACKDROP)
                .map(({ rule, outcome }) => `${outcome.reason}: ${describeOutcome(rule, outcome)}`);
            assert.deepEqual(
                unreadable,
                [],
                `the ${themeName} sweep found values it could not resolve. Every one of ` +
                    'these is a pairing nothing measures — neither this file nor the ' +
                    'browser check, which only sees what a page renders at rest. A ' +
                    'declaration priority is the known cause: the captures run to the ' +
                    'semicolon, so `!important` arrives attached to the value and every ' +
                    'resolver pattern here is anchored.',
            );

            // Counted for the same reason `reach` is counted in
            // `design-token-budget.test.js`: derived from the findings, "nothing
            // was skipped" and "nothing was looked at" are the same reading. If
            // the alpha test ever stops firing, these translucent stops get
            // judged against a backdrop nobody knows, and the floor is what
            // says so.
            const deliberate = skipped.length - unreadable.length;
            assert.ok(
                deliberate >= 20,
                `only ${deliberate} pairings were held back for a backdrop this file cannot ` +
                    'know — the translucency test is no longer reaching them',
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
