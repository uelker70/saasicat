// @requirement SC-SCOPE-009 — SaaSiCat is source-available and must not be called open source
// @requirement SC-SCOPE-010 — A published version keeps the licence it was published under

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

        // The name and the version, both. An earlier version skipped numeric
        // segments — "version segments are punctuated differently" — which left
        // the guard blind to the one drift it is most likely to see: the licence
        // files moved to a new version of the same licence while the manifests
        // kept the old identifier. Every copy identical, every field agreeing,
        // and the metadata naming a version the file does not.
        //
        // Compared as text rather than as patterns. The first version built a
        // `RegExp` out of the identifier and escaped only the dots in the
        // version — partial escaping, which CodeQL flagged as
        // `js/incomplete-sanitization` and was right to: a value that reaches a
        // pattern needs every metacharacter handled or none of them. `includes`
        // needs none, and says what is meant.
        const segments = identifier.split('-');
        const version = segments.filter((s) => /^\d+$/.test(s)).join('.');
        const haystack = title.toLowerCase();

        for (const word of segments.filter((s) => !/^\d+$/.test(s))) {
            assert.ok(
                haystack.includes(word.toLowerCase()),
                `"${identifier}" names ${word}, which does not appear in "${title.trim()}"`,
            );
        }
        if (version) {
            assert.ok(
                title.includes(version),
                `"${identifier}" is version ${version}, which does not appear in "${title.trim()}"`,
            );
        }
    });
});

describe('what the docs say about the licence is what the licence says', () => {
    // A review found README.md and CONTRIBUTING.md summarising the restriction
    // as "a product that competes with SaaSiCat itself". The clause has a
    // second half — "or any product the licensor or any of its affiliates
    // provides using the software" — and that half is the one covering the
    // applications built with it, which is what the relicensing was for. A
    // reader following the summary would have concluded that competing with
    // those was permitted.
    //
    // The fix was not a better paraphrase. Both documents quote the clause now,
    // and this checks the quote against its source, so the two cannot drift
    // and a shortened restatement fails here rather than in someone's plans.

    /** The Noncompete clause, read out of the licence itself. */
    function noncompeteClause() {
        const match = /^## Noncompete\n\n(.+?)\n/ms.exec(CANONICAL);
        assert.ok(match, 'the LICENSE has no Noncompete section to quote');
        return match[1].trim();
    }

    for (const file of ['README.md', 'CONTRIBUTING.md']) {
        test(`${file} quotes it verbatim`, () => {
            const clause = noncompeteClause();
            const text = readFileSync(join(ROOT, file), 'utf8');
            assert.ok(
                text.includes(clause),
                `${file} does not carry the clause word for word — a summary of a licence ` +
                    'restriction that leaves part of it out reads as permission',
            );
        });
    }

    test('the clause is not trivially short, so the check is not trivially true', () => {
        assert.ok(noncompeteClause().length > 60, 'the extracted clause is too short to mean much');
    });
});
