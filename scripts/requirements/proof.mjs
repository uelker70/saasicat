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

// One quantifier between the tag and the identifier, so no two parts of the
// pattern can claim the same whitespace.
const ANNOTATION = /@requirement\s(\s*)(SC-[A-Z0-9]+-\d{3})/g;

const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', '.worktrees', 'var']);
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Every requirement a piece of source claims to prove. */
export function annotationsIn(text) {
    return [...text.matchAll(ANNOTATION)].map(([, , id]) => id);
}

/**
 * The identifiers named across the tests, mapped to the files naming them.
 *
 * A directory called `tests` counts whole, because the suites here keep
 * fixtures and helpers beside the files that run — and a helper asserting a
 * rule is proving it just as much as the case that calls the helper.
 */
export function scanTests(root, groups = ['packages', 'examples', 'tests']) {
    const found = new Map();
    const visit = (dir, insideTests) => {
        for (const name of readdirSync(dir)) {
            if (SKIP.has(name)) continue;
            const path = join(dir, name);
            if (statSync(path).isDirectory()) {
                visit(path, insideTests || name === 'tests');
                continue;
            }
            if (!insideTests && !IS_TEST.test(name)) continue;
            for (const id of annotationsIn(readFileSync(path, 'utf8'))) {
                if (!found.has(id)) found.set(id, []);
                found.get(id).push(path.slice(root.length + 1));
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
    return entries
        .filter((entry) => entry.status === 'current' && entry.delivered)
        .filter((entry) => !named.has(entry.id))
        .map((entry) => entry.id);
}
