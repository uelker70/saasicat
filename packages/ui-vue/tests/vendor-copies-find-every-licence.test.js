// Which licence files govern a copy, and where each one lands — on a package
// built for the purpose, so the answer does not depend on what an installed
// package happens to carry today: a licence at the package's root, one in the
// directory the copied stylesheet sits in, and one in a subdirectory the
// directory copy takes along.

// @requirement SC-SEC-017 — What a package ships of somebody else's files carries their licence

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isNotice, licenceTarget, licencesOfCopy } from '../scripts/vendor-copies.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'vendor-copies-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

/** A package with terms at three levels: its own, the font directory's, and a subdirectory's. */
function aPackage() {
    const pkg = join(ROOT, 'node_modules', 'fonts-pkg');
    mkdirSync(join(pkg, 'icons', 'web'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), '{"name":"fonts-pkg","license":"MIT"}');
    writeFileSync(join(pkg, 'LICENSE'), 'package terms');
    writeFileSync(join(pkg, 'icons', 'icons.css'), '@font-face {}');
    writeFileSync(join(pkg, 'icons', 'LICENSE'), 'icon terms');
    writeFileSync(join(pkg, 'icons', 'web', 'icons.woff2'), '');
    writeFileSync(join(pkg, 'icons', 'web', 'LICENSE'), 'font file terms');
    return join(pkg, 'icons', 'icons.css');
}

const targetsOf = (copy, source) =>
    licencesOfCopy(copy, source)
        .map((licence) => licenceTarget(copy, licence))
        .sort();

describe('the licences that govern a copy', () => {
    const source = aPackage();

    test('a directory copy carries its own, its package root’s and each copied subdirectory’s', () => {
        const copy = { from: source, to: 'icons/icons.css', directory: true };

        assert.deepEqual(targetsOf(copy, source), [
            join('icons', 'LICENSE.txt'),
            join('icons', 'PACKAGE-LICENSE.txt'),
            join('icons', 'web', 'LICENSE.txt'),
        ]);
    });

    test('a single file carries those from its directory up to the package root, beside it', () => {
        const copy = { from: source, to: 'icons.css' };

        assert.deepEqual(targetsOf(copy, source), [
            'icons.css.LICENSE.txt',
            'icons.css.PACKAGE-LICENSE.txt',
        ]);
    });
});

describe('a notice', () => {
    test('is told by the file’s own name, whatever the directories on the way are called', () => {
        assert.equal(isNotice({ path: join(ROOT, 'pkg', 'NOTICE') }), true);
        assert.equal(isNotice({ path: join(ROOT, 'pkg', 'notice.txt') }), true);
        assert.equal(isNotice({ path: join(ROOT, 'notice-board', 'pkg', 'LICENSE') }), false);
    });
});
