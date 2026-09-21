// The loop's own rule, at the broken state.
//
// `scripts/review-state.mjs` exists because the rule was prose: a round must
// come back with no P0, P1 or P2, and nothing merges while a finding is
// unanswered. Prose is applied by whoever remembers it, and on #308 that failed
// in both directions on one afternoon — a round requested after a clean one,
// and then, after a round that did raise a P2, three announcements that the loop
// was over.
//
// Most of what is pinned here is about telling a round from the traces it
// leaves, because those differ by what it found: findings hang from review
// records, several per round, while a round that found nothing leaves a comment
// or a reaction and no record at all. Getting that wrong is not a smaller
// version of being right — the one event the rule turns on is a round coming
// back clean, which is exactly the one that writes no review.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assess, levelOf } from '../scripts/review-state.mjs';

const HEAD_OID = 'ab9f47c8ab9f47c8ab9f47c8ab9f47c8ab9f47c8';
/** What the head was before the push that answered an earlier round. */
const OLD_OID = '1111111111111111111111111111111111111111';
const AUTHOR = 'me';
/** The login the review workflow runs as — it leaves reviews here, so its marks count. */
const BOT = 'github-actions[bot]';

const review = (id, at, { login = 'reviewer', commit = HEAD_OID } = {}) => ({
    id,
    submitted_at: at,
    commit_id: commit,
    user: { login },
});
/** What a round that found nothing leaves: a comment, or a reaction, and no record. */
/**
 * The workflow writes a progress note when it picks the request up and edits it
 * into the verdict; `at` is when it spoke, `noted` when it first appeared.
 */
const verdict = (at, { login = BOT, body = 'Claude finished. No findings.', noted } = {}) => ({
    created_at: noted ?? '2026-09-20T10:30:00Z',
    updated_at: at,
    user: { login },
    body,
});
const reaction = (at, { login = BOT, content = '+1' } = {}) => ({
    created_at: at,
    user: { login },
    content,
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

const LAST = review(7, '2026-09-20T11:00:00Z');
const state = (over) =>
    assess({
        reviews: [],
        issueComments: [],
        reactions: [],
        comments: [],
        headOid: HEAD_OID,
        author: AUTHOR,
        ...over,
    });

/** A pull request with one finding in the newest round, and whatever was said about it. */
const withAnswers = (...bodies) =>
    state({
        reviews: [LAST],
        comments: [finding(1, LAST.id), ...bodies.map((body) => answer(1, body))],
    });

describe('what an answer declares', () => {
    test('one level is the classification', () => {
        assert.equal(levelOf('**P2** — it reached a tenant boundary. Fixed in abc1234.'), 'P2');
    });

    test('none is not a classification, and does not become one', () => {
        assert.equal(levelOf('Fixed in abc1234.'), null);
        assert.deepEqual(withAnswers('Fixed in abc1234.').blockers, [
            '1 answer(s) naming no single level',
        ]);
    });

    test('is read from the opening, so an answer may discuss other levels', () => {
        // The lesson of the first shape, which asked for exactly one level in
        // the body: every answer that explained itself named a second one, and
        // four of the nine on this pull request read as unclassified.
        assert.equal(levelOf('**P1** — the earlier P2 was fixed, and this is not a P3.'), 'P1');
        assert.deepEqual(
            withAnswers('**P3** — a nit, unlike the P1 above it. Fixed in abc1234.').blockers,
            [],
        );
    });

    test('but not from prose that merely begins with something', () => {
        assert.equal(levelOf('Between P1 and P2, and fixed anyway.'), null);
        assert.equal(levelOf('Fixed in abc1234 — P2.'), null);
        assert.deepEqual(withAnswers('Between P1 and P2.').blockers, [
            '1 answer(s) naming no single level',
        ]);
    });

    test('a level inside a word is not one', () => {
        assert.equal(levelOf('The P2000 sensor is unrelated.'), null);
    });

    test('and a thread that escalates is read at its end, not at its opening', () => {
        // The only place this resolves ambiguity by recency rather than by
        // severity, and deliberately: a level is a judgement, and a judgement
        // can be revised. Taking the first would freeze the opening guess.
        const { blockers } = state({
            reviews: [LAST],
            comments: [
                finding(1, LAST.id),
                answer(1, 'P3 at first sight.'),
                also(1, 'P1 on measuring it — it reaches a boundary after all.'),
            ],
        });
        assert.deepEqual(blockers, ['the newest round raised 1 finding(s) at P1']);
    });
});

describe('what keeps the loop open', () => {
    test('a finding nobody answered', () => {
        const { blockers } = state({ reviews: [LAST], comments: [finding(1, LAST.id)] });
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
        const { blockers } = state({
            reviews: [review(9, '2026-09-20T11:00:00Z', { login: AUTHOR })],
        });
        assert.deepEqual(blockers, ['nobody but the author has reviewed it']);
    });

    test('a round still being written decides nothing — it has no moment yet', () => {
        const { blockers } = state({
            reviews: [{ id: 9, submitted_at: null, user: { login: 'reviewer' } }],
        });
        assert.deepEqual(blockers, ['nobody but the author has reviewed it']);
    });

    test('and 👀 is the acknowledgement, not the answer', () => {
        // It lands seconds after the request. A guard that took it for a verdict
        // would close the loop on the act of opening it.
        const { blockers } = state({
            reviews: [review(3, '2026-09-20T08:00:00Z', { commit: OLD_OID })],
            reactions: [reaction('2026-09-20T11:00:00Z', { content: 'eyes' })],
            comments: [finding(1, 3), answer(1, 'P2: fixed in abc1234.')],
        });
        assert.deepEqual(blockers, ['the newest round raised 1 finding(s) at P2']);
    });
});

describe('a round leaves several records, and one round is one reviewer at one commit', () => {
    // Measured on #308: the round at `6cffd079` left two review records, one per
    // inline comment. Taking the last record as the round would check one of its
    // findings for severity and let the other through beside it.
    const first = review(11, '2026-09-20T08:54:16Z');
    const second = review(12, '2026-09-20T08:54:31Z');

    test('so a P1 in the earlier record still counts', () => {
        const { blockers } = state({
            reviews: [first, second],
            comments: [
                finding(1, first.id),
                answer(1, 'P1: fixed in abc1234.'),
                finding(2, second.id),
                answer(2, 'P3: a nit.'),
            ],
        });
        assert.deepEqual(blockers, ['the newest round raised 1 finding(s) at P1']);
    });

    test('and a later round at a later commit replaces both', () => {
        const { blockers } = state({
            reviews: [
                review(11, '2026-09-20T08:54:16Z', { commit: OLD_OID }),
                review(12, '2026-09-20T08:54:31Z', { commit: OLD_OID }),
                LAST,
            ],
            comments: [finding(1, 11), answer(1, 'P1: fixed in abc1234.')],
        });
        assert.deepEqual(blockers, []);
    });
});

describe('a round that found nothing leaves no review', () => {
    // Every Claude review record on #308 has an empty body and exists only
    // because inline comments attach to one; the verdict is an issue comment.
    // Codex says the same thing with a 👍 and nothing else. So the one event the
    // loop rule turns on is the single event a reviews-only reading cannot see.
    const earlier = review(3, '2026-09-20T08:00:00Z', { login: BOT, commit: OLD_OID });
    const raised = [finding(1, earlier.id, BOT), answer(1, 'P2: fixed in abc1234.')];

    test('so a verdict comment is a round, and closes what an earlier review opened', () => {
        const { blockers } = state({
            reviews: [earlier],
            issueComments: [verdict('2026-09-20T11:00:00Z')],
            comments: raised,
        });
        assert.deepEqual(blockers, []);
    });

    test('so is a 👍, which is how Codex says it found nothing', () => {
        const { blockers } = state({
            reviews: [earlier],
            reactions: [reaction('2026-09-20T11:00:00Z')],
            comments: raised,
        });
        assert.deepEqual(blockers, []);
    });

    test('and without either, the earlier round still decides', () => {
        const { blockers } = state({ reviews: [earlier], comments: raised });
        assert.deepEqual(blockers, ['the newest round raised 1 finding(s) at P2']);
    });

    test('a comment asking for the review is not the review', () => {
        // The trigger and the verdict arrive at the same place. Counting the
        // trigger would close the loop on the act of opening it.
        const { blockers } = state({
            reviews: [earlier],
            issueComments: [
                verdict('2026-09-20T11:00:00Z', { login: AUTHOR, body: '@claude review' }),
            ],
            comments: raised,
        });
        assert.deepEqual(blockers, ['the newest round raised 1 finding(s) at P2']);
    });

    test('nor is a bot comment that asks for one', () => {
        const { blockers } = state({
            reviews: [earlier],
            issueComments: [verdict('2026-09-20T11:00:00Z', { body: 'cc @claude review' })],
            comments: raised,
        });
        assert.deepEqual(blockers, ['the newest round raised 1 finding(s) at P2']);
    });

    test('nor an unedited note, which is the workflow saying it has started', () => {
        // Measured on #310: the note lands seconds after the request and is
        // edited into the verdict minutes later. Counting it where it appeared
        // would close the loop while the round is still reading.
        const note = verdict('2026-09-20T11:00:00Z', { noted: '2026-09-20T11:00:00Z' });
        const { blockers } = state({ reviews: [earlier], issueComments: [note], comments: raised });
        assert.deepEqual(blockers, ['the newest round raised 1 finding(s) at P2']);
    });

    test('nor a mark from a login that has never reviewed here', () => {
        // A mark says nothing about who made it beyond the login, so the login
        // has to have reviewed here before — otherwise a passer-by's 👍 clears
        // the one thing a clean round is allowed to clear.
        const { blockers } = state({
            reviews: [earlier],
            reactions: [reaction('2026-09-20T11:00:00Z', { login: 'a-passer-by' })],
            issueComments: [verdict('2026-09-20T11:00:00Z', { login: 'another-bot[bot]' })],
            comments: raised,
        });
        assert.deepEqual(blockers, ['the newest round raised 1 finding(s) at P2']);
    });

    test("nor a person's aside — somebody reviewing leaves a review", () => {
        const { blockers } = state({
            reviews: [earlier],
            issueComments: [
                verdict('2026-09-20T11:00:00Z', { login: 'a-colleague', body: 'looks good' }),
            ],
            comments: raised,
        });
        assert.deepEqual(blockers, ['the newest round raised 1 finding(s) at P2']);
    });
});

describe('two reviewers at one commit', () => {
    // Both are configured here, so this is the ordinary path. Keyed by reviewer,
    // the later round would hold only its own P3, and the other's P1 would be
    // absolved without a line of code changing.
    const codex = review(21, '2026-09-20T11:00:00Z', { login: 'codex[bot]' });
    const claude = review(22, '2026-09-20T11:05:00Z', { login: BOT });

    test('do not absolve each other: the scope is the commit', () => {
        const { blockers } = state({
            reviews: [codex, claude],
            comments: [
                finding(1, codex.id, 'codex[bot]'),
                answer(1, 'P1: deferred.'),
                finding(2, claude.id, BOT),
                answer(2, 'P3: a nit.'),
            ],
        });
        assert.deepEqual(blockers, ['the newest round raised 1 finding(s) at P1']);
    });

    test('and a mark landing in the same second does not either', () => {
        // A tie goes to the round that named a commit.
        const { blockers } = state({
            reviews: [codex],
            reactions: [reaction('2026-09-20T11:00:00Z', { login: 'codex[bot]' })],
            comments: [finding(1, codex.id, 'codex[bot]'), answer(1, 'P1: deferred.')],
        });
        assert.deepEqual(blockers, ['the newest round raised 1 finding(s) at P1']);
    });
});

describe("the author's own inline note", () => {
    test('is not a finding against them, and does not block their own merge', () => {
        // Left for a reviewer to read. Counting it would hold the gate until
        // they had answered themselves.
        const { rows, blockers } = state({
            reviews: [LAST],
            comments: [finding(1, LAST.id, AUTHOR)],
        });
        assert.deepEqual(rows, []);
        assert.deepEqual(blockers, []);
    });
});

describe('whether the newest round has seen this head', () => {
    // Reported, never a blocker: a P3 from the last round is fixed and merged
    // without asking for another look. And read from the review's own commit,
    // not from a moment — a commit written locally before a review and pushed
    // after it carries a timestamp older than the review that never saw it.
    test('is the commit the round was submitted against', () => {
        assert.equal(state({ reviews: [review(7, '2026-09-20T11:00:00Z')] }).seenHead, true);
    });

    test('is false for a round submitted against an earlier commit, and still no blocker', () => {
        const { seenHead, blockers } = state({
            reviews: [review(7, '2026-09-20T11:00:00Z', { commit: OLD_OID })],
        });
        assert.equal(seenHead, false);
        assert.deepEqual(blockers, []);
    });

    test('is unknown where the round is a verdict, which names no commit', () => {
        assert.equal(state({ issueComments: [verdict('2026-09-20T11:00:00Z')] }).seenHead, null);
    });
});
