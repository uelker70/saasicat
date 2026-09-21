// The two rules, at the broken state.
//
// `scripts/review-state.mjs` counts what is countable and asks for the one
// judgement that is not. Nothing merges while a finding is unanswered; a round
// must come back with no P0, P1 or P2 before the loop ends. The first is data.
// The second needs to know when a round came back **clean**, and that is not in
// the data: a round that finds something leaves review records, a round that
// finds nothing leaves no record at all. Four rounds of review went into trying
// to reconstruct it from side-effects — an edited comment, a reaction, who had
// found something before — and each reconstruction had a hole, because the
// thing being reconstructed is not there. So somebody says it, once, and this
// reads the line.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assess, levelOf } from '../scripts/review-state.mjs';

const HEAD = 'ab9f47c8ab9f47c8ab9f47c8ab9f47c8ab9f47c8';
const OLD = '1111111111111111111111111111111111111111';
const AUTHOR = 'me';

const review = (id, at, commit = HEAD, login = 'reviewer') => ({
    id,
    submitted_at: at,
    commit_id: commit,
    user: { login },
});
const finding = (id, reviewId, login = 'reviewer') => ({
    id,
    pull_request_review_id: reviewId,
    in_reply_to_id: null,
    path: 'packages/core/src/x.ts',
    line: 1,
    user: { login },
});
const answer = (to, body) => ({
    id: to * 10 + 1,
    in_reply_to_id: to,
    body,
    user: { login: AUTHOR },
});
const also = (to, body) => ({ id: to * 10 + 2, in_reply_to_id: to, body, user: { login: AUTHOR } });
const said = (at, body, login = AUTHOR) => ({ created_at: at, body, user: { login } });
/** Any trace of somebody other than the author having been here since. */
const trace = (at, login = 'reviewer') => ({ created_at: at, content: '+1', user: { login } });

const LAST = review(7, '2026-09-20T11:00:00Z');
const state = (over) =>
    assess({
        reviews: [],
        issueComments: [],
        reactions: [],
        comments: [],
        headOid: HEAD,
        author: AUTHOR,
        ...over,
    });
const withAnswers = (...bodies) =>
    state({ reviews: [LAST], comments: [finding(1, LAST.id), ...bodies.map((b) => answer(1, b))] });

describe('what an answer declares', () => {
    test('the level it opens with', () => {
        assert.equal(levelOf('**P2** — it reaches a tenant boundary. Fixed in abc1234.'), 'P2');
        assert.equal(levelOf('P3: a wording nit.'), 'P3');
    });

    test('and nothing when it opens with prose', () => {
        // The lesson of the shape before this one, which asked for exactly one
        // level anywhere in the text: every answer that explained itself named a
        // second in passing, and four of nine real answers read as unclassified.
        assert.equal(levelOf('**P1** — unlike the P3 below it, this reaches a boundary.'), 'P1');
        assert.equal(levelOf('Fixed in abc1234 — P2.'), null);
        assert.equal(levelOf('Between P1 and P2.'), null);
        assert.equal(levelOf('The P2000 sensor is unrelated.'), null);
    });

    test('read at the end of a thread, so an escalation is not frozen at its opening', () => {
        const { blockers } = state({
            reviews: [LAST],
            comments: [
                finding(1, LAST.id),
                answer(1, 'P3 at first sight.'),
                also(1, 'P1 on measuring it — it reaches a boundary after all.'),
            ],
        });
        assert.match(blockers[0], /1 finding\(s\) at P1/);
    });
});

describe('nothing merges while a finding is open', () => {
    test('a finding nobody answered', () => {
        const { blockers } = state({ reviews: [LAST], comments: [finding(1, LAST.id)] });
        assert.deepEqual(blockers, ['1 finding(s) with no answer']);
    });

    test('an answer naming no level', () => {
        assert.deepEqual(withAnswers('Fixed in abc1234.').blockers, [
            '1 answer(s) naming no level',
        ]);
    });

    test("but the author's own note is not a finding against them", () => {
        const { rows, blockers } = state({
            reviews: [LAST],
            comments: [finding(1, LAST.id, AUTHOR)],
        });
        assert.deepEqual(rows, []);
        assert.deepEqual(blockers, []);
    });
});

describe('the loop, which ends when a round comes back with nothing', () => {
    for (const level of ['P0', 'P1', 'P2']) {
        test(`stays open on a ${level} with nothing declared since`, () => {
            assert.deepEqual(withAnswers(`${level}: fixed in abc1234.`).blockers, [
                `1 finding(s) at ${level} were the last raised, and no clean round is declared since`,
            ]);
        });
    }

    test('closes on a P3, which is a finding and does not hold it open', () => {
        assert.deepEqual(withAnswers('P3: a nit, fixed in abc1234.').blockers, []);
    });

    test('closes when somebody says a round came back clean', () => {
        // The one judgement this does not make. Nobody can read it off the API:
        // a clean round writes no review record at all.
        const { blockers, clean } = state({
            reviews: [LAST],
            comments: [finding(1, LAST.id), answer(1, 'P1: fixed in abc1234.')],
            issueComments: [said('2026-09-20T12:00:00Z', `Round clean at ${HEAD}`)],
            reactions: [trace('2026-09-20T11:55:00Z')],
        });
        assert.deepEqual(blockers, []);
        assert.equal(clean.sha, HEAD);
    });

    test('but not when the author is the only one who has been here since', () => {
        // The premise of this whole pull request, made machine-readable: the
        // person who wrote the code cannot also be the only evidence that
        // somebody looked at it.
        const { blockers } = state({
            reviews: [LAST],
            comments: [finding(1, LAST.id), answer(1, 'P1: deferred.')],
            issueComments: [said('2026-09-20T12:00:00Z', `Round clean at ${HEAD}`)],
        });
        assert.match(blockers.at(-1), /nobody but the author has been here since/);
    });

    test('and not when it names a commit that is no longer the head', () => {
        // A declaration is about what a round saw. A push after it does not
        // inherit the verdict.
        const { blockers } = state({
            reviews: [LAST],
            comments: [finding(1, LAST.id), answer(1, 'P1: fixed in abc1234.')],
            issueComments: [said('2026-09-20T12:00:00Z', `Round clean at ${OLD}`)],
            reactions: [trace('2026-09-20T11:55:00Z')],
        });
        assert.match(blockers.at(-1), /not this head/);
    });

    test('a short sha names the head as well as a long one', () => {
        const { clean } = state({
            reviews: [LAST],
            comments: [finding(1, LAST.id), answer(1, 'P1: fixed in abc1234.')],
            issueComments: [said('2026-09-20T12:00:00Z', `Round clean at ${HEAD.slice(0, 8)}`)],
            reactions: [trace('2026-09-20T11:55:00Z')],
        });
        assert.ok(clean);
    });

    test('but not by a declaration made before the findings it would absolve', () => {
        const { blockers } = state({
            reviews: [LAST],
            comments: [finding(1, LAST.id), answer(1, 'P1: fixed in abc1234.')],
            issueComments: [said('2026-09-20T09:00:00Z', `Round clean at ${OLD}`)],
        });
        assert.match(blockers[0], /no clean round is declared since/);
    });

    test('nor by a sentence that merely mentions one', () => {
        const { blockers } = state({
            reviews: [LAST],
            comments: [finding(1, LAST.id), answer(1, 'P1: fixed in abc1234.')],
            issueComments: [said('2026-09-20T12:00:00Z', 'I think the round clean at last, no?')],
        });
        assert.match(blockers[0], /no clean round is declared since/);
    });
});

describe('a pull request nobody has looked at', () => {
    test('does not pass by having nothing to count', () => {
        // Zero rounds is not "a round came back with nothing". Every count here
        // is empty, and that is the one state where emptiness proves the
        // opposite of what it looks like.
        const { blockers } = state({});
        assert.deepEqual(blockers, ['nothing has been reviewed, and no clean round is declared']);
    });

    test("and the author's own review records are not somebody having looked", () => {
        // Replying to a finding creates a review record. Without this, answering
        // your own pull request would count as having reviewed it.
        const { blockers } = state({ reviews: [review(9, '2026-09-20T11:00:00Z', HEAD, AUTHOR)] });
        assert.deepEqual(blockers, ['nothing has been reviewed, and no clean round is declared']);
    });

    test('and passes once a round is declared clean and corroborated', () => {
        const { blockers } = state({
            issueComments: [said('2026-09-20T12:00:00Z', `Round clean at ${HEAD}`)],
            reactions: [trace('2026-09-20T11:55:00Z')],
        });
        assert.deepEqual(blockers, []);
    });
});

describe('what the findings are scoped to', () => {
    // The commit, not the review record and not the reviewer. One round leaves
    // several records — the round on #308 at `6cffd079` left two — and two
    // reviewers at one head must not absolve each other.
    test('several records of one round are all counted', () => {
        const first = review(11, '2026-09-20T08:54:16Z');
        const second = review(12, '2026-09-20T08:54:31Z');
        const { blockers } = state({
            reviews: [first, second],
            comments: [
                finding(1, first.id),
                answer(1, 'P1: fixed in abc1234.'),
                finding(2, second.id),
                answer(2, 'P3: a nit.'),
            ],
        });
        assert.match(blockers[0], /1 finding\(s\) at P1/);
    });

    test('two reviewers at one commit do not absolve each other', () => {
        const codex = review(21, '2026-09-20T11:00:00Z', HEAD, 'codex[bot]');
        const claude = review(22, '2026-09-20T11:05:00Z', HEAD, 'other[bot]');
        const { blockers } = state({
            reviews: [codex, claude],
            comments: [
                finding(1, codex.id, 'codex[bot]'),
                answer(1, 'P1: deferred.'),
                finding(2, claude.id, 'other[bot]'),
                answer(2, 'P3: a nit.'),
            ],
        });
        assert.match(blockers[0], /1 finding\(s\) at P1/);
    });

    test('a review naming no commit is scoped to itself, not to every other one', () => {
        // `undefined === undefined` would put every commit-less review in one
        // round, so an old P1 would ride along with a new P3 for good.
        const older = { ...review(31, '2026-09-20T08:00:00Z'), commit_id: undefined };
        const newer = { ...review(32, '2026-09-20T11:00:00Z'), commit_id: undefined };
        const { blockers } = state({
            reviews: [older, newer],
            comments: [
                finding(1, older.id),
                answer(1, 'P1: fixed in abc1234.'),
                finding(2, newer.id),
                answer(2, 'P3: a nit.'),
            ],
        });
        assert.deepEqual(blockers, []);
    });

    test('and a later round at a later commit replaces them', () => {
        const earlier = review(11, '2026-09-20T08:54:16Z', OLD);
        const { blockers } = state({
            reviews: [earlier, LAST],
            comments: [
                finding(1, earlier.id),
                answer(1, 'P1: fixed in abc1234.'),
                finding(2, LAST.id),
                answer(2, 'P3: a nit.'),
            ],
        });
        assert.deepEqual(blockers, []);
    });
});
