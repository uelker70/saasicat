// A generated admin imports every stylesheet the package makes it responsible for.
//
// The components are built now (ADR 0011), so their styles arrive as a file the
// consumer imports rather than as source their build compiles. The scaffolder's
// template was not brought along: a freshly generated admin installed three
// packages it no longer needs and rendered the standard pages unstyled. Nothing
// caught it — `scaffold-typechecks` compiles the result, and a missing
// stylesheet import compiles perfectly.
//
// Derived from the export map rather than listed. `./style.css`, `./theme.css`,
// `./quasar.css` and `./icons.css` are what the package hands out as
// stylesheets; a fifth would be covered the day it is added, and a renamed one
// fails here rather than in somebody's browser.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = join(ROOT, 'packages/ui-vue/package.json');
const ENTRY = join(ROOT, 'packages/create-saasicat-admin/templates/src/main.ts.tpl');
const EXAMPLE = join(ROOT, 'examples/notesapp/admin/src/main.ts');

/** The `.css` subpaths `@saasicat/ui-vue` publishes, as full specifiers. */
function stylesheetSubpaths() {
    const { exports: map } = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    return Object.keys(map)
        .filter((key) => key.endsWith('.css') && !key.includes('*'))
        .map((key) => `@saasicat/ui-vue${key.slice(1)}`)
        .sort();
}

/**
 * The specifiers a file imports for their side effect — `import 'x';`.
 *
 * Line by line rather than a multiline pattern: `/^\s*import…/gm` is what the
 * repository's own `regexp/no-super-linear-move` rule refuses, and it refused
 * this one. Splitting first gives each line a fixed start, so there is nothing
 * for a quantifier to move across.
 */
function sideEffectImports(file) {
    const imports = new Set();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        const code = line.trim();
        if (!code.startsWith('import ')) continue;
        const rest = code.slice('import '.length).trim();
        const quote = rest[0];
        if (quote !== "'" && quote !== '"') continue; // a named import, not a side effect
        const end = rest.indexOf(quote, 1);
        if (end !== -1) imports.add(rest.slice(1, end));
    }
    return imports;
}

describe('every entry point imports the stylesheets the package publishes', () => {
    const stylesheets = stylesheetSubpaths();

    test('the export map still publishes stylesheets', () => {
        // Vacuously true against an empty list, which is what a renamed
        // condition or a restructured map would leave behind.
        assert.ok(
            stylesheets.length >= 3,
            `only ${stylesheets.length} stylesheet subpaths found: ${stylesheets.join(', ')}`,
        );
    });

    for (const [label, file] of [
        ['the scaffolder template', ENTRY],
        ['the example admin', EXAMPLE],
    ]) {
        test(`${label} imports all of them`, () => {
            const imported = sideEffectImports(file);
            const missing = stylesheets.filter((sheet) => !imported.has(sheet));
            assert.deepEqual(
                missing,
                [],
                `${label} does not import ${missing.join(', ')}. A missing stylesheet compiles ` +
                    'cleanly and renders as an unstyled page, which is the one failure a build ' +
                    'cannot report.',
            );
        });

        test(`${label} loads the theme after Quasar's stylesheet`, () => {
            // Not a preference. The theme hands Quasar its four status colours
            // (`--q-warning: var(--sa-color-warning-solid)`), and Quasar
            // declares the same four on `:root` in its own file. Equal
            // specificity, so the later declaration wins — and the earlier one
            // wins nothing. Reversed, every `color="warning"` in the admin
            // silently paints Quasar's stock amber next to a role that does not
            // match it, which is the exact drift this arrangement removed.
            const order = [...sideEffectImports(file)];
            const quasar = order.indexOf('@saasicat/ui-vue/quasar.css');
            const theme = order.indexOf('@saasicat/ui-vue/theme.css');
            assert.ok(quasar !== -1 && theme !== -1, `${label} is missing one of the two`);
            assert.ok(
                quasar < theme,
                `${label} imports theme.css before quasar.css, so Quasar's own defaults win`,
            );
        });

        test(`${label} takes them from this package, not from Quasar`, () => {
            // The old template imported `quasar/src/css/index.sass` and
            // `@quasar/extras/…`, which a consumer can no longer resolve: they
            // do not install either.
            const foreign = [...sideEffectImports(file)].filter(
                (specifier) => specifier.startsWith('quasar/') || specifier.startsWith('@quasar/'),
            );
            assert.deepEqual(
                foreign,
                [],
                `${label} imports ${foreign.join(', ')} — packages a consumer no longer ` +
                    'installs since ADR 0011.',
            );
        });
    }
});
