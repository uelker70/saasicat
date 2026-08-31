// @requirement SC-UI-014 — The administration brings its own UI framework
// @requirement SC-UI-015 — One colour makes the administration look like the integrator's product

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { templatePaletteProps } from '../scripts/token-audit.mjs';

// Every Quasar colour the packages paint must resolve to something the theme
// decides.
//
// Quasar's `color="…"` prop reads its own `--q-*` variables, a second palette
// beside `--sa-color-*`. The two drifted unnoticed for as long as both existed:
// the scaffolder's `$warning` was `#f59e0b` while `--sa-color-warning` resolves
// to `#b45309`, so `color="warning"` painted 2.15:1 on white beside a role
// painting 4.8:1, and three places reached past both into Quasar's raw palette.
// A palette rung has no scheme — it is the same colour in dark mode.
//
// The brand bridge closes the gap by pointing Quasar's status slots at the
// roles. This asks whether anything still walks around it.
//
// The reader is `token-audit.mjs`'s, not one written here. Its own `color`
// counter lumps brand names and palette rungs together and its comment calls
// the split "a decision to take" — this is that decision, taken against the
// same parse. A second regex would be a second answer: the first draft of this
// file had one, and it missed every `:color="a ? 'positive' : 'grey'"` in the
// repository because a bound attribute is not a static one.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCES = ['packages/ui-vue/src', 'packages/ui-vue-tenant/src'];

const SEMANTIC = ['light', 'dark'].map((scheme) =>
    join(ROOT, `packages/ui-vue/src/ui/theme/tokens.semantic.${scheme}.css`),
);
/** The documents that tell a consumer which role to override. */
const GUIDES = ['docs/guides/upgrade-to-1.0.md', 'docs/explanation/design-guide.md'];

/**
 * Quasar colour names that carry no scheme because they have no lighter or
 * darker reading: the same instruction in both themes.
 */
const ABSOLUTE = new Set(['white', 'black', 'transparent']);

/**
 * Neutral greys still painted through Quasar's palette, as an upper bound.
 *
 * Three sites, all of them a status shown as a bare coloured `q-badge`:
 * `UsersPage` twice (the inactive badge and the default row-action icon) and
 * `PlatformEmailPage` once. `AdminStatusPill` is what they should be — its own
 * comment names this exact defect, "several of them a bare coloured q-badge,
 * which is colour carrying the meaning on its own" — and converting them is a
 * separate change from bundling Quasar. Until then: it does not grow.
 */
const NEUTRAL_CEILING = 3;

/**
 * `--q-<name>` slots the theme points at a `--sa-color-*` role.
 *
 * Read from the stylesheet, because that is where the mapping lives. It used to
 * be a table in the brand bridge, written inline on <html> at boot; four lines
 * of CSS do it without a literal to audit, without a `var()` that paints
 * nothing when the stylesheet is absent, and on both of the theme's selectors
 * rather than only the one <html> can see.
 */
function linkedTones() {
    const found = new Map();
    for (const file of SEMANTIC) {
        for (const line of readFileSync(file, 'utf8').split('\n')) {
            const match = /^\s*--q-([a-z]+):\s*var\(--sa-color-([a-z0-9-]+)\);/.exec(line);
            if (match) found.set(match[1], match[2]);
        }
    }
    return found;
}

/** Role names the semantic layer declares. */
function declaredRoles(file) {
    const found = new Set();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        const match = /^\s*--sa-color-([a-z0-9-]+):/.exec(line);
        if (match) found.add(match[1]);
    }
    return found;
}

/** Every Quasar colour prop in the shipped SFCs, static and bound alike. */
function paintedColours() {
    const found = [];
    for (const dir of SOURCES) {
        const base = join(ROOT, dir);
        for (const entry of readdirSync(base, { recursive: true })) {
            if (!String(entry).endsWith('.vue')) continue;
            const file = join(base, String(entry));
            const sites = templatePaletteProps(file, readFileSync(file, 'utf8'));
            for (const site of sites ?? []) {
                found.push({ ...site, file: `${dir}/${entry}` });
            }
        }
    }
    return found;
}

describe('quasar colours resolve to the theme', () => {
    const painted = paintedColours();
    const linked = linkedTones();

    test('the sources actually paint Quasar colours', () => {
        // The assertions below are all "nothing is wrong", and on an empty scan
        // every one of them is true. A moved directory, a renamed export or a
        // parser that returns `null` for every file would read as a clean bill
        // of health without this.
        assert.ok(painted.length > 20, `only ${painted.length} colour props found`);
        assert.ok(linked.size > 0, 'the brand bridge links no status tone at all');
    });

    test('no page paints a Quasar palette rung the theme cannot move', () => {
        const rungs = painted.filter((c) => /-[0-9]+$/.test(c.value) && !isNeutral(c.value));
        assert.deepEqual(
            rungs.map((c) => `${c.file}:${c.line} ${c.value}`),
            [],
            "a rung is a fixed step of Quasar's palette: it ignores the brand and does not " +
                'move between light and dark. Use the matching --sa-color-* role.',
        );
    });

    test('every painted colour is one the platform decides', () => {
        // `primary` is the consumer's brand, written by the bridge from
        // `brand.color`; the rest must be a linked status tone.
        const decided = new Set(['primary', ...linked.keys(), ...ABSOLUTE]);
        const strays = painted.filter((c) => !decided.has(c.value) && !isNeutral(c.value));
        assert.deepEqual(
            [...new Set(strays.map((c) => `${c.file}:${c.line} ${c.value}`))],
            [],
            'this name reads a --q-* variable nothing in the theme sets',
        );
    });

    test('the neutral greys do not grow', () => {
        const neutrals = painted.filter((c) => isNeutral(c.value));
        assert.ok(
            neutrals.length <= NEUTRAL_CEILING,
            `${neutrals.length} neutral palette colours, ceiling ${NEUTRAL_CEILING}:\n` +
                neutrals.map((c) => `  ${c.file}:${c.line} ${c.value}`).join('\n') +
                '\nUse AdminStatusPill rather than a bare coloured q-badge.',
        );
    });

    test('every linked tone is a role the theme declares', () => {
        // A link to a role that does not exist resolves to its fallback, which
        // is a copy — so the drift this file exists to prevent would be back,
        // silently, with the copy winning.
        //
        // WHERE it is declared is deliberately not asked here.
        // `tests/filled-status-carries-white-text.test.js` owns that question
        // and answers it precisely: on `:root` in the base layer and nowhere
        // else, because the bridge's inline var() on <html> reaches no further.
        // Two guards answering one question differently is how a rule stops
        // meaning anything.
        const declared = new Set(SEMANTIC.flatMap((file) => [...declaredRoles(file)]));
        assert.ok(declared.size > 0, 'no roles parsed from the semantic layer');
        for (const [tone, role] of linked) {
            assert.ok(
                declared.has(role),
                `--q-${tone} points at --sa-color-${role}, which no theme file declares`,
            );
        }
    });
});

/** Quasar's neutral ramp, which the ceiling above counts rather than forbids. */
function isNeutral(value) {
    return value === 'grey' || value.startsWith('grey-');
}

/**
 * Every `--sa-color-*` a guide names, in prose or in a code block.
 *
 * Not only declarations: a migration table row that says "override
 * `--sa-color-positive-solid`" is telling the reader exactly that, and a reader
 * searching for the name has to find it. One quantifier on one class after a
 * literal prefix — nothing here backtracks over a document.
 */
function rolesNamedIn(file) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    return new Set([...text.matchAll(/--sa-color-([a-z0-9-]+)/g)].map((match) => match[1]));
}

describe('the guides name the role the bridge actually reads', () => {
    // The failure this exists for: the bridge moved from `--sa-color-warning`
    // to `--sa-color-warning-solid`, and three documents kept telling consumers
    // to override the first. Following that guide changes a role Quasar never
    // reads, so the customised badge silently reverts to the platform default.
    //
    // The question is "does each link target appear in the guides", not "does
    // any status role appear that is not a link target". The second one was the
    // first draft, and it flagged the design guide teaching how to override a
    // role at all — where `--sa-color-negative` is an example of the mechanic
    // and overriding the foreground is exactly what the reader wants. A rule
    // that has to tell those apart is reading intent out of prose; this one
    // reads names out of a map.

    const linked = linkedTones();
    const documented = new Set(GUIDES.flatMap((file) => [...rolesNamedIn(file)]));

    test('the guides show some overrides', () => {
        // The assertion below is a lookup in this list. Empty, it fails for the
        // wrong reason — say so here instead.
        assert.ok(documented.size > 0, 'no --sa-color-* role named in any guide');
        assert.ok(linked.size > 0, 'the brand bridge links no status tone');
    });

    test('every role the bridge links is one a guide tells you to override', () => {
        const missing = [...linked.values()].filter((role) => !documented.has(role));
        assert.deepEqual(
            missing.map((role) => `--sa-color-${role}`),
            [],
            'the bridge reads this role and no guide shows it. A consumer who ' +
                'follows the migration changes something Quasar does not paint.',
        );
    });
});
