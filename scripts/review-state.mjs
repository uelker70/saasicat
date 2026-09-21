#!/usr/bin/env node
// What a pull request's findings say, counted rather than remembered.
//
// Two rules were prose, and prose is applied by whoever recalls it. On #308 both
// broke in one afternoon: a round requested after a clean one, then, after a
// round that did raise a P2, three announcements that the loop was over. And a
// pull request was called ready to merge while five findings had no answer at
// all — the same way #187 went in with three unread P2.
//
//   nothing merges while a finding is unanswered
//   a round must come back with no P0, P1 or P2 before the loop ends
//
// The first is countable and is enforced here. The second needs to know when a
// round came back **clean**, and that is where four rounds of review on this
// script went: a round that finds something leaves review records, several of
// them, each with an empty body — but a round that finds nothing leaves no
// record at all, only an edited comment or a reaction. Every attempt to
// reconstruct it from those side-effects had a hole, because the thing being
// reconstructed is not in the data.
//
// So it is not reconstructed. Whoever read the round writes one line:
//
//   Round clean at <sha>
//
// That is the repository's own rule for an undecidable case — answered by
// declaration, not by a better guess — and it is the only judgement this script
// asks for. Everything else it counts.
//
//   node scripts/review-state.mjs <pr>            what the pull request says
//   node scripts/review-state.mjs <pr> --gate     exit 1 unless it may be merged

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LEVELS = ['P0', 'P1', 'P2', 'P3'];
/** The levels that keep the loop open. P3 is a finding, and it does not. */
const KEEPS_OPEN = new Set(['P0', 'P1', 'P2']);
/** How somebody says a round came back with nothing. */
const CLEAN = /^round clean at ([0-9a-f]{7,40})\b/i;

/** One page-following call to the GitHub API, as JSON. */
function api(path) {
    const out = execFileSync(
        'gh',
        ['api', '--paginate', `${path}${path.includes('?') ? '&' : '?'}per_page=100`],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    // `--paginate` concatenates the pages' arrays, one per line.
    return out
        .split('\n')
        .filter((line) => line.trim())
        .flatMap((line) => JSON.parse(line));
}

/**
 * The level an answer opens with, or `null`.
 *
 * From the opening, and not from anywhere in the body: an answer explaining why
 * something is a `P1` says what an earlier `P2` cost, and asking for exactly one
 * level in the text made four of nine real answers read as unclassified. A
 * marker at the front is a place a judgement is put; a word further down is a
 * word.
 *
 * Split into words and compared as data — a pattern built from the level is what
 * the repository's own ESLint rule refuses, and this reads `P2000` correctly
 * without anyone reasoning about a word boundary.
 */
export function levelOf(body) {
    const [first] = (body ?? '').replace(/^[\s*_]+/, '').split(/[^A-Za-z0-9]+/);
    return LEVELS.includes(first) ? first : null;
}

/**
 * What the pull request says about itself. Pure, so each decision can be broken
 * on purpose and seen to fail.
 *
 * Findings are scoped to the commit they were raised against, not to the review
 * record or the reviewer: one round leaves several records, and two reviewers at
 * one head must not absolve each other.
 */
export function assess({ reviews, issueComments, comments, author }) {
    // A root comment of the author's own is a note to a reviewer, not a finding
    // against them.
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

    const at = (moment) => Date.parse(moment);
    const reviewsById = new Map(reviews.filter((r) => r.submitted_at).map((r) => [r.id, r]));
    const raised = rows
        .map((row) => reviewsById.get(row.finding.pull_request_review_id))
        .filter(Boolean);
    // The last review that actually raised something. A review record with no
    // finding under it is an answer of the author's, or an empty shell.
    const newest = raised.reduce(
        (latest, review) =>
            !latest || at(review.submitted_at) > at(latest.submitted_at) ? review : latest,
        null,
    );
    const lastRaised = newest
        ? rows.filter(
              (row) =>
                  reviewsById.get(row.finding.pull_request_review_id)?.commit_id ===
                  newest.commit_id,
          )
        : [];
    const keptOpen = lastRaised.filter((row) => row.level && KEEPS_OPEN.has(row.level));

    // The one judgement this script does not make. Compared as moments, because
    // `git` writes the committer's offset and GitHub writes `Z`.
    const declared = issueComments
        .map((comment) => ({ comment, match: CLEAN.exec(comment.body?.trim() ?? '') }))
        .filter(({ match }) => match)
        .map(({ comment, match }) => ({
            at: comment.created_at,
            sha: match[1],
            login: comment.user?.login ?? '?',
        }));
    const clean = newest
        ? declared.find((one) => at(one.at) > at(newest.submitted_at))
        : declared.at(-1);

    const unanswered = rows.filter((row) => row.replies.length === 0);
    const unclassified = rows.filter((row) => row.replies.length > 0 && !row.level);

    const blockers = [];
    if (unanswered.length) blockers.push(`${unanswered.length} finding(s) with no answer`);
    if (unclassified.length) blockers.push(`${unclassified.length} answer(s) naming no level`);
    if (keptOpen.length && !clean) {
        const levels = [...new Set(keptOpen.map((row) => row.level))].sort().join(', ');
        blockers.push(
            `${keptOpen.length} finding(s) at ${levels} were the last raised, and no clean round is declared since`,
        );
    }
    return { rows, blockers, newest, lastRaised, clean };
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
        { encoding: 'utf8' },
    ).trim();

    const reviews = api(`repos/${repo}/pulls/${pr}/reviews`);
    const comments = api(`repos/${repo}/pulls/${pr}/comments`);
    const issueComments = api(`repos/${repo}/issues/${pr}/comments`);
    // Read and reported but never decided on: Codex answers "nothing to report"
    // with a 👍 and no comment at all, so a reader needs to see it — and the
    // script must not mistake it for the declaration it cannot verify.
    const reactions = api(`repos/${repo}/issues/${pr}/reactions`);
    // From GitHub, not from the checkout: the command takes any pull request
    // number, and a plain checkout of `main` has no local object for that head.
    const [headOid, author] = execFileSync(
        'gh',
        ['pr', 'view', pr, '--json', 'headRefOid,author', '--jq', '.headRefOid, .author.login'],
        { encoding: 'utf8' },
    )
        .trim()
        .split('\n');

    const { rows, blockers, newest, lastRaised, clean } = assess({
        reviews,
        issueComments,
        comments,
        author,
    });

    console.log(`${repo}#${pr} — head ${headOid.slice(0, 8)}, opened by ${author}`);
    console.log(
        `sources: ${reviews.length} reviews, ${issueComments.length} issue comments, ` +
            `${reactions.length} reactions — ${rows.length} finding(s)`,
    );
    for (const { finding, replies, level } of rows) {
        const where = `${finding.path.split('/').at(-1)}:${finding.line ?? finding.original_line}`;
        const state = replies.length === 0 ? 'UNANSWERED' : (level ?? 'UNCLASSIFIED');
        console.log(`  ${state.padEnd(12)} ${where}  (${finding.user.login})`);
    }
    if (newest) {
        const tally = LEVELS.map((level) => [
            level,
            lastRaised.filter((row) => row.level === level).length,
        ]).filter(([, n]) => n);
        console.log(
            `  last raised at ${newest.commit_id?.slice(0, 8) ?? '?'}: ` +
                (tally.map(([level, n]) => `${n}×${level}`).join(', ') || 'nothing classified yet'),
        );
    }
    console.log(
        clean
            ? `  clean round declared by ${clean.login} at ${clean.sha.slice(0, 8)}`
            : '  no clean round declared since',
    );

    const gate = flags.includes('--gate');
    if (blockers.length === 0) {
        console.log(gate ? '\n✓ it may be merged.' : '\n✓ the loop is closed.');
        return;
    }
    console.log(`\n${gate ? '✗ not mergeable' : '✗ the loop is open'}: ${blockers.join('; ')}.`);
    console.log('  Fix, push, request the next round — and when one comes back with nothing,');
    console.log('  say so: a comment reading `Round clean at <sha>`.');
    // Only the gate fails the shell; the report is asked a question and answers it.
    if (gate) process.exit(1);
}

// The same entry guard as `scripts/build-stamp.mjs` and `scripts/token-audit.mjs`.
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    main();
}
