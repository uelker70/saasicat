// @requirement SC-COMP-008 — An implementation offers only what it can actually answer

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// What a package emits into `dist/` has to be exactly what its entry points
// reach — no more, no less.
//
// Both halves are load-bearing, and they are the two ways the build's prune
// (`scripts/build-and-prune.mjs`) can go wrong:
//
//   too eager  — a file that is still imported gets deleted. The package
//                installs and then fails at require time, or hands TypeScript
//                a declaration whose import resolves to nothing.
//   too shy    — outputs from earlier builds pile up. That is not theoretical
//                here: esbuild's code-splitting gives `@saasicat/nest` a
//                different set of `chunk-*.js` names on nearly every run, so
//                without a prune the directory grows on every build and ships
//                dead code.
//
// Neither shows up in a package's own test suite, because those import the
// entry points, which resolve fine while orphans sit next to them.
//
// Run the build first — this test reads `dist/`.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/** Files whose contents are scanned for references, and which must be reached. */
const CODE = /\.(js|cjs|mjs)$/;
const DECLARATION = /\.d\.(ts|cts|mts)$/;

/** `from './x'`, `import './x'`, `import('./x')`, `require('./x')`. */
const RELATIVE_SPECIFIER =
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["'](\.[^"']*)["']/g;

const isFile = (p) => existsSync(p) && statSync(p).isFile();

function filesUnder(dir) {
    const found = [];
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else found.push(full);
        }
    };
    walk(dir);
    return found;
}

/** Every `./dist/…` path the manifest points a consumer at, `*` expanded. */
/**
 * Every file some OTHER file in `dist/` imports.
 *
 * A bundler chunk lands wherever its entry does, so a subpath pattern's range
 * is a subtree and not a list of entry points: `./testing/*` covers any
 * `.js` below `dist/testing/`, chunks included. That matters for the
 * sibling comparison below, which would otherwise demand a `.d.ts` beside a
 * `chunk-XXXX.js` and report a file no consumer was ever pointed at as
 * missing. What separates the two is not in the manifest but in the output: an
 * entry is imported by a consumer, a chunk by a sibling.
 */
function referencedWithin(distFiles) {
    const referenced = new Set();
    for (const file of distFiles) {
        if (!CODE.test(file) && !DECLARATION.test(file)) continue;
        for (const [, specifier] of readFileSync(file, 'utf8').matchAll(RELATIVE_SPECIFIER)) {
            const target = resolveSpecifier(file, specifier);
            if (target !== null) referenced.add(target);
        }
    }
    return referenced;
}

function entryPoints(root, pkg, distFiles, referenced) {
    const roots = new Set();
    const missing = [];
    /** Per export key, what each of its `*` patterns expanded to. */
    const expansions = new Map();

    const add = (target, key) => {
        if (typeof target !== 'string' || !target.startsWith('./dist/')) return;
        const abs = join(root, target);
        if (!target.includes('*')) {
            // A target that is gone contributed nothing to `roots`, nothing to
            // `dangling` and nothing to the orphan set, so a prune that took a
            // standalone declaration left every assertion green while a
            // consumer importing it got no types.
            if (isFile(abs)) roots.add(abs);
            else missing.push(target);
            return;
        }
        // Node permits exactly one `*` in a subpath pattern. Split rather than
        // assumed: two would silently drop everything after the second, and a
        // pattern this reader cannot expand must be reported, not guessed at.
        const parts = abs.split('*');
        if (parts.length !== 2) {
            missing.push(`${target} (a subpath pattern may contain exactly one \`*\`)`);
            return;
        }
        const [head, tail] = parts;
        const matched = new Set();
        for (const file of distFiles) {
            if (!file.startsWith(head) || !file.endsWith(tail)) continue;
            // Still a root: the manifest offers every match to a consumer, so a
            // leftover in that range is importable rather than unreachable, and
            // the orphan half is deliberately quiet about it.
            roots.add(file);
            // Not a sibling, though. See `referencedWithin`.
            if (!referenced.has(file)) {
                matched.add(file.slice(head.length, file.length - tail.length));
            }
        }
        // A glob may legitimately match nothing — but the conditions of ONE key
        // describe one set of modules in different formats, so they must expand
        // to the same names. `./testing/*` naming `*.js`, `*.cjs`, `*.d.ts`
        // and `*.d.cts` is four patterns over one module; a prune that took the
        // `.d.cts` leaves that pattern expanding to nothing while its siblings
        // still name the module, which is the only evidence the manifest gives.
        if (key) {
            const seen = expansions.get(key) ?? [];
            seen.push({ target, matched });
            expansions.set(key, seen);
        }
    };

    const walk = (node, key) => {
        if (typeof node === 'string') return add(node, key);
        if (!node || typeof node !== 'object') return;
        for (const [name, value] of Object.entries(node)) {
            walk(value, key ?? (name.startsWith('.') ? name : null));
        }
    };
    walk(pkg.exports, null);
    for (const field of ['main', 'module', 'types']) add(pkg[field], null);

    for (const patterns of expansions.values()) {
        const union = new Set(patterns.flatMap(({ matched }) => [...matched]));
        for (const { target, matched } of patterns) {
            for (const name of union) {
                if (!matched.has(name)) missing.push(target.replaceAll('*', name));
            }
        }
    }

    return { roots: [...roots], missing };
}

/**
 * Resolves a relative specifier the way the referencing file's own loader
 * would. A declaration file writes `from './x.js'` and means `./x.d.ts`.
 */
function resolveSpecifier(fromFile, specifier) {
    const base = resolve(dirname(fromFile), specifier);
    // Exclusive, not cumulative. A declaration's relative reference is
    // type-only: it must resolve to a declaration or it is broken. Appending
    // the JavaScript fallbacks to the declaration list let `index.d.ts` saying
    // `from './x.js'` resolve to `x.js` after `x.d.ts` had been pruned away —
    // no dangling entry, and `x.d.ts` is not in `distFiles` to be reported as
    // an orphan either, so a broken type graph passed clean.
    if (DECLARATION.test(fromFile)) {
        // An extensionless reference is ambiguous when both flavours share a
        // basename, which this output does (`catalog-*.d.ts` beside
        // `catalog-*.d.cts`). The flavour of the file doing the referencing
        // decides, so its own extension is tried first rather than relying on
        // the emitter always writing `./x.cjs` inside a `.d.cts`.
        const own = fromFile.endsWith('.d.cts')
            ? ['.d.cts', '.d.ts', '.d.mts']
            : fromFile.endsWith('.d.mts')
              ? ['.d.mts', '.d.ts', '.d.cts']
              : ['.d.ts', '.d.cts', '.d.mts'];
        return (
            [
                base.replace(/\.js$/, '.d.ts'),
                base.replace(/\.cjs$/, '.d.cts'),
                base.replace(/\.mjs$/, '.d.mts'),
                ...own.map((extension) => `${base}${extension}`),
                ...own.map((extension) => join(base, `index${extension}`)),
            ].find(isFile) ?? null
        );
    }
    return (
        [
            base,
            `${base}.js`,
            `${base}.cjs`,
            `${base}.mjs`,
            join(base, 'index.js'),
            join(base, 'index.cjs'),
        ].find(isFile) ?? null
    );
}

/** Follows every relative reference from the entry points outwards. */
function traverse(roots) {
    const reached = new Set();
    const dangling = [];
    const queue = [...roots];
    while (queue.length > 0) {
        const file = queue.pop();
        if (reached.has(file)) continue;
        reached.add(file);
        for (const [, specifier] of readFileSync(file, 'utf8').matchAll(RELATIVE_SPECIFIER)) {
            const target = resolveSpecifier(file, specifier);
            if (target === null) dangling.push(`${file} → ${specifier}`);
            else if (!reached.has(target)) queue.push(target);
        }
    }
    return { reached, dangling };
}

function builtPackages() {
    return readdirSync(PACKAGES_DIR)
        .map((dir) => join(PACKAGES_DIR, dir))
        .filter((root) => existsSync(join(root, 'package.json')) && existsSync(join(root, 'dist')))
        .map((root) => {
            const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
            const distFiles = filesUnder(join(root, 'dist'));
            const referenced = referencedWithin(distFiles);
            const { roots, missing } = entryPoints(root, pkg, distFiles, referenced);
            return { root, pkg, distFiles, roots, missing, ...traverse(roots) };
        });
}

describe('dist/ contains exactly what the entry points reach', () => {
    const packages = builtPackages();

    test('every package that builds was swept', () => {
        // Derived from the workspace rather than counted by hand: a floor set
        // one below the real number lets exactly the interesting case — one
        // package's build script broken, so it emits no dist/ — sail through.
        // `packages/` only, deliberately: `pnpm-workspace.yaml` also covers
        // `examples/`, but nothing there is published, so it has no export map
        // to hold to and no consumer to point at a pruned file.
        const expected = readdirSync(PACKAGES_DIR)
            .map((dir) => join(PACKAGES_DIR, dir, 'package.json'))
            .filter(existsSync)
            .filter((manifest) => JSON.parse(readFileSync(manifest, 'utf8')).scripts?.build)
            .map((manifest) => dirname(manifest));

        assert.deepEqual(
            expected
                .filter((root) => !packages.some((p) => p.root === root))
                .map((root) => relative(REPO_ROOT, root)),
            [],
            'a package declares a build script but has no dist/. Run `pnpm -r build` first; ' +
                'if it is still missing, that package did not emit anything.',
        );
    });

    for (const { pkg, roots, missing, distFiles, reached, dangling } of packages) {
        test(`${pkg.name}: the export map names entry points that exist`, () => {
            assert.ok(
                roots.length > 0,
                `${pkg.name} has a dist/ but no export target resolves into it — ` +
                    'the checks below would pass without looking at anything.',
            );
        });

        test(`${pkg.name}: every export target the manifest commits to is on disk`, () => {
            assert.deepEqual(
                missing,
                [],
                `${pkg.name} points consumers at files that are not there. A target the ` +
                    'manifest names — exactly, or through a pattern whose sibling conditions ' +
                    'still name the module — has to exist: it reaches no reachability check ' +
                    'and no orphan list, so a prune that took one leaves every other ' +
                    'assertion green while an import of it gets nothing.',
            );
        });

        test(`${pkg.name}: every relative reference inside dist/ resolves`, () => {
            assert.deepEqual(
                dangling.map((d) => relative(REPO_ROOT, d)),
                [],
                `${pkg.name} ships imports that point at files which are not there. ` +
                    'Either the build stopped emitting them, or the prune in ' +
                    'scripts/build-and-prune.mjs removed a file that is still in use.',
            );
        });

        test(`${pkg.name}: no emitted file is unreachable`, () => {
            const orphans = distFiles
                .filter((file) => CODE.test(file) || DECLARATION.test(file))
                .filter((file) => !reached.has(file))
                .map((file) => relative(REPO_ROOT, file));

            assert.deepEqual(
                orphans,
                [],
                `${pkg.name} carries output that nothing imports — leftovers from an ` +
                    'earlier build. They ship to consumers as dead weight and hide ' +
                    'which files the current build actually produces.',
            );
        });
    }
});
