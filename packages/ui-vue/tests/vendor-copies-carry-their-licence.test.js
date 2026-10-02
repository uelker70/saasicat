// What this package ships of somebody else's files carries their licence.
//
// The build copies Quasar's stylesheet and the Material Icons font into
// `dist/assets`, so the published tarball distributes them, and both licences
// ask for their terms to go with every copy. The expectation is read off the
// packages the files come from, not written down here: a licence that changes
// upstream is shipped as it now reads, and a copy declared without one fails.
//
// Run the build first — this test reads `dist/`.

// @requirement SC-SEC-017 — What a package ships of somebody else's files carries their licence

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    VENDOR_COPIES,
    WANTED,
    licenceFilesOf,
    licenceTarget,
    licencesOfCopy,
} from '../scripts/vendor-copies.mjs';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(PACKAGE, 'dist', 'assets');
const require = createRequire(join(PACKAGE, 'package.json'));
const MANIFEST = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));

/**
 * The package's own stylesheet: a library build names it after the package,
 * without its scope (`build.lib.cssFileName` defaults to the package name).
 */
const OWN_STYLESHEET = join(ASSETS, `${MANIFEST.name.split('/').pop()}.css`);

function filesUnder(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
    );
}

/** Exactly the files a copy puts into `dist/assets`: what it copies, and its licences. */
function filesOfCopy(copy) {
    const source = require.resolve(copy.from);
    const copied = copy.directory
        ? filesUnder(dirname(source))
              .filter((file) => WANTED.test(basename(file)))
              .map((file) => join(ASSETS, dirname(copy.to), relative(dirname(source), file)))
        : [join(ASSETS, copy.to)];
    const licences = licencesOfCopy(copy, source).map((licence) =>
        join(ASSETS, licenceTarget(copy, licence)),
    );
    return [...copied, ...licences];
}

describe("what this package ships of somebody else's", () => {
    test('there is something to check', () => {
        assert.ok(VENDOR_COPIES.length > 0, 'no copies declared, so nothing below is checked');
        assert.ok(existsSync(ASSETS), 'dist/assets is missing — build first');
        assert.ok(existsSync(OWN_STYLESHEET), `${relative(PACKAGE, OWN_STYLESHEET)} is missing`);
    });

    for (const copy of VENDOR_COPIES) {
        test(`${copy.what} ships with every licence that governs it, as its package states them`, () => {
            const stated = licencesOfCopy(copy, require.resolve(copy.from));
            assert.ok(stated.length > 0, `${copy.from} states no licence to carry`);
            for (const licence of stated) {
                const shipped = join(ASSETS, licenceTarget(copy, licence));
                assert.ok(existsSync(shipped), `${relative(PACKAGE, shipped)} is not in the build`);
                assert.equal(
                    readFileSync(shipped, 'utf8'),
                    readFileSync(licence.path, 'utf8'),
                    `${relative(PACKAGE, shipped)} differs from the licence it copies`,
                );
            }
        });
    }

    test('each copy carries the terms of the package it comes from, not only the nearest', () => {
        // The font's own directory carries Apache-2.0; the stylesheet that
        // declares it is the package's, under the package's licence.
        const withoutPackageTerms = VENDOR_COPIES.filter(
            (copy) => !licenceFilesOf(require.resolve(copy.from)).some((l) => l.packageRoot),
        ).map((copy) => copy.what);
        assert.deepEqual(withoutPackageTerms, []);
    });

    test('dist/assets holds the own stylesheet and the declared copies, and nothing else', () => {
        const expected = new Set([OWN_STYLESHEET, ...VENDOR_COPIES.flatMap(filesOfCopy)]);
        const unaccounted = filesUnder(ASSETS)
            .filter((file) => !expected.has(file))
            .map((file) => relative(PACKAGE, file));
        assert.deepEqual(unaccounted, [], 'copied without going through scripts/vendor-copies.mjs');
    });
});
