// The SFC build rewrites a page's deep imports of `src/client/`, `src/vue/` and
// `src/quasar/` to the package's own public entries
// (`scripts/own-layer-entries.mjs`), so a module those layers keep private
// reaches the built page as a name its entry does not export. Nothing fails at
// build time or in a unit test: the browser refuses the module when an
// application loads the page, and the whole administration stays blank.
//
// So the built output is read here, and every name it imports from one of the
// package's own entries has to be one that entry exports.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/** The package's own entries the SFC build rewrites to, and the file each one is. */
const OWN_ENTRIES = {
    '@saasicat/ui-vue': '../dist/index.js',
    '@saasicat/ui-vue/quasar': '../dist/quasar/index.js',
};

/** Every `.js` file of the SFC build: the pages, the layouts, the auth screens and their chunks. */
function builtSfcFiles() {
    return ['pages', 'layouts', 'auth', 'ui', 'chunks']
        .filter((directory) => existsSync(join(DIST, directory)))
        .flatMap((directory) =>
            readdirSync(join(DIST, directory))
                .filter((name) => name.endsWith('.js'))
                .map((name) => join(directory, name)),
        );
}

/** The names `source` imports from `specifier`, by a static `import { … } from "…"`. */
function namesImportedFrom(source, specifier) {
    const names = [];
    const marker = `} from "${specifier}";`;
    let end = source.indexOf(marker);
    while (end !== -1) {
        const start = source.lastIndexOf('import {', end);
        for (const part of source.slice(start + 'import {'.length, end).split(',')) {
            const name = part.trim().split(' as ')[0].trim();
            if (name) names.push(name);
        }
        end = source.indexOf(marker, end + marker.length);
    }
    return names;
}

describe('the built pages import only what the package exports', () => {
    const files = builtSfcFiles();

    test('the SFC build is there to read', () => {
        // Vacuously true on an empty list, which is what a moved output
        // directory would produce.
        assert.ok(files.length > 20, `only ${files.length} built SFC files found`);
    });

    for (const [specifier, entryFile] of Object.entries(OWN_ENTRIES)) {
        test(`every name imported from ${specifier} is one it exports`, async () => {
            const exported = new Set(Object.keys(await import(entryFile)));
            const missing = [];
            let imported = 0;
            for (const file of files) {
                for (const name of namesImportedFrom(
                    readFileSync(join(DIST, file), 'utf8'),
                    specifier,
                )) {
                    imported += 1;
                    if (!exported.has(name)) missing.push(`${file}: ${name}`);
                }
            }
            assert.ok(imported > 0, `no built page imports anything from ${specifier}`);
            assert.deepEqual(missing, []);
        });
    }
});
