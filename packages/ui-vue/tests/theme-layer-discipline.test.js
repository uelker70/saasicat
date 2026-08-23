import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';

import {
    QUASAR_PALETTE_NAMES,
    inlineStyleFragments,
    isQuasarComponent,
} from '../../../scripts/token-audit.mjs';

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

/**
 * Every declaration an SFC writes — its `<style>` blocks AND its inline
 * `style="…"` attributes — or the whole text of a `.css` file.
 *
 * The attributes were missing, and the rule below that reads this paid for it:
 * `every font-size names a step of the type scale` was green while four
 * `style="font-size: 22px"` sat in two templates, and the design guide
 * published that as "no `font-size` in the package names a number". A guard
 * satisfied exactly in the damaging case, plus a sentence about it.
 *
 * The fragments come from `token-audit.mjs` so the ratchet that COUNTS a
 * literal and the rule that FORBIDS one read the same bytes with the same
 * parser. Two answers to "where does this package write CSS" is how a number
 * and a rule end up guarding different files.
 *
 * Joined with `;` because an attribute has no trailing terminator, and each
 * fragment goes on its own line so a rule-by-rule reader below cannot glue two
 * of them into one.
 */
function styleSource(file, content) {
    if (file.endsWith('.css')) return content;
    const blocks = [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style[^>]*>/gi)].map((m) => m[1]);
    const inline = (inlineStyleFragments(file, content) ?? []).map(({ text }) => `${text};`);
    return [...blocks, ...inline].join('\n');
}

const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * A `font-size` declaration, and what makes one acceptable.
 *
 * A CSS property name is ASCII case-insensitive, so `FONT-SIZE: 22px` sets the
 * same thing `font-size: 22px` does. Without the `i` flag it slipped past the
 * rule below, while `docs/explanation/design-guide.md` published that rule as "no
 * `font-size:` declaration in the package names a number" — a guard with a hole
 * and a sentence about it, which is the combination this file keeps paying for.
 *
 * The second pattern stays case-SENSITIVE, and that asymmetry is the point: a
 * custom property name is not case-insensitive, so `var(--SA-TEXT-MD)` reads a
 * property nobody declared and is a finding rather than a token in use.
 */
const FONT_SIZE_DECLARATION = /font-size:\s*([^;}]+)/gi;
const NAMES_A_TYPE_STEP = /:\s*var\(--sa-text-/;

function findingsIn(label, css, pattern) {
    return [...withoutComments(css).matchAll(pattern)].map((m) => `${label}: ${m[1] ?? m[0]}`);
}

function findings(file, pattern) {
    return findingsIn(relative(SRC, file), styleSource(file, readFileSync(file, 'utf8')), pattern);
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

    test('the sweep reached the inline styles too', () => {
        // The half `styleSource` was missing. Same argument as above and one
        // step sharper: an SFC the parser cannot read yields `null`, which the
        // `?? []` above turns into "this file writes no inline CSS" — the exact
        // shape of failure every rule in this file would report as clean.
        const sfcs = consumers.filter((file) => file.endsWith('.vue'));
        const unreadable = sfcs.filter(
            (file) => inlineStyleFragments(file, readFileSync(file, 'utf8')) === null,
        );
        assert.deepEqual(
            unreadable.map((file) => relative(SRC, file)),
            [],
            'an SFC the template parser could not read — its inline styles were skipped, ' +
                'and a skipped attribute reads exactly like a clean one',
        );

        // The other direction, on a fixture rather than on the package. This
        // used to count how many SFCs still contribute an attribute and require
        // at least ten — a floor under the package's own debt, so the day
        // enough of those attributes became classes the rules above would all
        // improve and this one would fail. A guard that forbids the cleanup it
        // exists to measure teaches the next contributor to lower it, which is
        // the one move a guard may never invite.
        //
        // The fixture cannot go clean behind the guard's back, and it asserts
        // the whole chain rather than the filter alone: the template parses,
        // the `style` attribute is picked out, `styleSource` joins it in with
        // the terminator an attribute does not carry, and the rule below reads
        // it. Break any link and this reports `[]` — which is what a clean
        // package reports too, and why the assertion has to be made where a
        // literal is guaranteed.
        const inlineOnly = '<template>\n    <p style="font-size: 22px">x</p>\n</template>\n';
        assert.deepEqual(
            findingsIn('F.vue', styleSource('F.vue', inlineOnly), FONT_SIZE_DECLARATION),
            ['F.vue: 22px'],
            'a literal inside a static `style` attribute is no longer reaching the rules in ' +
                'this file — every one of them would report the package as clean',
        );
    });

    test("the audit's Quasar palette is Quasar's", () => {
        // `token-audit.mjs` counts `class="text-grey-7"` as a colour decision,
        // and it needs a vocabulary of palette names to do it. That list is
        // written out there — a counting script must not fail because a package
        // moved in `node_modules` — but it is not allowed to be a memory, so
        // the expectation is derived HERE, from the stylesheet Quasar ships.
        //
        // The criterion separates a colour from a typographic utility without
        // naming either: Quasar emits a colour as BOTH `.text-x` and `.bg-x`,
        // while `.text-bold`, `.text-center` and `.text-weight-medium` have no
        // background twin. A hand-written exclusion list would have had to know
        // about all nineteen of those.
        const require = createRequire(import.meta.url);
        const css = readFileSync(require.resolve('quasar/dist/quasar.css'), 'utf8');
        const backgrounds = new Set();
        const foregrounds = new Set();
        for (const m of css.matchAll(/\.(bg|text)-([a-z][a-z-]*?)(?:-\d{1,2})?(?![\w-])/g)) {
            (m[1] === 'bg' ? backgrounds : foregrounds).add(m[2]);
        }
        const palette = [...backgrounds].filter((name) => foregrounds.has(name)).sort();

        assert.ok(
            palette.length > 25,
            `only ${palette.length} palette colours parsed out of quasar.css — the sweep, not the palette, changed`,
        );
        assert.deepEqual(
            [...QUASAR_PALETTE_NAMES].sort(),
            palette,
            'the palette list in scripts/token-audit.mjs no longer matches the Quasar release ' +
                'this package builds against. Every name it lost is a colour class the audit ' +
                'stopped counting.',
        );
    });

    test("the audit's idea of a Quasar component is Quasar's", () => {
        // `color="grey-7"` is a palette decision on one of Quasar's components
        // and an ordinary prop name on anybody else's, so `token-audit.mjs` has
        // to answer "is this tag Quasar's" before it counts one. It answers by
        // PREFIX rather than by a list of the component names — a list would go
        // stale in the direction that costs most, silently dropping the next
        // component to reach a template while the number stayed flat.
        //
        // The prefix is a convention of somebody else's library, which makes it
        // a claim rather than a fact, so it is asserted against the release
        // this package builds against — the same move the palette test above
        // makes, one level up. The count is checked first: a web-types file
        // that stopped parsing yields no components, and "every one of zero
        // components satisfies the rule" is how a derivation passes vacuously.
        const require = createRequire(import.meta.url);
        const webTypes = JSON.parse(
            readFileSync(require.resolve('quasar/dist/web-types/web-types.json'), 'utf8'),
        );
        const components = (webTypes.contributions?.html?.tags ?? []).map((tag) => tag.name);
        assert.ok(
            components.length > 100,
            `only ${components.length} components parsed out of Quasar's web-types — the ` +
                'sweep, not the library, changed',
        );
        assert.deepEqual(
            components.filter((name) => !isQuasarComponent(name)),
            [],
            'a Quasar component whose tag does not carry the `q-` prefix the audit derives ' +
                'from. Every palette prop on it is a decision the audit has stopped counting.',
        );

        // The other direction, which the list above cannot give: the prefix has
        // to be `q-` and not `q`, or the check swallows every component whose
        // name merely starts with the letter.
        assert.equal(isQuasarComponent('my-chart'), false);
        assert.equal(isQuasarComponent('QuasarLike'), false);
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
        //
        // Counter-check first, on the two shapes the real sweep cannot be
        // relied on to contain: the package writes no capitalised property
        // today, so the `i` flag would be an untested claim without this, and a
        // rule that reads nothing reports the same empty list as a clean tree.
        const sizesIn = (css) =>
            [...css.matchAll(FONT_SIZE_DECLARATION)]
                .map((m) => `x: ${m[1]}`)
                .filter((entry) => !NAMES_A_TYPE_STEP.test(entry));
        assert.deepEqual(sizesIn('.a { FONT-SIZE: 22px; }'), ['x: 22px']);
        assert.deepEqual(sizesIn('.a { font-size: var(--sa-text-2xl); }'), []);

        const offenders = [...componentFiles, ...consumers]
            .flatMap((file) => findings(file, FONT_SIZE_DECLARATION))
            .filter((entry) => !NAMES_A_TYPE_STEP.test(entry));
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
                        /(--sa-color-[\w-]+)\s*:([^;]+);/g,
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
            for (const match of css.matchAll(/(?<=^|[{}])([^{}]+)\{([^{}]*)\}/g)) {
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
            for (const [, selector, body] of css.matchAll(/(?<=^|[{}])([^{}]+)\{([^{}]*)\}/g)) {
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
