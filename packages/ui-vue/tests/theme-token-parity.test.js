// @requirement SC-UI-016 — Light and dark are both shipped, and a person can pick
// @requirement SC-A11Y-001 — Text is legible in both themes

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Rule 21 — the two themes describe the same world.
//
// A role that exists in the light theme and not in the dark one does not fail
// loudly: the dark rule simply never fires, the light value stays, and the
// result is dark-grey text on a dark card. Nothing throws, nothing logs, and
// the page looks fine to whoever wrote it — they were in light mode.
//
// So the key sets have to match exactly, and that has to be a test rather than
// a habit: the file is 150 declarations long and a role is added to whichever
// theme the author was looking at.
//
// The second rule here is that the dark theme fires only on a signal the
// APPLICATION sent — `[data-sa-theme]` or Quasar's `body--dark`. It carried a
// `prefers-color-scheme` block once, and that was wrong in exactly the case it
// was meant to serve: an app embedding `pages-tenant/*` loads this stylesheet
// without running the bridge, so the platform's surfaces went dark from the
// operating system while Quasar's cards, steppers and separators stayed light.
// Measured at the time: white card, rgb(226, 232, 240) text, about 1.15:1.
//
// A stylesheet cannot see the half of the screen it does not paint, so it must
// not decide for it. Following the OS lives in `createSaTheme` instead, where
// the bridge moves both halves together.

const LIGHT = fileURLToPath(new URL('../src/ui/theme/tokens.semantic.light.css', import.meta.url));
const DARK = fileURLToPath(new URL('../src/ui/theme/tokens.semantic.dark.css', import.meta.url));

/**
 * Custom-property declarations of a stylesheet, in order, as `name: value`.
 *
 * Comments are stripped first so that a commented-out declaration cannot count.
 * Whitespace is normalised — including inside parentheses — because Prettier
 * wraps a long `color-mix()` in one block and not in the other purely on line
 * width, and a test that called that a drift would cry wolf on every reformat.
 */
function declarations(css) {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...withoutComments.matchAll(/(--sa-[\w-]+)\s*:([^;]+);/g)].map((match) => {
        const value = match[2]
            .replace(/\s+/g, ' ')
            // Runs are single spaces by now, so a space is all a bracket can touch.
            .replace(/\( /g, '(')
            .replace(/ \)/g, ')')
            .trim();
        return `${match[1]}: ${value}`;
    });
}

const names = (list) => list.map((entry) => entry.split(':')[0]);

describe('light and dark declare the same roles', () => {
    const lightCss = readFileSync(LIGHT, 'utf8');
    const darkCss = readFileSync(DARK, 'utf8');

    const light = declarations(lightCss);
    const dark = declarations(darkCss);

    test('the files were actually read', () => {
        // Every assertion below compares two lists, and two empty lists are
        // equal. A renamed file or a changed declaration syntax would otherwise
        // report perfect parity between nothing and nothing.
        assert.ok(
            light.length > 60,
            `only ${light.length} roles found in the light theme — check the parser and the path`,
        );
        assert.ok(dark.length > 60, `only ${dark.length} roles in the dark theme`);
    });

    test('every light role has a dark counterpart, and the reverse', () => {
        const inLight = new Set(names(light));
        const inDark = new Set(names(dark));

        const missingInDark = [...inLight].filter((name) => !inDark.has(name));
        const missingInLight = [...inDark].filter((name) => !inLight.has(name));

        assert.deepEqual(
            missingInDark,
            [],
            'declared for light only — in dark these keep their light value, which is ' +
                'how a card ends up with dark text on a dark surface',
        );
        assert.deepEqual(
            missingInLight,
            [],
            'declared for dark only — these resolve to nothing in light mode',
        );
    });

    test('the theme fires only on a signal the application sent', () => {
        // Not a style preference: the platform paints half the screen and
        // Quasar paints the other half, and only the application can move both.
        // A media query here would move one of them.
        // Comments stripped first — the file explains at length why it does
        // not do this, and the first version of this check read its own
        // explanation as the violation.
        const rules = darkCss.replace(/\/\*[\s\S]*?\*\//g, '');
        assert.equal(
            /@media[^{]*prefers-color-scheme/.test(rules),
            false,
            'the dark theme reacts to the operating system again. An app that loads ' +
                'the stylesheet without the bridge — every consumer embedding ' +
                'pages-tenant/* — then gets dark platform surfaces under white Quasar ' +
                'cards. Put the OS preference in createSaTheme(), which moves both.',
        );

        const selectors = [...rules.matchAll(/^([^@/\s][^{]*)\{/gm)].map((m) => m[1].trim());
        assert.deepEqual(
            selectors,
            ["[data-sa-theme='dark'],\nbody.body--dark"],
            'the dark theme grew a trigger. Both existing ones mean "the application ' +
                'decided"; anything else decides for the application.',
        );
    });

    test('no role is declared twice within one theme', () => {
        for (const [label, list] of [
            ['light', light],
            ['dark', dark],
        ]) {
            const seen = new Set();
            const duplicates = names(list).filter((name) => !seen.add(name) && true);
            assert.deepEqual(
                duplicates,
                [],
                `${label} declares these roles more than once — the later one silently wins`,
            );
        }
    });
});
