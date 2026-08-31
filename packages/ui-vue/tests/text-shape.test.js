// @requirement SC-A11Y-001 — Text is legible in both themes

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { looksLikeEmail, trimChar } from '../dist/client/index.js';

// The two scanners that replaced `/\S+@\S+\.\S+/` and `/^-+|-+$/`. What has
// to hold: the same acceptance as the patterns on ordinary input, and a
// finish on the input the patterns choked on.

/**
 * A bound generous enough that only the failure it guards can breach it.
 *
 * The regression these two tests exist for is not slowness, it is
 * NON-TERMINATION: the pattern this replaced backtracked, and on 50,000 '@' it
 * did not come back. Measured on this machine the linear versions take 0.2 ms
 * and 4 ms, so two seconds is a margin of hundreds — wide enough to survive a
 * loaded CI runner and the coverage instrumentation that counts every one of a
 * million loop iterations.
 *
 * The previous bound was 200 ms, which is not such a margin: it failed once
 * under coverage on a busy machine and passed on the retry. A guard that fails
 * without a defect teaches people to run it again, which is the same end state
 * as not having it.
 *
 * What this does NOT prove is linearity. A ratio across two input sizes was
 * tried for that and measured rather than assumed: at a tenfold step the linear
 * version came out at 6.6× and a deliberately quadratic one at 33× — they do
 * separate, but the gap is set by how far the JIT has warmed up rather than by
 * the algorithm, so the threshold would be tuned to one machine. For six lines
 * of index arithmetic that is more apparatus than the risk deserves. If either
 * of these ever grows a regex again, the ratio is the thing to reach for.
 */
const TERMINATES_WITHIN_MS = 2_000;

/** Milliseconds for one run. */
function millisFor(work) {
    const started = performance.now();
    work();
    return performance.now() - started;
}

describe('looksLikeEmail', () => {
    test('accepts what the old pattern accepted', () => {
        for (const ok of ['a@b.c', 'first.last@example.org', 'x@y.co.uk', 'ü@ä.de']) {
            assert.equal(looksLikeEmail(ok), true, ok);
        }
    });

    test('rejects what the old pattern rejected, and the shapes it got wrong', () => {
        for (const bad of [
            '',
            'plain',
            '@b.c',
            'a@',
            'a@b',
            'a@.c',
            'a@b.',
            'a b@c.d',
            'a@b@c.d',
            'a@b.c\n',
            // The Unicode spaces `\s` matches and four ASCII comparisons did not.
            'a@b.c\u00a0',
            'a\u2003@b.c',
            'a@b.c\u3000',
            '\ufeffa@b.c',
        ]) {
            assert.equal(looksLikeEmail(bad), false, JSON.stringify(bad));
        }
    });

    test('finishes on the input the pattern backtracked on', () => {
        // Termination, not speed — and termination is all that can be asserted
        // here. Measured across 50,000, 500,000 and 2,000,000 characters this
        // runs in 0.16, 0.90 and 0.83 ms: it does not grow monotonically,
        // because it is fast enough that the numbers are timer noise. A ratio
        // over noise would be a guard that asserts nothing, so it is not used.
        const hostile = `${'@'.repeat(500_000)}x`;

        const elapsed = millisFor(() => {
            assert.equal(looksLikeEmail(hostile), false);
        });

        assert.ok(elapsed < TERMINATES_WITHIN_MS, `took ${elapsed.toFixed(0)} ms`);
    });
});

describe('trimChar', () => {
    test('strips a run of one character at either end and nothing inside', () => {
        assert.equal(trimChar('--a-b--', '-'), 'a-b');
        assert.equal(trimChar('___', '_'), '');
        assert.equal(trimChar('a', '-'), 'a');
        assert.equal(trimChar('', '-'), '');
    });

    test('finishes on a long run', () => {
        const elapsed = millisFor(() => {
            assert.equal(trimChar('-'.repeat(1_000_000), '-'), '');
        });

        assert.ok(elapsed < TERMINATES_WITHIN_MS, `took ${elapsed.toFixed(0)} ms`);
    });
});
