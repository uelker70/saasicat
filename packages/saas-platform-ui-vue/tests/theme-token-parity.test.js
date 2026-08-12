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
// The dark theme also carries its declarations TWICE — once for the two
// selectors that can express "the app decided" and once inside
// `prefers-color-scheme`, because a media query is a condition on the
// environment and no selector can carry it. CSS offers no way to alias one set
// of declarations into a second at-rule. The duplicate is therefore checked for
// being identical, since the failure mode of a hand-maintained copy is that one
// half gets edited and it is always the half nobody opens.

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
    return [...withoutComments.matchAll(/(--sa-[\w-]+)\s*:\s*([^;]+);/g)].map((match) => {
        const value = match[2]
            .replace(/\s+/g, ' ')
            .replace(/\(\s+/g, '(')
            .replace(/\s+\)/g, ')')
            .trim();
        return `${match[1]}: ${value}`;
    });
}

const names = (list) => list.map((entry) => entry.split(':')[0]);

/** The `@media (prefers-color-scheme: dark)` block, and everything before it. */
function splitDarkFile(css) {
    const at = css.indexOf('@media (prefers-color-scheme: dark)');
    assert.notEqual(
        at,
        -1,
        'the dark theme no longer has a prefers-color-scheme block — an operating ' +
            'system set to dark would get the light theme unless the app asks for dark itself',
    );
    return { explicit: css.slice(0, at), system: css.slice(at) };
}

describe('light and dark declare the same roles', () => {
    const lightCss = readFileSync(LIGHT, 'utf8');
    const darkCss = readFileSync(DARK, 'utf8');
    const { explicit, system } = splitDarkFile(darkCss);

    const light = declarations(lightCss);
    const darkExplicit = declarations(explicit);
    const darkSystem = declarations(system);

    test('the files were actually read', () => {
        // Every assertion below compares two lists, and two empty lists are
        // equal. A renamed file or a changed declaration syntax would otherwise
        // report perfect parity between nothing and nothing.
        assert.ok(
            light.length > 60,
            `only ${light.length} roles found in the light theme — check the parser and the path`,
        );
        assert.ok(darkExplicit.length > 60, `only ${darkExplicit.length} roles in the dark theme`);
    });

    test('every light role has a dark counterpart, and the reverse', () => {
        const inLight = new Set(names(light));
        const inDark = new Set(names(darkExplicit));

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

    test('the two dark blocks are identical', () => {
        assert.deepEqual(
            darkSystem,
            darkExplicit,
            'the `prefers-color-scheme` copy of the dark theme has drifted from the ' +
                'explicit one. Whoever set their operating system to dark now sees a ' +
                'different product from whoever pressed the button.',
        );
    });

    test('no role is declared twice within one theme', () => {
        for (const [label, list] of [
            ['light', light],
            ['dark', darkExplicit],
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
