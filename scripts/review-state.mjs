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
 * The level an answer declares, or `null`.
 *
 * Read from the answer rather than from the finding, because only one reviewer
 * prints a level and the rule needs one for every finding. A reply that names
 * several is ambiguous and counts as none: an ambiguous classification is a
 * judgement that was not made.
 */
export function levelOf(body) {
    // Split into words and compare as data. A pattern built from the level
    // would be the thing the repository's own ESLint rule refuses, and this
    // reads `P2000` correctly without anyone having to think about a boundary.
    const words = new Set(body.split(/[^A-Za-z0-9]+/));
    const found = LEVELS.filter((level) => words.has(level));
    return found.length === 1 ? found[0] : null;
}

/**
 * What the pull request says about its own loop, from the four sources and the
 * moment of its head commit. Pure, so the decision can be broken on purpose and
 * seen to fail — a guard whose own failure nobody has watched is a guess.
 */
export function assess({ reviews, comments, headAt, author }) {
    const findings = comments.filter((c) => c.in_reply_to_id == null);
    const answers = new Map();
    for (const c of comments) {
        if (c.in_reply_to_id == null) continue;
        answers.set(c.in_reply_to_id, [...(answers.get(c.in_reply_to_id) ?? []), c]);
    }
    const rows = findings.map((finding) => {
        const replies = answers.get(finding.id) ?? [];
        return {
            finding,
            replies,
            level: replies.map((r) => levelOf(r.body)).find(Boolean) ?? null,
        };
    });

    const unanswered = rows.filter((row) => row.replies.length === 0);
    const unclassified = rows.filter((row) => row.replies.length > 0 && !row.level);
    const keptOpen = rows.filter((row) => row.level && KEEPS_OPEN.has(row.level));
    // The newest review by the moment it was submitted, not by the order the
    // API happened to return: a round that lands while another is being written
    // would otherwise decide the question by position.
    // And not the author's own. Replying to a finding creates a review record
    // with an empty body, so answering the last round would otherwise count as
    // having been reviewed — the guard would go green on the one move that
    // changes nothing about who has looked.
    //
    // Compared as moments, never as text: `git` writes the committer's offset
    // and GitHub writes `Z`, so `11:04:10Z` sorts before `12:50:52+02:00` while
    // being the later of the two. A round that had seen the head would then
    // read as one that had not.
    const at = (moment) => Date.parse(moment);
    const newest = reviews
        .filter((review) => review.submitted_at && review.user?.login !== author)
        .reduce(
            (latest, review) =>
                !latest || at(review.submitted_at) > at(latest.submitted_at) ? review : latest,
            null,
        );

    const blockers = [];
    if (unanswered.length) blockers.push(`${unanswered.length} finding(s) with no answer`);
    if (unclassified.length)
        blockers.push(`${unclassified.length} answer(s) naming no single level`);
    if (keptOpen.length) {
        const levels = [...new Set(keptOpen.map((row) => row.level))].sort().join(', ');
        blockers.push(`${keptOpen.length} finding(s) at ${levels}`);
    }
    if (!newest || at(newest.submitted_at) <= at(headAt))
        blockers.push('no review newer than the head commit');
    return { rows, blockers };
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
    const head = execFileSync(
        'gh',
        ['pr', 'view', pr, '--json', 'headRefOid', '--jq', '.headRefOid'],
        {
            encoding: 'utf8',
        },
    ).trim();
    const headAt = execFileSync('git', ['show', '-s', '--format=%cI', head], {
        encoding: 'utf8',
    }).trim();

    const author = execFileSync(
        'gh',
        ['pr', 'view', pr, '--json', 'author', '--jq', '.author.login'],
        {
            encoding: 'utf8',
        },
    ).trim();

    const { rows, blockers } = assess({ reviews, comments, headAt, author });

    console.log(`${repo}#${pr} — head ${head.slice(0, 8)} of ${headAt}`);
    console.log(
        `sources: ${reviews.length} reviews, ${rows.length} findings, ` +
            `${issueComments.length} issue comments, ${reactions.length} reactions`,
    );
    for (const { finding, replies, level } of rows) {
        const where = `${finding.path.split('/').at(-1)}:${finding.line ?? finding.original_line}`;
        const state = replies.length === 0 ? 'UNANSWERED' : (level ?? 'UNCLASSIFIED');
        console.log(`  ${state.padEnd(12)} ${where}  (${finding.user.login})`);
    }

    const gate = flags.includes('--gate');
    if (blockers.length === 0) {
        console.log(
            gate
                ? '\n✓ answered, classified and reviewed at this head — it may be merged.'
                : '\n✓ the loop is closed.',
        );
        return;
    }
    console.log(`\n${gate ? '✗ not mergeable' : '✗ the loop is open'}: ${blockers.join('; ')}.`);
    console.log('  Fix, push, wait for CI, then request the next round.');
    process.exit(1);
}

if (process.argv[1]?.endsWith('review-state.mjs')) main();
