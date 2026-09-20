// The loop's own rule, at the broken state.
//
// `scripts/review-state.mjs` exists because the rule was prose: a round must
// come back with no P0, P1 or P2, and nothing merges while a finding is
// unanswered. Prose is applied by whoever remembers it, and on #308 that failed
// in both directions on one afternoon — a round requested after a clean one,
// and then, after a round that did raise a P2, three announcements that the loop
// was over.
//
// So each way it can be wrong is broken here on purpose and watched to fail.
// The cases below are the ones a green run would otherwise claim: an answer
// that names no level, one that names two, a P3 that must NOT keep the loop
// open, and a clean round that is older than the code it reviewed.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assess, levelOf } from '../scripts/review-state.mjs';

const HEAD_AT = '2026-09-20T10:00:00Z';

const finding = (id, extra = {}) => ({
    id,
    in_reply_to_id: null,
    path: 'packages/core/src/x.ts',
    line: 1,
    user: { login: 'reviewer' },
    ...extra,
});
const answer = (to, body) => ({ id: to * 10, in_reply_to_id: to, body, user: { login: 'me' } });
const round = (at) => ({ submitted_at: at });

/** A pull request whose only variable is what the answers say. */
const withAnswers = (...bodies) =>
    assess({
        reviews: [round('2026-09-20T11:00:00Z')],
        comments: [finding(1), ...bodies.map((body) => answer(1, body))],
        headAt: HEAD_AT,
    });

describe('what an answer declares', () => {
    test('one level is the classification', () => {
        assert.equal(levelOf('Fixed in abc1234. P2, it reached a tenant boundary.'), 'P2');
    });

    test('none is not a classification, and does not become one', () => {
        assert.equal(levelOf('Fixed in abc1234.'), null);
        assert.deepEqual(withAnswers('Fixed in abc1234.').blockers, [
            '1 answer(s) naming no single level',
        ]);
    });

    test('two is a judgement that was not made', () => {
        // "P1 or P2, somewhere in there" is the sentence this refuses.
        assert.equal(levelOf('Somewhere between P1 and P2; fixed anyway.'), null);
        assert.deepEqual(withAnswers('Between P1 and P2.').blockers, [
            '1 answer(s) naming no single level',
        ]);
    });

    test('a level inside a word is not one', () => {
        assert.equal(levelOf('The P2000 sensor is unrelated.'), null);
    });
});

describe('what keeps the loop open', () => {
    test('a finding nobody answered', () => {
        const { blockers } = assess({
            reviews: [round('2026-09-20T11:00:00Z')],
            comments: [finding(1)],
            headAt: HEAD_AT,
        });
        assert.deepEqual(blockers, ['1 finding(s) with no answer']);
    });

    for (const level of ['P0', 'P1', 'P2']) {
        test(`a finding at ${level}`, () => {
            assert.deepEqual(withAnswers(`${level}: fixed in abc1234.`).blockers, [
                `1 finding(s) at ${level}`,
            ]);
        });
    }

    test('a round older than the commit it would have to have seen', () => {
        // The trap this closes: a clean round, and then a push. Everything is
        // answered, and nothing has reviewed what was pushed.
        const { blockers } = assess({
            reviews: [round('2026-09-20T09:00:00Z')],
            comments: [finding(1), answer(1, 'P3: noted, fixed in abc1234.')],
            headAt: HEAD_AT,
        });
        assert.deepEqual(blockers, ['no review newer than the head commit']);
    });

    test('and the newest round is the latest one submitted, not the last one listed', () => {
        const { blockers } = assess({
            reviews: [round('2026-09-20T11:00:00Z'), round('2026-09-20T09:00:00Z')],
            comments: [finding(1), answer(1, 'P3: noted.')],
            headAt: HEAD_AT,
        });
        assert.deepEqual(blockers, []);
    });
});

describe('what lets it close', () => {
    test('every finding answered, classified, and none above P3', () => {
        assert.deepEqual(withAnswers('P3: a wording nit, fixed in abc1234.').blockers, []);
    });

    test('a pull request nobody found anything in, reviewed after the last push', () => {
        const { blockers } = assess({
            reviews: [round('2026-09-20T11:00:00Z')],
            comments: [],
            headAt: HEAD_AT,
        });
        assert.deepEqual(blockers, []);
    });

    test('a review still being written decides nothing — it has no moment yet', () => {
        // An in-progress review comes back without `submitted_at`. Counting it
        // would close the loop on a round that has not spoken.
        const { blockers } = assess({
            reviews: [round('2026-09-20T09:00:00Z'), { submitted_at: null }],
            comments: [],
            headAt: HEAD_AT,
        });
        assert.deepEqual(blockers, ['no review newer than the head commit']);
    });
});
