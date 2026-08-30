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
 * An identifier is replaced by where its supersession chain ends, not by one
 * token for all of them. Blanking them equally made following a supersession
 * free, which it should be — and made swapping one dependency for an unrelated
 * one free too, which it should not: the promise then leans on a different
 * contract and says so nowhere. Resolved, the two are told apart, because only
 * a reference that was superseded into the new one lands on the same answer.
 *
 * Only backticks are dropped, because only a backtick is never part of what it
 * wraps. An underscore belongs to `tenant_id` and an asterisk to `*.json`, and
 * dropping them made those the same promise as `tenantid` and `.json` — a key
 * or a pattern could be changed inside a requirement with nothing to say about
 * it. The catalogue uses neither for emphasis today, so nothing is lost by
 * keeping them and a whole class of silent rewrites is closed.
 *
 * The heading is part of it. Nineteen entries state their whole promise
 * there and carry no prose at all, so comparing the prose alone compared
 * two empty strings and accepted any rewrite of what they say.
 */
export function fingerprint(promise, follow = () => '«ref»') {
    return promise
        .replace(/\bSC-[A-Z0-9]+-\d{3}(?![\w-])/g, follow)
        .replace(/`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Title and prose together: nineteen entries keep their whole promise in the title. */
const promiseOf = (entry, follow) => fingerprint(`${entry.title} — ${entry.text}`, follow);

/**
 * Where a reference ends up, following supersessions to the end of the chain.
 *
 * Read from the state a change arrives at, because that is the state that knows
 * what has been superseded into what. A reference to something retired resolves
 * to its successor, so the text that still names the old one and the text that
 * names the new one say the same thing.
 */
function follower(entries) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return (id) => {
        const seen = new Set();
        let at = byId.get(id);
        while (at?.status === 'superseded' && at.supersededBy && !seen.has(at.id)) {
            seen.add(at.id);
            at = byId.get(at.supersededBy) ?? at;
        }
        return at?.id ?? id;
    };
}

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
    const follow = follower(after);
    const problems = [];
    const now = new Map(after.map((entry) => [entry.id, entry]));

    for (const was of before) {
        const is = now.get(was.id);
        if (!is) {
            // The one failure this whole scheme exists to prevent. Deleting an
            // entry frees its number, and the next requirement written in that
            // chapter silently inherits a meaning somebody else wrote down.
            problems.push({
                id: was.id,
                message:
                    `${was.id} is gone. An identifier is never withdrawn by deletion — ` +
                    'mark it `_(Withdrawn on YYYY-MM-DD.)_` and leave it where it is.',
            });
            continue;
        }

        const changed = promiseOf(was, follow) !== promiseOf(is, follow);
        const isRetired = RETIRED.has(is.status);

        const flag = (message) => problems.push({ id: was.id, message });

        if (!ALLOWED[was.status].has(is.status)) flag(transition(was, is));

        // The delivery marker is stripped before fingerprinting, so removing it
        // costs nothing — implementing a promise is not rewriting it. Adding
        // one is the move that needs saying out loud: it takes a promise the
        // product kept and files it as an intention, and the entry stops being
        // owed a proof.
        if (was.delivered && !is.delivered && !editorial.has(was.id)) {
            flag(
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
            flag(
                `${was.id} changed its wording while being ${is.status}. ` +
                    'Retiring an entry preserves what it said; the new wording belongs in the successor.',
            );
            continue;
        }

        flag(
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

/** The parents of a revision, oldest first. */
function parentsOf(root, revision) {
    return git(root, 'rev-list', '--parents', '-n', '1', revision).trim().split(' ').slice(1);
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
const cached = new Map();

function catalogueAt(root, ref) {
    // Every revision is now read twice — once as itself and once as its
    // successor's parent — and a merge adds one more. Reading a tree is
    // twenty-five `git show` calls, so the same revision is read once.
    const key = `${root}@${ref}`;
    if (!cached.has(key)) cached.set(key, readCatalogueAt(root, ref));
    return cached.get(key);
}

function readCatalogueAt(root, ref) {
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
export function judge(steps) {
    return steps.flatMap((step) =>
        ownWork(
            step.parents.map((before) => ({
                ids: new Set(before.map((entry) => entry.id)),
                problems: compare(before, step.after, step.editorial),
            })),
        ),
    );
}

/**
 * Of a revision, what it did itself rather than inherited.
 *
 * One rule for every revision, because a commit and a merge differ only in how
 * many parents they have. A parent acquits an entry when it **has** that entry
 * and finds nothing wrong with it: whoever wrote that version answered for it
 * where they wrote it.
 *
 * Having it is the half that is easy to forget. A parent that never carried the
 * identifier is silent about it too, and that silence means absence, not
 * agreement — so merging a topic branch older than a requirement and rewriting
 * that requirement in the resolution used to pass, because the old branch had
 * nothing to say and was read as saying nothing was wrong.
 *
 * Every parent's findings are considered, not the first one's. The parent that
 * notices a change need not be the parent listed first.
 */
function ownWork(perParent) {
    const acquitted = (id) =>
        perParent.some(
            ({ ids, problems }) => ids.has(id) && !problems.some((problem) => problem.id === id),
        );

    const seen = new Set();
    return perParent
        .flatMap(({ problems }) => problems)
        .filter((problem) => {
            if (seen.has(problem.id) || acquitted(problem.id)) return false;
            seen.add(problem.id);
            return true;
        });
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
 * A merge is judged for its resolution alone. Its diff carries somebody else's
 * work, which was judged on its own pull request — but resolving a conflict can
 * rewrite or delete a requirement, and that edit belongs to nobody else.
 */
export function guard(root, base, head) {
    const tip = head ?? 'HEAD';
    const merged = git(root, 'merge-base', base, tip).trim();
    if (!catalogueAt(root, merged)) {
        return { baseline: merged, problems: [], entries: 0, unproven: 0, judged: 0 };
    }

    // Every revision in the range, not the first-parent chain. A merge from
    // `main` brings work judged on its own pull request, and skipping the chain
    // it came from was right about that — but a branch that merges a local
    // topic branch imports commits nobody reviewed, and those were never
    // walked. The merge then acquitted them, because the entry matches the
    // parent they arrived on.
    const revisions = git(root, 'rev-list', '--reverse', `${merged}..${tip}`)
        .split('\n')
        .filter(Boolean);

    const steps = revisions.map((revision) => ({
        revision,
        parents: parentsOf(root, revision).map((parent) => catalogueAt(root, parent).entries),
        after: catalogueAt(root, revision).entries,
        editorial: editorialIn(git(root, 'log', '--format=%B', '-n', '1', revision)),
    }));

    // A named head judges exactly that revision. Without one the working tree is
    // the last step, and it has no commit to speak for it — anything
    // uncommitted is judged with no claim available, which is what putting the
    // trailer in a commit means.
    const after = head ? catalogueAt(root, head) : readCatalogue(root);
    if (!head) {
        steps.push({
            parents: [catalogueAt(root, tip).entries],
            after: after.entries,
            editorial: new Set(),
        });
    }

    const owed = unproven(after.entries, head ? namedAt(root, head) : scanTests(root));
    const baseline = catalogueAt(root, merged);
    return {
        baseline: merged,
        entries: after.entries.length,
        unproven: owed.length,
        judged: revisions.length,
        problems: [
            ...judge(steps).map((problem) => problem.message),
            ...ratchet(
                {
                    debt: unproven(baseline.entries, namedAt(root, merged)),
                    standing: standing(baseline.entries),
                },
                { debt: owed, standing: standing(after.entries) },
            ),
        ],
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const flag = (name, fallback) => {
        const at = process.argv.indexOf(name);
        return at === -1 ? fallback : process.argv[at + 1];
    };
    const base = flag('--base', defaultBase(ROOT));
    // CI names the head it means. On a pull request the checkout is the merge
    // commit GitHub synthesises, and judging that against itself is how a check
    // comes to prove nothing.
    const head = flag('--head', undefined);
    const { baseline, entries, unproven: owed, problems } = guard(ROOT, base, head);

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
