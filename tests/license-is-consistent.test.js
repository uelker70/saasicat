import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// One licence, eleven copies of it.
//
// npm packs a `LICENSE` from the PACKAGE directory, never from the repository
// root, so each published package carries its own copy. That is a duplication
// the layout forces, and duplication is a defect waiting for someone to update
// one instance — which happened the day the licence changed: the root file and
// all ten `license` fields moved to PolyForm Shield while the ten package files
// still read Apache-2.0. A published tarball would then have stated one licence
// in its metadata and a more permissive one in the file beside it.
//
// So the copies are checked, not trusted. The expectation is derived from the
// root file rather than written down here: a future licence change needs no edit
// to this test, and forgetting a copy fails it.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = join(ROOT, 'packages');

/** Every workspace package, with its manifest. */
function publishedPackages() {
    return readdirSync(PACKAGES)
        .map((name) => ({ name, dir: join(PACKAGES, name) }))
        .filter((p) => existsSync(join(p.dir, 'package.json')))
        .map((p) => ({
            ...p,
            manifest: JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')),
        }))
        .filter((p) => p.manifest.private !== true);
}

const CANONICAL = readFileSync(join(ROOT, 'LICENSE'), 'utf8');

describe('every published package ships the same licence as the repository', () => {
    test('there are packages to check', () => {
        // Without this the three below pass on an empty list, which is what a
        // vacuous guard looks like.
        assert.ok(publishedPackages().length >= 5, 'the package scan found almost nothing');
    });

    test('each one has a LICENSE file', () => {
        // npm would publish without it, and the licence PolyForm Shield grants
        // is conditional on recipients getting these terms — see its Notices
        // section.
        const missing = publishedPackages()
            .filter((p) => !existsSync(join(p.dir, 'LICENSE')))
            .map((p) => p.manifest.name);
        assert.deepEqual(missing, [], 'published without a licence file');
    });

    test('and it is byte-identical to the one at the root', () => {
        const differing = publishedPackages()
            .filter((p) => {
                const path = join(p.dir, 'LICENSE');
                return existsSync(path) && readFileSync(path, 'utf8') !== CANONICAL;
            })
            .map((p) => p.manifest.name);
        assert.deepEqual(differing, [], 'a copy drifted from the root LICENSE');
    });

    test('and the license field agrees with the file, everywhere', () => {
        // The failure this exists for: metadata saying one licence while the
        // file beside it says another. The identifier is not written down here
        // — every package must simply agree, and the words of its identifier
        // must appear in the licence text itself, so `Apache-2.0` cannot sit on
        // top of PolyForm.
        const fields = new Set(publishedPackages().map((p) => p.manifest.license));
        assert.equal(fields.size, 1, `packages disagree: ${[...fields].join(', ')}`);

        const [identifier] = [...fields];
        assert.ok(identifier, 'a published package declares no license at all');

        const title = CANONICAL.split('\n').find((line) => line.startsWith('# '));
        assert.ok(title, 'the LICENSE has no title to check the identifier against');
        for (const word of identifier.split('-')) {
            if (/^\d/.test(word)) continue; // version segments are punctuated differently
            assert.match(
                title,
                new RegExp(word, 'i'),
                `"${identifier}" names ${word}, which does not appear in "${title.trim()}"`,
            );
        }
    });
});
