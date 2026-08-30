// What may change about a requirement that already exists.
//
// The rule the catalogue is built on is that an identifier is permanent:
// somebody outside this repository may have written one down, and it must never
// come to mean something other than it did. Written down, that rule survives
// until the evening somebody fixes a promise in place because superseding it
// costs twenty minutes. Then the catalogue carries two regimes and neither is
// worth believing. So it is not written down, it is checked.
//
//   node scripts/requirements/guard.mjs                  against origin/main
//   node scripts/requirements/guard.mjs --base <ref>      against something else
//
// What is compared is the *promise*, not the file. Identifiers inside the prose
// are blanked before comparing, so following somebody else's supersession costs
// nothing — without that, one retired entry would force every entry mentioning
// it to be retired too, and a single reworded sentence would walk through the
// chapter. Emphasis and line breaks are dropped for the same reason: rewrapping
// a paragraph is not a change of what was promised.
//
// A correction that leaves the promise intact but does change its words — a
// typo, a clearer sentence — is claimed in the commit that makes it:
//
//   Editorial: SC-PLAN-004
//
// It lives there rather than in the entry because the claim is about one edit,
// not about the requirement, and because a reviewer can hold it against the
// diff sitting right beside it. A marker in the entry would outlive the typo it
// excused by years.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readCatalogue } from './parse.mjs';
import { annotationsIn, isTestPath, scanTests, standing, unproven } from './proof.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const RETIRED = new Set(['superseded', 'withdrawn']);

/**
 * Which state an entry may move to, once it exists.
 *
 * A proposal may be decided or dropped, a promise that stands may be replaced
 * or taken back, and nothing comes back. The transition missing from the table
 * on purpose is `current` to `draft`: it reads as tidying and it is a promise
 * being demoted to a proposal, and because prepending the marker leaves the
 * wording untouched, no comparison of the prose would ever notice.
 */
const ALLOWED = {
    draft: new Set(['draft', 'current', 'withdrawn']),
    current: new Set(['current', 'superseded', 'withdrawn']),
    superseded: new Set(['superseded']),
    withdrawn: new Set(['withdrawn']),
};
// One quantifier, not two that can trade characters: `[ \t]*(.+)` lets the
// same spaces belong to either half, which is polynomial backtracking on a long
// line and what `regexp/no-super-linear-backtracking` refuses. The splitting is
// done in code, where it is decidable.
const TRAILER = /^Editorial:(.*)$/gm;

/**
 * The promise, reduced to what it claims.
 *
 * Each step drops something that can change without the promise changing:
 * identifiers, because a reference follows a supersession; emphasis, because
 * bolding a phrase is typography; line breaks, because these files are wrapped
 * by hand at a hundred columns and one added word reflows the paragraph.
 *
 * The heading is part of it. Nineteen entries state their whole promise
 * there and carry no prose at all, so comparing the prose alone compared
 * two empty strings and accepted any rewrite of what they say.
 */
export function fingerprint(promise) {
    return promise
        .replace(/\bSC-[A-Z0-9]+-\d{3}(?![0-9-])/g, '«ref»')
        .replace(/[*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Title and prose together: nineteen entries keep their whole promise in the title. */
const promiseOf = (entry) => fingerprint(`${entry.title} — ${entry.text}`);

/** Why a move between two states is refused, in the words of the move itself. */
function transition(was, is) {
    if (was.status === 'current' && is.status === 'draft') {
        return (
            `${was.id} stood as a promise and is now a draft. A promise that no longer ` +
            'applies is withdrawn or superseded; demoting it to a proposal takes it back ' +
            'without saying so, and stops anything asking for a test of it.'
        );
    }
    if (RETIRED.has(was.status)) {
        return (
            `${was.id} was ${was.status} and is now ${is.status}. ` +
            'A promise that holds again is a new requirement, not an old one revived.'
        );
    }
    return `${was.id} moved from ${was.status} to ${is.status}, which is not a move it has.`;
}

/**
 * Every change to an entry that already existed, judged.
 *
 * Additions are not judged here — a new requirement is the point of the
 * exercise — and neither is anything a reader cannot see: a title, a source, a
 * chapter moving are all changes to the entry rather than to the promise.
 */
export function compare(before, after, editorial = new Set()) {
    const problems = [];
    const now = new Map(after.map((entry) => [entry.id, entry]));

    for (const was of before) {
        const is = now.get(was.id);
        if (!is) {
            // The one failure this whole scheme exists to prevent. Deleting an
            // entry frees its number, and the next requirement written in that
            // chapter silently inherits a meaning somebody else wrote down.
            problems.push(
                `${was.id} is gone. An identifier is never withdrawn by deletion — ` +
                    'mark it `_(Withdrawn on YYYY-MM-DD.)_` and leave it where it is.',
            );
            continue;
        }

        const changed = promiseOf(was) !== promiseOf(is);
        const isRetired = RETIRED.has(is.status);

        if (!ALLOWED[was.status].has(is.status)) problems.push(transition(was, is));

        // The delivery marker is stripped before fingerprinting, so removing it
        // costs nothing — implementing a promise is not rewriting it. Adding
        // one is the move that needs saying out loud: it takes a promise the
        // product kept and files it as an intention, and the entry stops being
        // owed a proof.
        if (was.delivered && !is.delivered && !editorial.has(was.id)) {
            problems.push(
                `${was.id} stood as delivered and now says it is not. If the product stopped ` +
                    'keeping it, that is a defect and belongs in an issue; if the promise itself ' +
                    'was wrong, supersede or withdraw it. If the old entry was simply mistaken, ' +
                    `say so: Editorial: ${was.id}`,
            );
        }

        if (!changed || editorial.has(was.id)) continue;

        if (isRetired) {
            // The entry stays so that a reader arriving from an old reference
            // finds what was promised. Rewriting it while retiring it leaves
            // them reading something nobody was ever told.
            problems.push(
                `${was.id} changed its wording while being ${is.status}. ` +
                    'Retiring an entry preserves what it said; the new wording belongs in the successor.',
            );
            continue;
        }

        problems.push(
            `${was.id} promises something different than it did.\n` +
                '    If the promise changed: mark this entry\n' +
                '      _(Superseded on YYYY-MM-DD by `SC-…`.)_\n' +
                '    and write the new wording as a new entry with the next free number.\n' +
                '    If it did not — a typo, a clearer sentence — say so in the commit:\n' +
                `      Editorial: ${was.id}`,
        );
    }

    return problems;
}

function git(root, ...args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * The identifiers named by tests at a revision, without checking it out.
 *
 * `git grep` exits 1 when a pattern matches nothing, which at the revision
 * before the first annotation is the ordinary case rather than a failure.
 */
function namedAt(root, ref) {
    let matched;
    try {
        matched = git(root, 'grep', '-F', '@requirement', ref);
    } catch {
        // `git grep` exits 1 when a pattern matches nothing, which at the
        // revision before the first annotation is ordinary rather than a
        // failure.
        return new Set();
    }
    // `ref:path:line`. The path is filtered through the same predicate the
    // working tree is walked with, because a ratchet whose two sides count
    // different populations reports changes nobody made.
    const named = new Set();
    for (const line of matched.split('\n')) {
        const at = line.indexOf(':', ref.length + 1);
        if (at === -1) continue;
        if (!isTestPath(line.slice(ref.length + 1, at))) continue;
        for (const id of annotationsIn(line.slice(at + 1))) named.add(id);
    }
    return named;
}

/**
 * Coverage moves one way: a new promise brings a proof, or one owed gains one.
 *
 * Three populations, because collapsing them into one count hides two failures.
 * A promise that had a proof and lost it is refused outright — nothing arrived
 * to pay for, and net-zero bookkeeping would let a proof be moved from one
 * promise to another and call it even. A promise that did not stand before must
 * be paid for by a promise that did and now has a test; retiring one proves
 * nothing about it and earns no credit.
 *
 * Backfilling 389 entries would have been a week of work for a number nobody
 * would trust afterwards, so nothing is backfilled and the debt is frozen. What
 * makes that liveable is that the credit is fungible: a promise with no test
 * worth writing can still be added by settling one already owed, rather than
 * through an exemption somebody has to judge.
 */
export function ratchet(before, after) {
    const stood = new Set(before.standing);
    const owed = new Set(before.debt);
    const owedNow = new Set(after.debt);

    const lost = after.debt.filter((id) => stood.has(id) && !owed.has(id));
    const arrived = after.debt.filter((id) => !stood.has(id));
    const settled = before.debt.filter((id) => after.standing.includes(id) && !owedNow.has(id));

    const problems = [];
    if (lost.length > 0) {
        problems.push(
            `${lost.length} promise(s) had a proof and no longer do: ${lost.join(', ')}.\n` +
                '    A test that named one of them is gone or no longer names it. Name it again,\n' +
                '    or retire the promise if it no longer holds.',
        );
    }
    if (arrived.length > settled.length) {
        problems.push(
            `${arrived.length} promise(s) arrived with nothing proving them, and ` +
                `${settled.length} already owed a proof gained one.\n` +
                `    Not named by any test: ${arrived.slice(0, 5).join(', ')}` +
                `${arrived.length > 5 ? `, and ${arrived.length - 5} more` : ''}\n` +
                '    Name it from the test that proves it:\n' +
                `      /** @requirement ${arrived[0]} */\n` +
                '    or annotate a test for a promise already owed.',
        );
    }
    return problems;
}

/** The identifiers the commits on this branch claim were edited editorially. */
export function editorialIn(log) {
    const claimed = new Set();
    for (const [, ids] of log.matchAll(TRAILER)) {
        for (const id of ids.split(/[\s,]+/).filter(Boolean)) claimed.add(id);
    }
    return claimed;
}

/**
 * The catalogue as of a ref, read through a checkout of just those files.
 *
 * `git show` one file at a time would need this to know the file list, which is
 * the thing that changed; `git archive` hands over the tree the ref actually
 * had, including chapters that have since been renamed or removed.
 */
function catalogueAt(root, ref) {
    const scratch = mkdtempSync(join(tmpdir(), 'saasicat-requirements-'));
    try {
        const listing = git(root, 'ls-tree', '-r', '--name-only', ref, 'requirements/');
        const files = listing.split('\n').filter((file) => file.endsWith('.md'));
        if (files.length === 0) return null;
        for (const file of files) {
            const target = join(scratch, file);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, git(root, 'show', `${ref}:${file}`));
        }
        return readCatalogue(scratch);
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

/**
 * Each step judged with the claims of the step that made it, and no others.
 *
 * This is the whole of what "per commit" buys. Judged as one diff with every
 * trailer on the branch pooled, a commit legitimately excusing a typo in
 * `SC-A-001` would also excuse a later commit rewriting it into a different
 * promise — the claim would outlive the edit it was made for.
 */
/**
 * A walk that judged nothing is reported, not passed.
 *
 * This check spent its first day proving nothing and staying green, which is
 * worse than not existing: a check that cannot fail is trusted. On a pull
 * request `HEAD` is the merge commit GitHub synthesises, the only step was that
 * merge, merges are skipped, and what remained was the merge result compared
 * against itself.
 */
export function nothingJudged(revisions, steps) {
    if (revisions.length === 0 || steps.length > 0) return [];
    return [
        `${revisions.length} revision(s) to judge and every one of them a merge. ` +
            'Nothing was compared, so nothing could fail. Name the head you mean with --head.',
    ];
}

export function judge(steps) {
    return steps.flatMap((step) => compare(step.before, step.after, step.editorial));
}

/**
 * Every step this branch took, judged on its own.
 *
 * Not the branch as one diff. An `Editorial:` trailer says that *this* edit left
 * the promise intact, and gathering every trailer between the merge base and
 * `HEAD` into one set lets the claim outlive the edit it was made for: a commit
 * legitimately excusing a typo in `SC-A-001` would then also excuse a later
 * commit rewriting it into a different promise. The claim is read from the
 * commit that makes the change, which is the only place it means anything.
 *
 * A merge is skipped rather than judged. Its diff carries somebody else's work,
 * which was judged on its own pull request; blaming this branch for it would
 * report changes nobody here made.
 */
export function guard(root, base) {
    const merged = git(root, 'merge-base', base, 'HEAD').trim();
    let previous = catalogueAt(root, merged);
    if (!previous) return { baseline: merged, problems: [], entries: 0, unproven: 0 };

    const steps = [];
    const revisions = git(root, 'rev-list', '--reverse', '--first-parent', `${merged}..HEAD`)
        .split('\n')
        .filter(Boolean);

    for (const revision of revisions) {
        const parents = git(root, 'rev-list', '--parents', '-n', '1', revision).trim().split(' ');
        const current = catalogueAt(root, revision);
        if (parents.length <= 2) {
            steps.push({
                before: previous.entries,
                after: current.entries,
                editorial: editorialIn(git(root, 'log', '--format=%B', '-n', '1', revision)),
            });
        }
        previous = current;
    }

    // The working tree is the last step, and it has no commit to speak for it.
    // Anything uncommitted is therefore judged with no claim available, which
    // is what putting the trailer in a commit means.
    const after = readCatalogue(root);
    steps.push({ before: previous.entries, after: after.entries, editorial: new Set() });

    const problems = judge(steps);

    const owed = unproven(after.entries, scanTests(root));
    const beforeDebt = unproven(catalogueAt(root, merged).entries, namedAt(root, merged));
    problems.push(
        ...ratchet(
            { debt: beforeDebt, standing: standing(catalogueAt(root, merged).entries) },
            { debt: owed, standing: standing(after.entries) },
        ),
    );

    return {
        baseline: merged,
        entries: after.entries.length,
        unproven: owed.length,
        problems,
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const at = process.argv.indexOf('--base');
    const base = at === -1 ? defaultBase(ROOT) : process.argv[at + 1];
    const { baseline, entries, unproven: owed, problems } = guard(ROOT, base);

    if (entries === 0) {
        process.stdout.write(`no catalogue at ${base} — nothing to compare against\n`);
    } else {
        for (const problem of problems) process.stderr.write(`${problem}\n\n`);
        process.stdout.write(
            `${entries} requirements at ${baseline.slice(0, 8)}, ` +
                `${owed} standing with nothing proving them: ` +
                `${problems.length || 'no'} problem(s)\n`,
        );
        if (problems.length) process.exitCode = 1;
    }
}

/**
 * `origin/main` where a remote exists, `main` in a bare local clone.
 *
 * Preferring the remote matters on a branch that has been open a while: the
 * local `main` may be days behind, and comparing against it would call a
 * promise unchanged that somebody else has since superseded.
 */
export function defaultBase(root) {
    try {
        git(root, 'rev-parse', '--verify', '--quiet', 'origin/main');
        return 'origin/main';
    } catch {
        return 'main';
    }
}
