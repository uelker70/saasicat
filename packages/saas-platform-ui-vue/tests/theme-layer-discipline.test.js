import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Rule 22 — the layers only point one way.
//
//   L1  tokens.primitive.css / tokens.scale.css   reference nothing
//   L2  tokens.semantic.{light,dark}.css          reference L1 and --q-*
//   L3  base.css + components/*.css               reference L2
//   SFC <style> blocks                            reference L2 and L3
//
// The direction is the entire value of the split. A component that reaches past
// the role layer for `--sa-neutral-500` gets the right grey today and the wrong
// one the moment somebody enables dark mode — and it does that silently, in one
// rule, in one of 130 files. Nobody finds that by reading.
//
// The other half of the rule is that the role layer holds no literal. A `#fff`
// in `tokens.semantic.light.css` is a value that cannot be found from outside
// and cannot be answered for by the dark theme, and it is exactly how a token
// system decays back into what it replaced.

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const THEME = join(SRC, 'ui', 'theme');

const PRIMITIVE_LAYER = ['tokens.primitive.css', 'tokens.scale.css'];
const ROLE_LAYER = ['tokens.semantic.light.css', 'tokens.semantic.dark.css'];

/** Hex, and functional notations with literal channels. `rgb(var(--x)/.1)` is a
 *  token in use, not a literal, and counting it would forbid the shadow tints. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\((?![^)]*var\()[^)]*\)/g;

/**
 * Primitives that name a colour. The scales (`--sa-space-*`, `--sa-radius-*`,
 * `--sa-text-*`, `--sa-z-*`, `--sa-font-*`) are L1 too and are meant to be read
 * from anywhere: a padding does not change with the theme, so there is nothing
 * for a role layer to add.
 */
const COLOUR_PRIMITIVE =
    /var\(\s*(--sa-(?:white|black|neutral|blue|green|amber|red|indigo|violet|sky|brand)-?[\w-]*)/g;

function walk(dir, keep) {
    const found = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) found.push(...walk(full, keep));
        else if (keep(entry)) found.push(full);
    }
    return found;
}

/** `<style>` blocks of an SFC, or the whole text of a `.css` file. */
function styleSource(file, content) {
    if (file.endsWith('.css')) return content;
    return [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style[^>]*>/gi)]
        .map((m) => m[1])
        .join('\n');
}

const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function findings(file, pattern) {
    const css = withoutComments(styleSource(file, readFileSync(file, 'utf8')));
    return [...css.matchAll(pattern)].map((m) => `${relative(SRC, file)}: ${m[1] ?? m[0]}`);
}

describe('the token layers only point one way', () => {
    const themeFiles = walk(THEME, (name) => name.endsWith('.css'));
    const componentFiles = themeFiles.filter(
        (file) => ![...PRIMITIVE_LAYER, ...ROLE_LAYER].includes(basename(file)),
    );
    const consumers = walk(SRC, (name) => name.endsWith('.vue') || name.endsWith('.css')).filter(
        (file) => !file.startsWith(THEME),
    );

    test('the sweep reached all four layers', () => {
        // Every assertion below is a "found nothing" — and "found nothing"
        // reads identically to "looked nowhere". These floors sit well under
        // the real counts; they exist to catch a moved directory, not to pin
        // the file count.
        assert.equal(
            themeFiles.filter((f) => PRIMITIVE_LAYER.includes(basename(f))).length,
            PRIMITIVE_LAYER.length,
            'the primitive layer is not where this test looks for it',
        );
        assert.equal(
            themeFiles.filter((f) => ROLE_LAYER.includes(basename(f))).length,
            ROLE_LAYER.length,
            'the role layer is not where this test looks for it',
        );
        assert.ok(componentFiles.length >= 8, `only ${componentFiles.length} component sheets`);
        assert.ok(consumers.length >= 80, `only ${consumers.length} consuming files`);
    });

    test('L1 primitives reference nothing', () => {
        const file = join(THEME, 'tokens.primitive.css');
        assert.deepEqual(
            findings(file, /var\(\s*(--[\w-]+)/g),
            [],
            'a primitive that reads another variable is no longer a primitive — it is a ' +
                'role with an ambiguous name, and the layer below it can no longer be read alone',
        );
    });

    test('L2 roles contain no colour literal', () => {
        for (const name of ROLE_LAYER) {
            assert.deepEqual(
                findings(join(THEME, name), COLOUR_LITERAL),
                [],
                `${name} carries a literal colour. Every value here has to be a primitive, ` +
                    'a host brand variable, or a color-mix() of those — a literal is a value ' +
                    'nobody can find and the other theme cannot answer for.',
            );
        }
    });

    test('L3 component sheets contain no colour literal', () => {
        const offenders = componentFiles.flatMap((file) => findings(file, COLOUR_LITERAL));
        assert.deepEqual(offenders, [], 'the component layer paints from roles, not from values');
    });

    test('L3 component sheets do not reach past the roles into the palette', () => {
        const offenders = componentFiles.flatMap((file) => findings(file, COLOUR_PRIMITIVE));
        assert.deepEqual(
            offenders,
            [],
            'a component sheet naming a palette colour gets the right value in light mode ' +
                'and keeps it in dark mode. Ask for the role instead.',
        );
    });

    test('every font-size names a step of the type scale', () => {
        // The counting ratchet cannot express this once the migration is done:
        // it counts literals, and there are none. What is worth guarding from
        // here on is not the number of sizes but that nobody writes one — the
        // package reached 23 sizes by each author picking a number that looked
        // right next to the last one.
        // Collect every size, then filter — a `(?!var\()` lookahead after a
        // `\s*` is not the guard it looks like: the whitespace backtracks and
        // the lookahead passes on the space, so every tokenised size reported
        // itself as a violation.
        const offenders = [...componentFiles, ...consumers]
            .flatMap((file) => findings(file, /font-size:\s*([^;}]+)/g))
            .filter((entry) => !/:\s*var\(--sa-text-/.test(entry));
        assert.deepEqual(
            offenders,
            [],
            'a literal font size. Pick the step that says what the text IS — ' +
                '`--sa-text-sm` for a table cell, `--sa-text-xl` for a page title.',
        );
    });

    test('the package does not use its own deprecation shims', () => {
        // `tokens.legacy.css` keeps the pre-role names alive for ONE release,
        // for consumers. The package migrated off them — 809 references — and
        // the claim that it is "purely a courtesy to consumers now" was, until
        // this test, only a claim. The first violation appeared the same day.
        //
        // It is not a visual bug: an alias resolves to its role. It is a delayed
        // one. The file is deleted in 1.0, and every reference here becomes a
        // property that resolves to nothing — a background silently turning
        // transparent, months after the line was written.
        const legacy = new Set(
            [
                ...withoutComments(readFileSync(join(THEME, 'tokens.legacy.css'), 'utf8')).matchAll(
                    /^\s{4}(--sa-[\w-]+)\s*:/gm,
                ),
            ].map((m) => m[1]),
        );
        assert.ok(legacy.size > 20, `only ${legacy.size} legacy aliases parsed`);

        const offenders = [...componentFiles, ...consumers].flatMap((file) =>
            findings(file, /var\(\s*(--sa-[\w-]+)/g).filter((entry) =>
                legacy.has(entry.split(': ')[1]),
            ),
        );
        assert.deepEqual(
            offenders,
            [],
            'a deprecated alias inside the package. Use the role it points at — ' +
                'the alias is a courtesy to consumers and goes away in 1.0.',
        );
    });

    test('a foreground role is never used as a background', () => {
        // `background: var(--sa-color-fg-heading)` is right in light and white
        // on white in dark, and it is how seven rules were written after the
        // migration mapped each literal on its own.
        //
        // The paired-contrast test measures the same class, but only where one
        // rule sets both halves. This one also reaches the split case — a
        // `.pd-diff-icon { color }` in one rule and a
        // `.pd-diff-row.mod .pd-diff-icon { background }` in another — which is
        // exactly where the last one hid.
        //
        // To paint a surface in a text colour, ask for the inverse family; that
        // is what it is for, and it does not flip.
        const offenders = [...componentFiles, ...consumers].flatMap((file) =>
            findings(file, /background(?:-color)?\s*:[^;}]*var\(\s*(--sa-color-fg-[\w-]+)/g),
        );
        assert.deepEqual(
            offenders,
            [],
            'a foreground role painting a background. Use `--sa-color-inverse-*` ' +
                'for a surface that is dark on purpose, or a `-surface` role for a tint.',
        );
    });

    test('surfaces that do not follow the theme use only roles that do not flip', () => {
        // Some surfaces are painted the same in both themes on purpose: the
        // header, the drawer, the login and setup backdrops are dark; the
        // production banner is loud red; the diff hero is loud amber. A role
        // that flips is therefore wrong on any of them by construction: `--sa-color-border` is a light grey in light mode and
        // `--sa-neutral-700` in dark, so a drawer icon painted with it went
        // from readable to about 1.8:1 on a surface that never moved.
        //
        // That is not hypothetical — it is how three foregrounds here were
        // written, and neither the baselines nor the contrast check found them:
        // `AdminLayout` is a layout, so it is in no page roster. A source rule
        // is the guard that reaches it.
        // "Flips" is derived, not listed: a role counts only if the two theme
        // files really give it different values. The first version flagged any
        // non-inverse role and reported `--sa-color-fg-on-accent`, which is
        // white in both — an allow-list would have hidden that the rule was
        // asking the wrong question.
        const valuesOf = (name) =>
            new Map(
                [
                    ...withoutComments(readFileSync(join(THEME, name), 'utf8')).matchAll(
                        /(--sa-color-[\w-]+)\s*:\s*([^;]+);/g,
                    ),
                ].map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim()]),
            );
        const lightValues = valuesOf('tokens.semantic.light.css');
        const darkValues = valuesOf('tokens.semantic.dark.css');
        const flips = new Set(
            [...lightValues.keys()].filter(
                (role) => lightValues.get(role) !== darkValues.get(role),
            ),
        );
        assert.ok(flips.size > 30, `only ${flips.size} roles differ between the themes`);

        // A surface can also be moved out from under a role by the CONSUMER,
        // and that is the half this rule first missed: `--sa-color-fg-on-accent`
        // is white in both themes, so it is not a flip — but the design guide
        // tells a light brand to override it to something dark, and the setup
        // badge painted it on a gradient that stays dark. Follow the
        // documentation and the initials disappear.
        //
        // Derived, not listed, for the same reason as above: a role is the
        // consumer's if its value reaches Quasar's `--q-` brand chain, or if
        // its name says it is defined against the accent.
        const reachesBrand = (role, seen = new Set()) => {
            if (seen.has(role)) return false;
            seen.add(role);
            const value = lightValues.get(role) ?? '';
            if (value.includes('var(--q-')) return true;
            return [...value.matchAll(/var\(\s*(--sa-color-[\w-]+)/g)].some((m) =>
                reachesBrand(m[1], seen),
            );
        };
        const consumerOwned = new Set(
            [...lightValues.keys()].filter(
                (role) => /-on-accent$/.test(role) || reachesBrand(role),
            ),
        );
        assert.ok(
            consumerOwned.has('--sa-color-accent') && consumerOwned.has('--sa-color-fg-on-accent'),
            'the brand chain was not detected — the rule would pass vacuously',
        );

        const INVARIANT_SURFACE =
            /^\s*\.sa-(admin-header|admin-drawer|admin-banner|login-wrap|login-logo|setup-wrap|setup-badge|pv-diff__hero)/;
        const offenders = [];

        for (const file of consumers) {
            const css = withoutComments(styleSource(file, readFileSync(file, 'utf8')));
            // Rule by rule, so a selector is judged with its own declarations.
            for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                const [, selector, body] = match;
                if (!INVARIANT_SURFACE.test(selector)) continue;
                for (const role of body.matchAll(/var\(\s*(--sa-color-[\w-]+)/g)) {
                    const why = flips.has(role[1])
                        ? 'flips between the themes'
                        : consumerOwned.has(role[1])
                          ? 'belongs to the consumer\u2019s brand'
                          : null;
                    if (!why) continue;
                    offenders.push(
                        `${relative(SRC, file)}: ${selector.trim()} uses ${role[1]}, which ${why}`,
                    );
                }
            }
        }

        assert.deepEqual(
            offenders,
            [],
            'a surface that never moves, painted with a role that can. Use the ' +
                '`--sa-color-inverse-*` family, which is declared identically in both ' +
                'themes and is not the consumer\u2019s to rebrand.',
        );
    });

    test('pages and components do not reach past the roles into the palette', () => {
        const offenders = consumers.flatMap((file) => findings(file, COLOUR_PRIMITIVE));
        assert.deepEqual(
            offenders,
            [],
            'a page naming a palette colour is the failure this split exists to prevent: ' +
                'invisible in review, and wrong in exactly one theme',
        );
    });

    // ── The brand is not a foreground on its own tint ────────────────────────
    //
    // `--sa-color-accent` is the host's `$primary`, and it is the one role that
    // does NOT change between themes — that is the point of a brand. Everything
    // around it does. So on a light card it reads at about 4.5:1 and on the dark
    // theme's slate it lands near 3.4:1; on a tint of itself it is worse still,
    // and a tint of itself is exactly what a selected state is made of.
    //
    // The guide already names the answer: `--sa-color-accent-strong` is "accent
    // text on a tint", and it mixes the brand toward the theme's own extreme —
    // darker in light, lighter in dark — so it follows the host's brand while
    // staying readable.
    //
    // This was written after the same mistake turned up in six rules at once:
    // the promo dialog's selected duration and plan chips, the dashboard's KPI
    // and shortcut icons, a status pill and an onboarding eyebrow. Every one had
    // been reviewed; none of them looked wrong in light mode.
    test('no rule paints --sa-color-accent as text on an accent surface', () => {
        const offenders = [];
        const files = walk(SRC, (name) => name.endsWith('.vue') || name.endsWith('.css'));
        for (const file of files) {
            const css = withoutComments(styleSource(file, readFileSync(file, 'utf8')));
            for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                const paintsAccentText =
                    /(?:^|;|\s)color\s*:\s*var\(--sa-color-accent\)\s*(?:;|$)/.test(body);
                const onAccentTint =
                    /(?:^|;|\s)background(?:-color)?\s*:\s*var\(--sa-color-accent-surface[\w-]*\)/.test(
                        body,
                    );
                if (paintsAccentText && onAccentTint) {
                    offenders.push(
                        `${relative(SRC, file)}  ${selector.trim().replace(/\s+/g, ' ')}`,
                    );
                }
            }
        }
        assert.deepEqual(
            offenders,
            [],
            'the brand colour is being used as text on a tint of itself. Use ' +
                '`--sa-color-accent-strong`, which the design guide names for exactly this ' +
                'and which lightens in the dark theme instead of staying put.',
        );
    });
});
