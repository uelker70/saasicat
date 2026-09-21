#!/usr/bin/env node
// Whether a pull request's review loop is still open, read off the pull
// request rather than off whoever is asking.
//
// The rule it answers is one sentence: a round must come back with no P0, P1 or
// P2 before the loop ends, and nothing is merged while a finding is unanswered.
// It was prose, and prose is applied by whoever remembers it — which on #308
// failed in both directions on one afternoon. A round was requested after a
// clean one, and then, after a round that did raise a P2, three announcements
// that the loop was over. Each break came with a reason that sounded
// responsible; none of them was the rule.
//
// Two things make an answer possible here. The findings are data: a root review
// comment is a finding, and a reply under it is the answer to it. And the level
// is data too, because the answer has to carry one — Codex prints a `P2` badge,
// a Claude review does not print a level at all, so the classification is
// written where it is made rather than recalled later. That is the same
// discipline the register's tables ask for, one level down, and it is what
// turns "the last round was fine" from a memory into a count.
//
// What it refuses to guess: a review body is prose, so the script never reads a
// level out of one. An unclassified finding blocks, which is the safe
// direction — it asks for the judgement instead of inventing it.
//
//   node scripts/review-state.mjs <pr>            what the pull request says
//   node scripts/review-state.mjs <pr> --gate     exit 1 unless it may be merged

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LEVELS = ['P0', 'P1', 'P2', 'P3'];
/** The levels that keep the loop open. P3 is a finding, and it does not. */
const KEEPS_OPEN = new Set(['P0', 'P1', 'P2']);

/** One page-following call to the GitHub API, as JSON. */
function api(path) {
    const out = execFileSync(
        'gh',
        ['api', '--paginate', `${path}${path.includes('?') ? '&' : '?'}per_page=100`],
        {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        },
    );
    // `--paginate` concatenates the pages' arrays; `jq -s add` is the documented
    // way to join them, and doing it here keeps the call free of a shell.
    return out
        .split('\n')
        .filter((line) => line.trim())
        .flatMap((line) => JSON.parse(line));
}

/**
 * The level an answer opens with, or `null`.
 *
 * Read from the answer rather than from the finding, because only one reviewer
 * prints a level and the rule needs one for every finding.
 *
 * From the **opening**, and not from anywhere in the body, which is the lesson
 * of the first shape: "exactly one level mentioned" was defeated by every answer
 * that did its job. An answer explaining why a P1 is a P1 says what an earlier
 * P2 cost, or which P3 it is not — four of the nine answers on this pull request
 * named a second level in passing, and all four read as unclassified. A marker
 * at the front is a place a judgement is put, not a word that happens to appear.
 *
 * Split into words and compared as data: a pattern built from the level is what
 * the repository's own ESLint rule refuses, and this reads `P2000` correctly
 * without anyone having to reason about a word boundary.
 */
export function levelOf(body) {
    // Leading emphasis and whitespace only; anything else and the line is prose
    // that begins with something, not a classification.
    const [first] = (body ?? '').replace(/^[\s*_]+/, '').split(/[^A-Za-z0-9]+/);
    return LEVELS.includes(first) ? first : null;
}

function roundsIn({ reviews, issueComments, reactions, author }) {
    // Who has reviewed this pull request at all. A round that found nothing
    // leaves only a mark, and a mark says nothing about who made it beyond the
    // login — so the login has to have reviewed here before. Without that, a
    // passer-by's 👍 or an unrelated bot's comment clears the severity scope,
    // which is the one thing a clean round is allowed to do.
    const reviewers = new Set(
        reviews.filter((r) => r.submitted_at && r.user?.login).map((r) => r.user.login),
    );

    const byCommit = new Map();
    for (const review of reviews) {
        if (!review.submitted_at || !review.user?.login || review.user.login === author) continue;
        const key = `${review.user.login}@${review.commit_id ?? ''}`;
        const round = byCommit.get(key) ?? {
            kind: 'review',
            login: review.user.login,
            commit: review.commit_id ?? null,
            at: review.submitted_at,
            ids: [],
        };
        round.ids.push(review.id);
        if (Date.parse(review.submitted_at) > Date.parse(round.at)) round.at = review.submitted_at;
        byCommit.set(key, round);
    }

    // The workflow writes a progress note when it picks the request up and
    // edits it into the verdict when it is done — measured on #310, where the
    // note landed 14 seconds after the request and the verdict four minutes
    // later. So an unedited comment is a round that has not spoken, and the
    // moment of one that has is when it was edited, not when it appeared.
    const verdicts = issueComments
        .filter(
            (comment) =>
                comment.user?.login !== author &&
                reviewers.has(comment.user?.login) &&
                comment.updated_at > comment.created_at &&
                !comment.body?.includes('@claude'),
        )
        .map((comment) => ({
            kind: 'verdict',
            login: comment.user.login,
            commit: null,
            at: comment.updated_at,
            ids: [],
        }));

    // 👍 is how Codex says it found nothing. 👀 is the acknowledgement that the
    // request was picked up, seconds after it — taking that for a verdict would
    // close the loop on the act of opening it.
    const nods = reactions
        .filter(
            (reaction) =>
                reaction.user?.login !== author &&
                reviewers.has(reaction.user?.login) &&
                reaction.content === '+1',
        )
        .map((reaction) => ({
            kind: 'nod',
            login: reaction.user.login,
            commit: null,
            at: reaction.created_at,
            ids: [],
        }));

    // Compared as moments, never as text: `11:04:10Z` sorts before
    // `12:50:52+02:00` while being the later of the two. A tie goes to the round
    // that named a commit, so a mark landing in the same second as a review
    // cannot absolve what the review raised.
    const rank = { review: 1, verdict: 0, nod: 0 };
    return [...byCommit.values(), ...verdicts, ...nods].sort(
        (a, b) => Date.parse(a.at) - Date.parse(b.at) || rank[a.kind] - rank[b.kind],
    );
}

/**
 * What the pull request says about its own loop. Pure, so each decision can be
 * broken on purpose and seen to fail — a guard whose own failure nobody has
 * watched is a guess.
 */
export function assess({ reviews, issueComments, reactions, comments, headOid, author }) {
    // A root comment of the author's own is a note to a reviewer, not a finding
    // against them. Counting it would block the gate until they answered
    // themselves.
    const findings = comments.filter((c) => c.in_reply_to_id == null && c.user?.login !== author);
    const answers = new Map();
    for (const c of comments) {
        if (c.in_reply_to_id == null) continue;
        answers.set(c.in_reply_to_id, [...(answers.get(c.in_reply_to_id) ?? []), c]);
    }
    const rows = findings.map((finding) => {
        const replies = answers.get(finding.id) ?? [];
        // The last level named, not the first: a thread can escalate, and the
        // considered judgement is the one at the end of it.
        const levels = replies.map((reply) => levelOf(reply.body)).filter(Boolean);
        return { finding, replies, level: levels.at(-1) ?? null };
    });

    const rounds = roundsIn({ reviews, issueComments, reactions, author });
    const newest = rounds.at(-1) ?? null;

    const unanswered = rows.filter((row) => row.replies.length === 0);
    const unclassified = rows.filter((row) => row.replies.length > 0 && !row.level);
    // Only the newest round decides whether another is owed. A P2 from three
    // rounds ago was fixed, and its answer still says P2 — the level of a
    // finding does not change when it is dealt with. What changes is that a
    // later round looked and found nothing above P3. Counting the whole history
    // would leave the loop open for good, which is the unbounded loop the round
    // limit exists to prevent. A round that left a verdict or a nod raised
    // nothing, so nothing is scoped to it.
    // Scoped by the commit, not by the round that happens to be newest: two
    // reviewers at one head are two rounds, and taking only the later one lets
    // a P3 from one absolve a P1 from the other without a line of code changing.
    // Both reviewers are configured here, so that is the ordinary path.
    const commitOf = new Map(reviews.map((review) => [review.id, review.commit_id ?? null]));
    const latest =
        newest?.kind === 'review'
            ? rows.filter(
                  (row) => commitOf.get(row.finding.pull_request_review_id) === newest.commit,
              )
            : [];
    const keptOpen = latest.filter((row) => row.level && KEEPS_OPEN.has(row.level));

    const blockers = [];
    if (unanswered.length) blockers.push(`${unanswered.length} finding(s) with no answer`);
    if (unclassified.length)
        blockers.push(`${unclassified.length} answer(s) naming no single level`);
    if (keptOpen.length) {
        const levels = [...new Set(keptOpen.map((row) => row.level))].sort().join(', ');
        blockers.push(`the newest round raised ${keptOpen.length} finding(s) at ${levels}`);
    }
    if (!newest) blockers.push('nobody but the author has reviewed it');

    // Read from the review's own commit rather than from a moment: a commit
    // written locally before a review and pushed after it carries a timestamp
    // older than the review that never saw it, and no comparison of moments can
    // tell that apart from a review that did. A verdict or a nod names no
    // commit, so the honest answer there is that it is not known.
    //
    // Not a blocker either way, and deliberately: a P3 from the last round is
    // fixed and merged without asking for another look.
    const seenHead = newest?.commit ? newest.commit === headOid : null;
    return { rows, blockers, rounds, newest, seenHead };
}

function main() {
    const [pr, ...flags] = process.argv.slice(2);
    if (!pr || !/^\d+$/.test(pr)) {
        console.error('usage: node scripts/review-state.mjs <pr> [--gate]');
        process.exit(2);
    }
    const repo = execFileSync(
        'gh',
        ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
        {
            encoding: 'utf8',
        },
    ).trim();

    const reviews = api(`repos/${repo}/pulls/${pr}/reviews`);
    const comments = api(`repos/${repo}/pulls/${pr}/comments`);
    const issueComments = api(`repos/${repo}/issues/${pr}/comments`);
    const reactions = api(`repos/${repo}/issues/${pr}/reactions`);
    // The head and the author come from GitHub, not from the checkout: the
    // command takes any pull request number, and a maintainer running it from a
    // plain checkout of `main`, or from a shallow clone, has no local object for
    // that head to ask about.
    const [headOid, author] = execFileSync(
        'gh',
        ['pr', 'view', pr, '--json', 'headRefOid,author', '--jq', '.headRefOid, .author.login'],
        { encoding: 'utf8' },
    )
        .trim()
        .split('\n');

    const { rows, blockers, rounds, newest, seenHead } = assess({
        reviews,
        issueComments,
        reactions,
        comments,
        headOid,
        author,
    });

    console.log(`${repo}#${pr} — head ${headOid.slice(0, 8)}, opened by ${author}`);
    console.log(
        `sources: ${reviews.length} reviews, ${issueComments.length} issue comments, ` +
            `${reactions.length} reactions — ${rounds.length} round(s), ${rows.length} finding(s)`,
    );
    for (const { finding, replies, level } of rows) {
        const where = `${finding.path.split('/').at(-1)}:${finding.line ?? finding.original_line}`;
        const state = replies.length === 0 ? 'UNANSWERED' : (level ?? 'UNCLASSIFIED');
        console.log(`  ${state.padEnd(12)} ${where}  (${finding.user.login})`);
    }

    // Printed rather than only counted: a wrong attribution is then on screen
    // at the moment it decides something, instead of deciding it quietly.
    const seen =
        seenHead === null
            ? 'against a commit it does not name'
            : seenHead
              ? 'against this head'
              : 'against an earlier commit';
    console.log(
        newest
            ? `  newest round: ${newest.login} at ${newest.at}, as a ${newest.kind}, ${seen}`
            : '  newest round: none',
    );

    const gate = flags.includes('--gate');
    if (blockers.length === 0) {
        // Never "reviewed at this head" unless it was: the line seven above may
        // have just said the opposite, and two sentences that disagree teach a
        // reader to believe neither.
        // Three states, three sentences: `null` is "it names no commit", which
        // is the ordinary shape of a clean round and must not read as "not at
        // this head" while the line above says otherwise.
        const reviewed =
            seenHead === null
                ? 'though against a commit it does not name'
                : seenHead
                  ? 'at this head'
                  : 'though not at this head';
        console.log(
            gate
                ? `\n✓ answered, classified, and reviewed ${reviewed} — it may be merged.`
                : '\n✓ the loop is closed.',
        );
        return;
    }
    console.log(`\n${gate ? '✗ not mergeable' : '✗ the loop is open'}: ${blockers.join('; ')}.`);
    console.log('  Fix, push, wait for CI, then request the next round.');
    // Only the gate fails the shell. The report is asked a question and answers
    // it; exiting non-zero there buries it under the runner's own error.
    if (gate) process.exit(1);
}

// The same entry guard as `scripts/build-stamp.mjs` and `scripts/token-audit.mjs`:
// a suffix match would also fire for a file that merely ends the same way.
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    main();
}
