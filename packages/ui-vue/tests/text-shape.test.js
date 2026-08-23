import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { looksLikeEmail, trimChar } from '../dist/client/index.js';

// The two scanners that replaced `/\S+@\S+\.\S+/` and `/^-+|-+$/`. What has
// to hold: the same acceptance as the patterns on ordinary input, and a
// finish on the input the patterns choked on.

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
        const hostile = `${'@'.repeat(50_000)}x`;
        const started = Date.now();
        assert.equal(looksLikeEmail(hostile), false);
        assert.ok(Date.now() - started < 200, 'not linear');
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
        const started = Date.now();
        assert.equal(trimChar('-'.repeat(200_000), '-'), '');
        assert.ok(Date.now() - started < 200);
    });
});
