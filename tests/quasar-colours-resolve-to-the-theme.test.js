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
const BRIDGE = join(ROOT, 'packages/ui-vue/src/client/brand-bridge.ts');
const SEMANTIC = ['light', 'dark'].map((scheme) =>
    join(ROOT, `packages/ui-vue/src/ui/theme/tokens.semantic.${scheme}.css`),
);

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

/** `--q-<name>` slots the bridge points at a `--sa-color-*` role. */
function linkedTones() {
    const found = new Map();
    for (const line of readFileSync(BRIDGE, 'utf8').split('\n')) {
        const match = /^\s*([a-z]+):\s*'var\(--sa-color-([a-z0-9-]+)\)',/.exec(line);
        if (match) found.set(match[1], match[2]);
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

    test('every linked tone is a role both schemes declare', () => {
        // A link to a role that does not exist resolves to nothing and Quasar
        // paints transparent. Both files, because a role declared only in light
        // is a dark theme with a hole in it.
        for (const file of SEMANTIC) {
            const roles = declaredRoles(file);
            assert.ok(roles.size > 0, `no roles parsed from ${file}`);
            for (const [tone, role] of linked) {
                assert.ok(
                    roles.has(role),
                    `--q-${tone} points at --sa-color-${role}, which ${file} does not declare`,
                );
            }
        }
    });
});

/** Quasar's neutral ramp, which the ceiling above counts rather than forbids. */
function isNeutral(value) {
    return value === 'grey' || value.startsWith('grey-');
}
