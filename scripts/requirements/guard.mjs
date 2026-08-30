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
import { annotationsIn, isTestPath, scanTests, unproven } from './proof.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const RETIRED = new Set(['superseded', 'withdrawn']);
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
 */
export function fingerprint(promise) {
    return promise
        .replace(/\bSC-[A-Z0-9]+-\d{3}\b/g, '«ref»')
        .replace(/[*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
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

        const changed = fingerprint(was.text) !== fingerprint(is.text);
        const wasRetired = RETIRED.has(was.status);
        const isRetired = RETIRED.has(is.status);

        if (wasRetired && !isRetired) {
            // A promise that was taken back does not quietly come back. If it
            // holds again it holds for a reason, and the reason deserves an
            // entry of its own that says so.
            problems.push(
                `${was.id} was ${was.status} and is current again. ` +
                    'A promise that holds again is a new requirement, not an old one revived.',
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
 * A promise that stands and nothing proves may not become more common.
 *
 * Backfilling 389 entries would be a week of work, so nothing is backfilled and
 * the debt is frozen instead: a new promise brings its test, or pays for itself
 * by proving one that was already owed. A fixed target would have been the
 * worse instrument — every number anybody could name here is either met today
 * and toothless, or unreachable and routed around.
 */
export function ratchet(before, after) {
    if (after.length <= before.length) return [];
    const added = after.filter((id) => !before.includes(id));
    return [
        `${after.length} promises stand with nothing proving them, up from ${before.length}.\n` +
            `    Not named by any test: ${added.slice(0, 5).join(', ')}` +
            `${added.length > 5 ? `, and ${added.length - 5} more` : ''}\n` +
            '    Name it from the test that proves it:\n' +
            `      /** @requirement ${added[0] ?? 'SC-…'} */\n` +
            '    or annotate an existing test to pay for it.',
    ];
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

export function guard(root, base) {
    const merged = git(root, 'merge-base', base, 'HEAD').trim();
    const before = catalogueAt(root, merged);
    if (!before) return { baseline: merged, problems: [], entries: 0 };
    const after = readCatalogue(root);
    const editorial = editorialIn(git(root, 'log', '--format=%B', `${merged}..HEAD`));
    const owed = unproven(after.entries, scanTests(root));
    return {
        baseline: merged,
        entries: before.entries.length,
        unproven: owed.length,
        problems: [
            ...compare(before.entries, after.entries, editorial),
            ...ratchet(unproven(before.entries, namedAt(root, merged)), owed),
        ],
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
