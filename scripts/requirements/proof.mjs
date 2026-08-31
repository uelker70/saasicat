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
            const [, head, id, rest] = parts;
            const title = titleOf(id);
            // `/** @requirement SC-A-001 */` ends on its own line. Replacing
            // everything after the identifier would take the terminator with
            // it and comment out the rest of the file — and this is the form
            // the documentation shows first, so it would be the first thing a
            // newcomer hit.
            const closes = rest.trimEnd().endsWith('*/') ? ' */' : '';
            return title ? `${head}${id} — ${title}${closes}` : `${head}${id}${closes}`;
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
    /**
     * The name a `describe`, `test` or `it` line gives what it opens.
     *
     * A string literal yields its contents; anything else yields the expression
     * as written. A case named at run time — `test(JSON.stringify(input), …)`
     * inside a loop — cannot be named statically, and dropping it made eight
     * real cases invisible to a trace whose whole point is that a requirement
     * shows what covers it. The expression is what a reader searches the file
     * for, which is also why a template literal is recorded as written rather
     * than expanded: `${op} sends the request` finds the line, the op does not.
     *
     * Scanned rather than matched. A pattern for "the first argument" needs two
     * quantifiers that can each claim the same characters, and a long line then
     * costs more than reading it once.
     */
    const nameIn = (line) => {
        const opens = /^\s*(?:describe|suite|test|it)(?:\.\w+)?\(/.exec(line);
        if (!opens) return undefined;
        let from = opens[0].length;
        while (line[from] === ' ' || line[from] === '\t') from++;
        const quote = line[from];
        if (quote === "'" || quote === '"' || quote === '`') {
            const to = line.indexOf(quote, from + 1);
            return to === -1 ? undefined : line.slice(from + 1, to);
        }
        let depth = 0;
        for (let at = from; at < line.length; at++) {
            const char = line[at];
            if ('([{'.includes(char)) depth++;
            else if (')]}'.includes(char)) {
                if (depth === 0) break;
                depth--;
            } else if (char === ',' && depth === 0) return line.slice(from, at).trim() || undefined;
        }
        return undefined;
    };
    const isComment = (line) => /^\s*(?:\/\/|\/\*|\*)/.test(line);

    /**
     * The name of the case a line opens, or nothing if it opens none.
     *
     * `test.each([…])('name', …)` runs one case per row of its table, and
     * Prettier puts the table on its own lines — so the name is not on the line
     * that opens the call, it follows the closing `])(`. Read only the opening
     * line and every parameterised case in the repository is invisible to the
     * trace while running perfectly well.
     */
    const caseAt = (at) => {
        if (/^\s*(?:test|it)\(/.test(lines[at])) return nameIn(lines[at]);
        if (!/^\s*(?:test|it)\.each\(/.test(lines[at])) return null;
        for (let i = at; i < lines.length; i++) {
            const named = /\]\s*\)\s*\(\s*['"`]([^'"`]+)/.exec(lines[i]);
            if (named) return named[1];
            if (i > at && /^\s*(?:describe|test|it)[.(]/.test(lines[i])) break;
        }
        return null;
    };

    // A suite is skipped by its own line, not by its cases'. Reading only
    // `test.skip` let a `describe.skip` hold a dozen ordinary cases and report
    // every one of them as proof — which is the one thing a coverage number
    // must never say. Depth rather than braces, for the same reason the rest of
    // this reads indentation: Prettier owns the formatting of every file here.
    const skipped = new Array(lines.length).fill(false);
    const open = [];

    // And the suites a line sits in, so a case is named by its path rather than
    // by its leaf. Five suites in one file each holding "the endpoint is
    // required" produced five identical lines under the requirement — a trace
    // whose one job is to say which case to open.
    const path = lines.map(() => []);
    const suites = [];

    lines.forEach((line, at) => {
        if (!line.trim()) return;
        const depth = indent(line);
        while (open.length > 0 && depth <= open.at(-1)) open.pop();
        while (suites.length > 0 && depth <= suites.at(-1).depth) suites.pop();
        skipped[at] = open.length > 0;
        path[at] = suites.map((suite) => suite.title);
        if (/^\s*(?:describe|suite)\.skip\(/.test(line)) open.push(depth);
        if (/^\s*(?:describe|suite)(?:\.\w+)?\(/.test(line)) {
            const title = nameIn(line);
            if (title) suites.push({ depth, title });
        }
    });

    /** A case where it stands, by its full path, or nothing where it does not run. */
    const caseNameAt = (at) => {
        const leaf = skipped[at] ? null : caseAt(at);
        return leaf ? [...path[at], leaf].join(' › ') : null;
    };

    /** The cases under a block: deeper-indented, until the indentation returns. */
    const casesUnder = (at) => {
        const depth = indent(lines[at]);
        const names = [];
        for (let i = at + 1; i < lines.length; i++) {
            if (lines[i].trim() && indent(lines[i]) <= depth) break;
            // `test(` and not `test.skip(` — deliberately, not by accident of
            // the pattern. A skipped case is a case that does not run.
            const name = caseNameAt(i);
            if (name) names.push(name);
        }
        return names;
    };

    const everyCase = lines.map((_, at) => caseNameAt(at)).filter(Boolean);

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

        const block = /^\s*(?:describe|suite)(?:\.\w+)?\(/.test(line);
        const opens = block ? nameIn(line) : caseAt(at);
        if (opens && pending.length > 0) {
            const ids = pending;
            pending = [];
            // A block with no live case under it proves nothing, and must not
            // stand in for one: a suite whose cases are all skipped would
            // otherwise read as covered, which is the one thing a coverage
            // number must never say.
            // The path comes from the walk, not from this branch: an
            // annotation on a nested block used to name one level of it.
            const names = block ? casesUnder(at) : [caseNameAt(at)].filter(Boolean);
            for (const id of ids) for (const name of names) found.push({ id, case: name });
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

/**
 * What the tests say about the requirements, in three separate readings.
 *
 * `annotated` is every annotation in the tree, whatever it turned out to
 * cover; `proved` and `cases` are only the ones a case that runs sits under.
 *
 * They have to stay apart. Coverage must be strict — an annotation over a suite
 * whose cases are all skipped mentions a requirement and proves nothing — but
 * the checks that reject an unknown or a retired identifier, and the rewriter
 * that keeps the titles current, have to see *every* annotation or they read
 * past exactly the ones that went wrong. Folding the two into one map left a
 * mistyped identifier over a skipped case invisible to the check written to
 * catch it.
 */
export function scanTests(root, groups = GROUPS) {
    const annotated = new Map();
    const proved = new Map();
    const cases = new Map();
    const note = (map, id, where) => {
        if (!map.has(id)) map.set(id, []);
        if (!map.get(id).includes(where)) map.get(id).push(where);
    };
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
            for (const id of annotationsIn(source)) note(annotated, id, where);
            for (const { id, case: name } of casesIn(source)) {
                note(proved, id, where);
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
    return { annotated, proved, cases };
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
