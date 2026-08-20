import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Can the configured release line reach the version it is meant to reach?
//
// Pre mode does not select a version. Changesets applies the ordinary semver
// bump and then appends the prerelease tag — so `pre enter rc` on a `0.27.0`
// base, with a `patch` as the next merged changeset, publishes `0.27.1-rc.0`.
// The release workflow runs on every push to `main`, which makes that the next
// release rather than a hypothetical, and the candidate line for 1.0 would be
// opened at the wrong number by the first fix somebody merges.
//
// `pre enter rc` plus a `major` DOES give `1.0.0-rc.0` — measured — and it was
// tempting to read that as "pre mode selects the major". It does not. The two
// have to arrive together.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRE = join(ROOT, '.changeset', 'pre.json');
const CHANGESETS = join(ROOT, '.changeset');

/** The version the fixed group is on right now. */
function currentVersion() {
    const manifest = join(ROOT, 'packages', 'saas-platform-nest', 'package.json');
    return JSON.parse(readFileSync(manifest, 'utf8')).version;
}

/** Bump levels waiting in unprocessed changesets. */
function pendingLevels() {
    return readdirSync(CHANGESETS)
        .filter((name) => name.endsWith('.md') && name !== 'README.md')
        .flatMap((name) =>
            [...readFileSync(join(CHANGESETS, name), 'utf8').matchAll(/^'[^']+':\s*(\w+)$/gm)].map(
                (m) => m[1],
            ),
        );
}

describe('the configured release line can reach the version it is for', () => {
    test('on a 0.x base, a major changeset and pre mode appear together', () => {
        const [major] = currentVersion().split('.');
        if (Number(major) >= 1) return; // past the cut; the pairing no longer applies

        const majorPending = pendingLevels().includes('major');
        const inPreMode = existsSync(PRE);

        // One statement rather than two halves, because both halves publish
        // something unintended and each is invisible from the other side.
        //
        //   pre mode without a major — the ordinary semver bump wins and the tag
        //   is appended to it, so a patch publishes `0.27.1-rc.0`: a candidate
        //   line opened on the version being left behind.
        //
        //   a major without pre mode — the bump applies with no tag at all, so
        //   the release publishes a stable `1.0.0`. Decision E1 reserves that
        //   version for the coordinated cut, with a codemod and a migration
        //   guide, and npm versions cannot be taken back.
        //
        // Both measured in a throwaway clone rather than reasoned about.
        assert.equal(
            majorPending,
            inPreMode,
            majorPending
                ? `a major changeset is pending on ${currentVersion()} without pre mode, so ` +
                      'the next release publishes a stable 1.0.0 rather than a candidate. Add ' +
                      '`changeset pre enter rc` in this pull request.'
                : `pre mode is on with the base at ${currentVersion()} and no major changeset ` +
                      'pending, so the next release publishes a candidate on the OLD line — ' +
                      'a patch would become 0.27.1-rc.0. Add a `major` changeset describing ' +
                      'the breaking change.',
        );
    });

    test('and the tag it uses is the tag the docs name', () => {
        if (!existsSync(PRE)) return;
        const { tag, mode } = JSON.parse(readFileSync(PRE, 'utf8'));
        assert.equal(mode, 'pre', `pre.json exists with mode "${mode}"`);
        assert.ok(
            new RegExp(`\`${tag}\``).test(readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8')),
            `pre mode uses the tag "${tag}", which CONTRIBUTING.md never names`,
        );
    });

    test('the check has a subject either way', () => {
        // Both tests above return early when there is no pre mode, which is the
        // shape of a guard that passes by having nothing to do. This one fails
        // instead if the things they read stopped existing.
        assert.match(currentVersion(), /^\d+\.\d+\.\d+/, 'no version to reason about');
        assert.ok(
            readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8').includes('pre enter rc'),
            'CONTRIBUTING.md no longer documents how the candidate line is opened',
        );
    });
});
