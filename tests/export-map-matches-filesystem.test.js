import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `package.json#exports` is a promise the build has to keep.
//
// It did not. `@saasicat/ui-vue` declared a `types` condition for
// `./testing-e2e/*` pointing at `.d.ts` files that were never emitted — tsup
// runs its two configs concurrently, and the `clean: true` on one deleted the
// declarations the other had just written. Nothing failed: `pnpm build` was
// green, the runtime files existed, and only a consumer importing the entry
// under `moduleResolution: node16` would ever have noticed, as "implicitly has
// an 'any' type".
//
// That is the shape of every export-map defect: it is invisible from inside the
// repo and only breaks for someone who installed the package. This test looks
// from the outside.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

function packagesWithExports() {
    return readdirSync(PACKAGES_DIR)
        .map((dir) => ({ dir, manifest: join(PACKAGES_DIR, dir, 'package.json') }))
        .filter(({ manifest }) => existsSync(manifest))
        .map(({ dir, manifest }) => ({
            root: join(PACKAGES_DIR, dir),
            pkg: JSON.parse(readFileSync(manifest, 'utf8')),
        }))
        .filter(({ pkg }) => pkg.exports);
}

/** Flattens the condition tree into `[subpath, condition-chain, target]`. */
function targetsOf(exportsField) {
    const found = [];
    const walk = (node, subpath, conditions) => {
        if (typeof node === 'string') {
            found.push({ subpath, conditions, target: node });
            return;
        }
        for (const [key, value] of Object.entries(node)) {
            if (key.startsWith('.')) walk(value, key, conditions);
            else walk(value, subpath, [...conditions, key]);
        }
    };
    walk(exportsField, '.', []);
    return found;
}

/**
 * Resolves a wildcard target by substituting `*` with what actually exists.
 * Returns the concrete files a consumer could reach through the pattern.
 */
function resolveWildcard(root, target) {
    const [prefix, suffix] = target.split('*');
    const dir = join(root, prefix.replace(/\/[^/]*$/, ''));
    if (!existsSync(dir)) return [];
    const found = [];
    const walk = (current) => {
        for (const entry of readdirSync(current)) {
            const full = join(current, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (entry.endsWith(suffix)) found.push(full);
        }
    };
    walk(dir);
    return found;
}

describe('package.json#exports matches the filesystem', () => {
    const packages = packagesWithExports();

    test('the sweep finds the packages it claims to check', () => {
        // A renamed directory or a wrong cwd would otherwise turn every
        // assertion below into a vacuous pass.
        assert.ok(
            packages.length >= 6,
            `expected at least 6 packages with an exports map, found ${packages.length}`,
        );
    });

    for (const { root, pkg } of packages) {
        test(`${pkg.name}: every non-wildcard target exists`, () => {
            const missing = [];
            for (const { subpath, conditions, target } of targetsOf(pkg.exports)) {
                if (target.includes('*')) continue;
                if (!existsSync(join(root, target))) {
                    missing.push(`${subpath} [${conditions.join('.')}] → ${target}`);
                }
            }
            assert.deepEqual(
                missing,
                [],
                `${pkg.name} promises files that the build does not produce:\n  ` +
                    missing.join('\n  ') +
                    `\n\nRun the package build first; if it is still missing, the entry is ` +
                    `either stale or the build config drops it.`,
            );
        });

        test(`${pkg.name}: every wildcard pattern resolves to something`, () => {
            const empty = [];
            for (const { subpath, conditions, target } of targetsOf(pkg.exports)) {
                if (!target.includes('*')) continue;
                if (resolveWildcard(root, target).length === 0) {
                    empty.push(`${subpath} [${conditions.join('.')}] → ${target}`);
                }
            }
            assert.deepEqual(
                empty,
                [],
                `${pkg.name} declares wildcard entries that match no file:\n  ` +
                    empty.join('\n  '),
            );
        });

        test(`${pkg.name}: a require condition never hands out an ESM .d.ts`, () => {
            // The trap this catches: a flat `{ types, import, require }` shape
            // gives CJS consumers the ESM declaration. TypeScript under
            // node16/nodenext then reads the wrong module shape.
            const wrong = [];
            for (const { subpath, conditions, target } of targetsOf(pkg.exports)) {
                const isTypes = conditions.at(-1) === 'types';
                const underRequire = conditions.includes('require');
                if (isTypes && underRequire && !target.endsWith('.d.cts')) {
                    wrong.push(`${subpath} [${conditions.join('.')}] → ${target}`);
                }
            }
            assert.deepEqual(wrong, [], `${pkg.name}:\n  ` + wrong.join('\n  '));
        });

        test(`${pkg.name}: files[] covers every exported path`, () => {
            // npm publishes only what `files` lists (plus README/LICENSE/
            // package.json). An export outside it resolves locally and 404s
            // for everyone who installs the package.
            if (!pkg.files) return; // no files[] means "publish everything"
            const roots = pkg.files.map((f) => f.replace(/^\.\//, '').replace(/\/$/, ''));
            const uncovered = [];
            for (const { subpath, target } of targetsOf(pkg.exports)) {
                if (subpath === './package.json') continue;
                const clean = target.replace(/^\.\//, '');
                if (!roots.some((r) => clean === r || clean.startsWith(`${r}/`))) {
                    uncovered.push(`${subpath} → ${target}`);
                }
            }
            assert.deepEqual(
                uncovered,
                [],
                `${pkg.name} exports paths that npm would not publish ` +
                    `(files: ${JSON.stringify(pkg.files)}):\n  ` +
                    uncovered.join('\n  '),
            );
        });
    }
});

describe('the ui-vue source subpaths stay curated', () => {
    // Decision E3: the SFCs ship as source, so the export map is the only thing
    // separating public pages from internals. Two names for one path is how a
    // consumer ends up depending on the one that later disappears — notesapp
    // used `./pages/*`, vereinsfux `./pages-standard/*`, for the same files.
    const pkg = JSON.parse(
        readFileSync(join(PACKAGES_DIR, 'saas-platform-ui-vue', 'package.json'), 'utf8'),
    );

    /**
     * The one duplicate that exists today — described rather than listed.
     *
     * `./pages/…` and `./pages-standard/…` are two spellings of one thing.
     * Removing either breaks a consumer right now: measured on 2026-08-20, both
     * vereinsfux and autohauspro use BOTH spellings (14/20 and 16/26 files);
     * only notesapp is consistent. So it goes with the 1.0 codemod, not before.
     *
     * Derived, because the 4.1 move turned the pair from two globs into a glob
     * plus a per-file entry for each page that left `pages/` — `AdminLayout`
     * to `layouts/`, the two auth screens to `auth/`. Each of those is the same
     * duplicate again, and listing them one by one would grow an exception list
     * that stops being read. A pair qualifies when the two subpaths differ in
     * exactly that one segment; anything else is a new duplicate and fails.
     */
    const isTheKnownPagesAlias = (subpaths) =>
        subpaths.length === 2 &&
        subpaths
            .map((s) =>
                s.replace('/pages-standard/', '/pages/').replace('./pages-standard/', './pages/'),
            )
            .every((s, _, all) => s === all[0]);

    /** `[ "./a + ./b", … ]` — sorted, so the assertion does not depend on key order. */
    function duplicateGroups() {
        const byTarget = new Map();
        for (const [subpath, value] of Object.entries(pkg.exports)) {
            if (typeof value !== 'string') continue;
            byTarget.set(value, [...(byTarget.get(value) ?? []), subpath]);
        }
        return [...byTarget.values()]
            .filter((subpaths) => subpaths.length > 1)
            .map((subpaths) => subpaths.sort().join(' + '))
            .sort();
    }

    test('no NEW subpath duplicates a target', () => {
        const unexpected = duplicateGroups().filter((g) => !isTheKnownPagesAlias(g.split(' + ')));

        assert.deepEqual(
            unexpected,
            [],
            'Two import paths for one target. Consumers then split across both, and ' +
                'removing either one becomes a breaking change:\n  ' +
                unexpected.join('\n  '),
        );
    });

    test('the accepted duplicates are still real', () => {
        // A rule that no longer describes anything is worse than no rule: it
        // reads like a constraint while protecting nothing. When the 1.0
        // codemod collapses the alias, this fails and `isTheKnownPagesAlias`
        // goes with it.
        const known = duplicateGroups().filter((g) => isTheKnownPagesAlias(g.split(' + ')));

        assert.notEqual(
            known.length,
            0,
            'No `pages` / `pages-standard` duplicate is left — the exemption in ' +
                '`isTheKnownPagesAlias` protects nothing now and should be deleted.',
        );
    });
});
