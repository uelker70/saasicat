// The Quasar stylesheet the administration hands out is the one of the Quasar it
// runs. The JavaScript resolves in the application under this package's `^`
// range, at the newest minor; a stylesheet copied at build time stayed at the
// release the package was built with, and Quasar's minors change markup and
// stylesheet together. So the file only imports Quasar's, and the application's
// bundler resolves that import from the same installation as the JavaScript.
//
// Run the build first — this test reads `dist/`.

// @requirement SC-UI-027 — The administration's framework stylesheet is the one of the framework it runs

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VENDOR_IMPORTS, importOf } from '../scripts/vendor-copies.mjs';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
const require = createRequire(join(PACKAGE, 'package.json'));

/** The directory of the installed package `name`, as this package resolves it. */
const packageRootOf = (file, name) =>
    file.slice(0, file.lastIndexOf(`/${name}/`) + name.length + 1);

describe('the Quasar stylesheet the administration hands out', () => {
    const quasar = VENDOR_IMPORTS.find((reference) => reference.from.startsWith('quasar/'));

    test('is what the package exports as ./quasar.css', () => {
        assert.ok(quasar, 'Quasar is no longer handed out by reference');
        assert.equal(MANIFEST.exports['./quasar.css'], `./dist/assets/${quasar.to}`);
    });

    test("imports Quasar's stylesheet and holds nothing of its own", () => {
        const shipped = readFileSync(join(PACKAGE, 'dist', 'assets', quasar.to), 'utf8');

        assert.equal(shipped, importOf(quasar));
        assert.ok(!shipped.includes('{'), 'a rule was written beside the import');
    });

    test('resolves from the same Quasar installation as the JavaScript', () => {
        const stylesheet = require.resolve(quasar.from);
        const script = require.resolve('quasar');

        assert.equal(packageRootOf(stylesheet, 'quasar'), packageRootOf(script, 'quasar'));
        const installed = JSON.parse(
            readFileSync(join(packageRootOf(script, 'quasar'), 'package.json'), 'utf8'),
        );
        assert.equal(installed.name, 'quasar');
    });
});
