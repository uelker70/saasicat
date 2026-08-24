import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { withoutComments } from '../scripts/gen-docs/design-tokens.mjs';

// A filled status surface has to carry white text — in BOTH themes.
//
// The status roles are foregrounds: text and icons, tuned against the page, so
// they go lighter in the dark theme. Quasar uses its `--q-*` the other way
// round, as a background with white text on it. Point one at the other and the
// dark theme drops below the floor: white on `--sa-amber-400` is 1.67:1.
//
// That is measured, not feared. Linking the plain roles is what the brand
// bridge did first, and the browser contrast sweep failed `users`,
// `promo-codes` and `platform-email` in the dark theme. `-solid` is the role
// that answers it, and this is what keeps it answering.

const THEME = (scheme) =>
    fileURLToPath(
        new URL(`../packages/ui-vue/src/ui/theme/tokens.semantic.${scheme}.css`, import.meta.url),
    );
const PRIMITIVES = fileURLToPath(
    new URL('../packages/ui-vue/src/ui/theme/tokens.primitive.css', import.meta.url),
);

/** WCAG's floor for normal-size text. */
const FLOOR = 4.5;
const WHITE = '#ffffff';

/** `--name: value;` declarations, one per line. */
function declarations(path) {
    const found = new Map();
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const match = /^\s*(--[a-z0-9-]+):([^;]+);/.exec(line);
        if (match) found.set(match[1], match[2].trim());
    }
    return found;
}

const primitives = declarations(PRIMITIVES);

/** Resolves a single `var(--x)` indirection down to the literal it names. */
function resolve(value) {
    const named = /^var\((--[a-z0-9-]+)\)$/.exec(value.trim());
    if (!named) return value.trim();
    return primitives.get(named[1]) ?? value.trim();
}

function luminance(hex) {
    const channels = [1, 3, 5]
        .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
        .map((channel) =>
            channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
        );
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Every `--sa-color-*-solid` the semantic layer declares, resolved to a hex. */
function solidFills(scheme) {
    const found = new Map();
    for (const [name, value] of declarations(THEME(scheme))) {
        if (!name.endsWith('-solid')) continue;
        found.set(name, resolve(value));
    }
    return found;
}

describe('filled status surfaces carry white text', () => {
    const fills = solidFills('light');
    const inDarkFile = solidFills('dark');

    test('the base layer declares some', () => {
        // Every assertion below iterates this map. Empty, it passes silently,
        // and a renamed suffix would read as "all fills are legible".
        assert.ok(fills.size >= 4, `only ${fills.size} filled status roles declared`);
    });

    test('each resolves to a literal colour rather than another variable', () => {
        for (const [name, value] of fills) {
            assert.match(value, /^#[0-9a-f]{6}$/i, `${name} did not resolve: ${value}`);
        }
    });

    test('white on each clears the floor', () => {
        for (const [name, value] of fills) {
            const ratio = contrast(value, WHITE);
            assert.ok(
                ratio >= FLOOR,
                `${name} is ${value}: white on it reads ${ratio.toFixed(2)}:1, below ` +
                    `${FLOOR}:1. Quasar paints this as a background with white text.`,
            );
        }
    });

    test('both themes declare them, with the same value', () => {
        // The plain roles differ by design; these must not. A fill that flipped
        // would carry the dark theme's lighter rung under the same white text —
        // 1.67:1 for warning, which is what the browser sweep caught.
        //
        // Both files, and not one: Quasar's components live under the body, and
        // a custom property resolves on the element it is declared on. A
        // consumer overriding this on `body.body--dark` has to be heard there.
        assert.deepEqual(
            [...inDarkFile.entries()].sort(),
            [...fills.entries()].sort(),
            'the two themes disagree about a filled status surface',
        );
    });

    test('each theme hands the same four to Quasar, in its own block', () => {
        // The mapping is CSS, so it is declared once per selector rather than
        // written to <html> at boot. Both blocks must carry it, or an override
        // on the other selector is silently ignored.
        for (const scheme of ['light', 'dark']) {
            const css = readFileSync(THEME(scheme), 'utf8');
            for (const [name] of fills) {
                const tone = name.replace('--sa-color-', '').replace('-solid', '');
                assert.ok(
                    css.includes(`--q-${tone}: var(${name});`),
                    `${scheme} does not hand --q-${tone} to Quasar`,
                );
                assert.equal(
                    selectorFor(css, `--q-${tone}`),
                    selectorFor(css, name),
                    `${scheme} declares --q-${tone} and ${name} in different blocks`,
                );
            }
        }
    });
});

/**
 * The selector of the block a declaration sits in.
 *
 * Comments are blanked BEFORE the braces are counted, not after. This file's
 * own theme carries a commented-out example selector complete with its `{`, and
 * that brace is the nearest one before several real declarations — so a scan
 * that reads comments reports the example as the block.
 */
function selectorFor(source, name) {
    const css = withoutComments(source);
    const at = css.indexOf(`${name}:`);
    if (at === -1) return null;
    const opens = css.lastIndexOf('{', at);
    return css.slice(css.lastIndexOf('}', opens) + 1, opens).trim();
}
