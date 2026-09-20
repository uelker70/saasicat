// The loop's own rule, at the broken state.
//
// `scripts/review-state.mjs` exists because the rule was prose: a round must
// come back with no P0, P1 or P2, and nothing merges while a finding is
// unanswered. Prose is applied by whoever remembers it, and on #308 that failed
// in both directions on one afternoon — a round requested after a clean one,
// and then, after a round that did raise a P2, three announcements that the loop
// was over.
//
// The case that decides the shape of the whole thing is the last one here: a P2
// from an earlier round, answered, with a later round that found nothing. The
// level of a finding does not change when it is dealt with, so counting every
// finding ever raised would leave the loop open for good — the unbounded loop
// the round limit exists to prevent. Only the newest round is asked.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assess, levelOf } from '../scripts/review-state.mjs';

const HEAD_AT = '2026-09-20T10:00:00Z';
const AUTHOR = 'me';

const round = (id, at, login = 'reviewer') => ({ id, submitted_at: at, user: { login } });
const finding = (id, reviewId) => ({
    id,
    pull_request_review_id: reviewId,
    in_reply_to_id: null,
    path: 'packages/core/src/x.ts',
    line: 1,
    user: { login: 'reviewer' },
});
const answer = (to, body) => ({ id: to * 10, in_reply_to_id: to, body, user: { login: AUTHOR } });

const LAST = round(7, '2026-09-20T11:00:00Z');

/** A pull request with one finding in the newest round, and whatever was said about it. */
const withAnswers = (...bodies) =>
    assess({
        reviews: [LAST],
        comments: [finding(1, LAST.id), ...bodies.map((body) => answer(1, body))],
        headAt: HEAD_AT,
        author: AUTHOR,
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
            reviews: [LAST],
            comments: [finding(1, LAST.id)],
            headAt: HEAD_AT,
            author: AUTHOR,
        });
        assert.deepEqual(blockers, ['1 finding(s) with no answer']);
    });

    for (const level of ['P0', 'P1', 'P2']) {
        test(`the newest round raising a ${level}`, () => {
            assert.deepEqual(withAnswers(`${level}: fixed in abc1234.`).blockers, [
                `the newest round raised 1 finding(s) at ${level}`,
            ]);
        });
    }

    test('a pull request only its author has reviewed', () => {
        // Replying to a finding creates a review record with an empty body. If
        // that counted, every answer would close the loop it is answering.
        const { blockers } = assess({
            reviews: [round(9, '2026-09-20T11:00:00Z', AUTHOR)],
            comments: [],
            headAt: HEAD_AT,
            author: AUTHOR,
        });
        assert.deepEqual(blockers, ['nobody but the author has reviewed it']);
    });

    test('a round still being written decides nothing — it has no moment yet', () => {
        const { blockers } = assess({
            reviews: [{ id: 9, submitted_at: null, user: { login: 'reviewer' } }],
            comments: [],
            headAt: HEAD_AT,
            author: AUTHOR,
        });
        assert.deepEqual(blockers, ['nobody but the author has reviewed it']);
    });
});

describe('what lets it close', () => {
    test('the newest round raising a P3, answered', () => {
        assert.deepEqual(withAnswers('P3: a wording nit, fixed in abc1234.').blockers, []);
    });

    test('a round that found nothing at all', () => {
        const { blockers } = assess({
            reviews: [LAST],
            comments: [],
            headAt: HEAD_AT,
            author: AUTHOR,
        });
        assert.deepEqual(blockers, []);
    });

    test('a P2 from an earlier round, answered, with a later round that found nothing', () => {
        // The case the whole shape turns on. The answer still reads "P2",
        // because the level of a finding does not change when it is fixed; what
        // changed is that a later round looked. Counting the history here would
        // hold the loop open for good.
        const earlier = round(3, '2026-09-20T08:00:00Z');
        const { blockers } = assess({
            reviews: [earlier, LAST],
            comments: [finding(1, earlier.id), answer(1, 'P2: fixed in abc1234, with a test.')],
            headAt: HEAD_AT,
            author: AUTHOR,
        });
        assert.deepEqual(blockers, []);
    });

    test('and that same P2 keeps it open while it is still the newest round', () => {
        const earlier = round(3, '2026-09-20T08:00:00Z');
        const { blockers } = assess({
            reviews: [earlier],
            comments: [finding(1, earlier.id), answer(1, 'P2: fixed in abc1234, with a test.')],
            headAt: HEAD_AT,
            author: AUTHOR,
        });
        assert.deepEqual(blockers, ['the newest round raised 1 finding(s) at P2']);
    });
});

describe('whether the newest round has seen the head', () => {
    // Reported, never a blocker: a P3 from the last round is fixed and merged
    // without asking for another look. It is the difference between "reviewed"
    // and "reviewed at this commit", which is worth saying and not worth
    // refusing over.
    test('is a moment, not how the string reads', () => {
        // `git` writes the committer's offset, GitHub writes `Z`. As text,
        // `11:04:10Z` sorts before `12:50:52+02:00`; as moments it is later.
        const { seenHead, blockers } = assess({
            reviews: [round(7, '2026-09-20T11:04:10Z')],
            comments: [],
            headAt: '2026-09-20T12:50:52+02:00',
            author: AUTHOR,
        });
        assert.equal(seenHead, true);
        assert.deepEqual(blockers, []);
    });

    test('picks the later of two rounds by moment, whichever way the strings sort', () => {
        // Two rounds, and the newer one reads as the older: the P3 belongs to
        // the round at 11:04Z, the P2 to the one at 12:50+02:00 — which is
        // 10:50Z and therefore earlier. Sorted as text it is the other way
        // round, and the loop would read as open.
        const earlierByMoment = round(3, '2026-09-20T12:50:52+02:00');
        const laterByMoment = round(7, '2026-09-20T11:04:10Z');
        const { blockers } = assess({
            reviews: [earlierByMoment, laterByMoment],
            comments: [
                finding(1, earlierByMoment.id),
                answer(1, 'P2: fixed in abc1234.'),
                finding(2, laterByMoment.id),
                answer(2, 'P3: a nit, fixed in abc1234.'),
            ],
            headAt: '2026-09-20T09:00:00Z',
            author: AUTHOR,
        });
        assert.deepEqual(blockers, []);
    });

    test('is false for a round older than the commit, and still no blocker', () => {
        const { seenHead, blockers } = assess({
            reviews: [round(7, '2026-09-20T09:00:00Z')],
            comments: [],
            headAt: HEAD_AT,
            author: AUTHOR,
        });
        assert.equal(seenHead, false);
        assert.deepEqual(blockers, []);
    });
});
