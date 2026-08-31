// Which promises anything actually proves.
//
// The catalogue says 399 things and, when it was written, nothing anywhere
// named one of them. A stakeholder document nothing is tied to is a claim, not
// a guarantee — and for a product strangers build on, that is the gap worth
// closing before any other.
//
// A test names the promise it proves:
//
//   /** @requirement SC-PLAN-004 */
//
// The link goes this way round on purpose. In the test it sits beside the thing
// it describes and moves when that moves; in the requirement it would be a
// second list of test identifiers to keep in step with the first, and the two
// would drift the first time a file was renamed.
//
// Backfilling 399 entries would be a week of work for a number nobody would
// trust afterwards, so nothing is backfilled. `guard.mjs` ratchets instead: the
// count of unproven promises may not go up. A new promise brings its test, or
// pays for itself by proving an old one.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A tag opening a comment line, not a mention inside one.
//
// Matching the bare word counted prose: the test that documents this predicate
// names `@requirement SC-PLAN-004` in a sentence about it, and that sentence
// proved SC-PLAN-004. A file explaining the mechanism is the one file most
// likely to mention it, so the failure lands where it is least expected.
//
// The comment marker is required rather than optional. Optional, the two
// whitespace runs around it could each claim the same spaces — the exchange
// `regexp/no-super-linear-backtracking` refuses — and an annotation is in a
// comment anyway.
// The identifier ends where it ends, and nothing that could continue a name may
// follow it. `SC-PLAN-0049`, `SC-PLAN-004-extra`, `SC-PLAN-004x` and
// `SC-PLAN-004_extra` all read as `SC-PLAN-004` under a narrower boundary, so a
// mistyped identifier would settle a debt owed by a promise nobody had named.
const ANNOTATION =
    /^[ \t]*(?:\/\/+|\/\*+|\*)[ \t]*@requirement[ \t]+(SC-[A-Z0-9]+-\d{3})(?![\w-])/gm;

/**
 * An annotation line, split into the identifier and whatever follows it.
 *
 * What follows is the requirement's title, written there so that a reader of
 * the test learns what it answers for without opening the catalogue. It is
 * written by `requirements:update` and checked, never typed: a title copied by
 * hand into hundreds of files is a title that goes stale the first time
 * somebody rewords a requirement, and then it misleads exactly the reader it
 * was added for.
 */
export const ANNOTATION_PARTS =
    /^([ \t]*(?:\/\/+|\/\*+|\*)[ \t]*@requirement[ \t]+)(SC-[A-Z0-9]+-\d{3})(?![\w-])(.*)$/u;

/**
 * Every annotation line rewritten to carry its requirement's title.
 *
 * Returns the text unchanged where nothing is out of date, so a caller can tell
 * whether anything moved without comparing the whole file itself.
 */
export function withTitles(text, titleOf) {
    return text
        .split('\n')
        .map((line) => {
            const parts = ANNOTATION_PARTS.exec(line);
            if (!parts) return line;
            const [, head, id] = parts;
            const title = titleOf(id);
            return title ? `${head}${id} — ${title}` : `${head}${id}`;
        })
        .join('\n');
}

/** The same, one line at a time, for reading a file's structure. */
const ANNOTATION_LINE =
    /^[ \t]*(?:\/\/+|\/\*+|\*)[ \t]*@requirement[ \t]+(SC-[A-Z0-9]+-\d{3})(?![\w-])/u;

const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', '.worktrees', 'var']);
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * The cases an annotation covers, and what they are called.
 *
 * Naming the file alone answered "is this proved" and not "by what" — and "by
 * what" is the question somebody asks when a requirement changes and they have
 * to find the cases that go with it.
 *
 * An annotation covers what it opens. Above the imports it speaks for the whole
 * file; directly above a `describe` it speaks for that block's cases; directly
 * above a `test` it speaks for that one. "Directly above" is meant literally —
 * anything but comment and blank lines in between ends it, so an annotation
 * cannot drift onto a block it was never written for.
 *
 * Blocks are followed by indentation rather than by braces, which is exact
 * enough because Prettier owns the formatting of every file this reads.
 */
export function casesIn(text) {
    const lines = text.split('\n');
    const indent = (line) => line.length - line.trimStart().length;
    const titleOf = (line) => /(?:describe|test|it)\(\s*['"`]([^'"`]+)['"`]/.exec(line)?.[1];
    const isComment = (line) => /^\s*(?:\/\/|\/\*|\*)/.test(line);

    /** The cases under a block: deeper-indented, until the indentation returns. */
    const casesUnder = (at) => {
        const depth = indent(lines[at]);
        const names = [];
        for (let i = at + 1; i < lines.length; i++) {
            if (lines[i].trim() && indent(lines[i]) <= depth) break;
            // `test(` and not `test.skip(` — deliberately, not by accident of
            // the pattern. A skipped case is a case that does not run.
            if (/^\s*(?:test|it)\(/.test(lines[i])) {
                const name = titleOf(lines[i]);
                if (name) names.push(name);
            }
        }
        return names;
    };

    const everyCase = lines
        .map((line) => (/^\s*(?:test|it)\(/.test(line) ? titleOf(line) : null))
        .filter(Boolean);

    const found = [];
    let pending = [];
    let opened = false;

    lines.forEach((line, at) => {
        const annotated = ANNOTATION_LINE.exec(line);
        if (annotated) {
            // Before any code, an annotation speaks for the file.
            if (!opened) for (const name of everyCase) found.push({ id: annotated[1], case: name });
            else pending.push(annotated[1]);
            return;
        }

        const title = titleOf(line);
        if (title && pending.length > 0) {
            const ids = pending;
            pending = [];
            // A block with no live case under it proves nothing, and must not
            // stand in for one: a suite whose cases are all skipped would
            // otherwise read as covered, which is the one thing a coverage
            // number must never say.
            const block = /^\s*describe\(/.test(line);
            const names = block ? casesUnder(at) : [title];
            for (const id of ids) {
                for (const name of names) {
                    found.push({ id, case: block ? `${title} › ${name}` : name });
                }
            }
            opened = true;
            return;
        }

        if (line.trim() && !isComment(line)) {
            // Anything else ends both the file's opening and a pending claim.
            opened = true;
            pending = [];
        }
    });

    return found;
}

/** Every requirement a piece of source claims to prove. */
export function annotationsIn(text) {
    return [...text.matchAll(ANNOTATION)].map(([, id]) => id);
}

export const GROUPS = ['packages', 'examples', 'tests'];

/**
 * Whether a repository-relative path is somewhere a proof may live.
 *
 * Exported because the ratchet measures two revisions and they have to count
 * the same population. They cannot walk the same way — one has a working tree,
 * the other has a revision — so they share this instead. When they did not, the
 * older side searched every file in the repository and found the example
 * `@requirement SC-PLAN-004` in a comment; the newer side searched the tests
 * and did not. The debt then read one lower on the side it was compared
 * against, and the ratchet reported a rise that nobody had caused.
 *
 * A directory called `tests` counts whole, because the suites here keep
 * fixtures and helpers beside the files that run — and a helper asserting a
 * rule proves it as much as the case that calls the helper.
 */
export function isTestPath(path) {
    const parts = path.split('/');
    if (!GROUPS.includes(parts[0])) return false;
    if (parts.some((part) => SKIP.has(part))) return false;
    return parts.includes('tests') || IS_TEST.test(parts.at(-1));
}

/** The identifiers named across the tests, mapped to the files naming them. */
export function scanTests(root, groups = GROUPS) {
    const found = new Map();
    const cases = new Map();
    const visit = (dir, insideTests) => {
        for (const name of readdirSync(dir)) {
            if (SKIP.has(name)) continue;
            const path = join(dir, name);
            if (statSync(path).isDirectory()) {
                visit(path, insideTests || name === 'tests');
                continue;
            }
            if (!insideTests && !IS_TEST.test(name)) continue;
            const source = readFileSync(path, 'utf8');
            const where = path.slice(root.length + 1);
            // A requirement counts as proved when a case that runs names it —
            // not when a file mentions it. An annotation over a suite whose
            // cases are all skipped mentions it and proves nothing.
            for (const { id, case: name } of casesIn(source)) {
                if (!found.has(id)) found.set(id, []);
                if (!found.get(id).includes(where)) found.get(id).push(where);
                if (!cases.has(id)) cases.set(id, []);
                cases.get(id).push({ file: where, case: name });
            }
        }
    };
    for (const group of groups) {
        const base = join(root, group);
        try {
            visit(base, group === 'tests');
        } catch {
            // A group that is not in this tree is not an error: the same
            // scanner reads an older revision, where one may not exist yet.
        }
    }
    found.cases = cases;
    return found;
}

/**
 * The promises that stand today and nothing names.
 *
 * Only those: a draft is not a promise yet, a retired one is not one any more,
 * and one marked as decided-but-not-delivered has nothing to prove until it is
 * built. Counting those would ask for tests of things that are not true, and
 * the number would stop meaning anything the moment somebody wrote one.
 */
export function unproven(entries, named) {
    return standing(entries).filter((id) => !named.has(id));
}

/** Every promise the product claims to keep today, proved or not. */
export function standing(entries) {
    return entries
        .filter((entry) => entry.status === 'current' && entry.delivered)
        .map((entry) => entry.id);
}
