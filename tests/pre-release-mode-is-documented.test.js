import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Does the documentation know which release line the repository is on?
//
// `.changeset/pre.json` decides what `pnpm changeset` produces. In pre mode
// every level yields a `1.0.0-rc.N`, and a `patch` cannot reach the 0.x line at
// all — which is a surprise worth documenting, and a surprise that outlives the
// state if nobody updates the text.
//
// The dangerous moment is not entering pre mode; it is LEAVING it. `changeset
// pre exit` is one command, the file disappears, and CONTRIBUTING.md keeps
// telling contributors they are writing release candidates. So this checks both
// directions: the file and the prose have to agree about which line is open.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRE = join(ROOT, '.changeset', 'pre.json');
const CONTRIBUTING = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8');

/** Whether the contributor-facing docs claim a candidate line is open. */
const documentsPreMode = /pre mode/i.test(CONTRIBUTING);

describe('the release line the docs describe is the one that is configured', () => {
    test('pre mode and its documentation appear together', () => {
        assert.equal(
            existsSync(PRE),
            documentsPreMode,
            existsSync(PRE)
                ? 'the repository is in pre mode and CONTRIBUTING.md does not say so'
                : 'CONTRIBUTING.md describes a pre mode the repository is not in — ' +
                      'most likely `changeset pre exit` ran without the prose following',
        );
    });

    test('and the documented tag is the configured tag', () => {
        if (!existsSync(PRE)) return;
        const { tag, mode } = JSON.parse(readFileSync(PRE, 'utf8'));
        assert.equal(mode, 'pre', `pre.json exists with mode "${mode}"`);
        assert.ok(
            new RegExp(`\`${tag}\``).test(CONTRIBUTING),
            `pre mode uses the tag "${tag}", which CONTRIBUTING.md never names`,
        );
    });

    test('the example version in the docs matches the tag', () => {
        // `1.0.0-rc.N` in the prose is a promise about what a contributor's
        // changeset will produce. A tag change without a prose change makes it
        // a wrong promise rather than a stale one.
        if (!existsSync(PRE)) return;
        const { tag } = JSON.parse(readFileSync(PRE, 'utf8'));
        assert.match(
            CONTRIBUTING,
            new RegExp(`\\d+\\.\\d+\\.\\d+-${tag}\\.`),
            `CONTRIBUTING.md shows no example version carrying the tag "${tag}"`,
        );
    });
});
