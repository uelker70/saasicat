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
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.[^"']*)["']/g;

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
function entryPoints(root, pkg, distFiles) {
    const roots = new Set();
    const add = (target) => {
        if (typeof target !== 'string' || !target.startsWith('./dist/')) return;
        const abs = join(root, target);
        if (!target.includes('*')) {
            if (isFile(abs)) roots.add(abs);
            return;
        }
        const pattern = new RegExp(
            '^' +
                abs
                    .split('*')
                    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                    .join('.*') +
                '$',
        );
        for (const file of distFiles) if (pattern.test(file)) roots.add(file);
    };
    const walk = (node) => {
        if (typeof node === 'string') return add(node);
        if (!node || typeof node !== 'object') return;
        for (const value of Object.values(node)) walk(value);
    };
    walk(pkg.exports);
    for (const field of ['main', 'module', 'types']) add(pkg[field]);
    return [...roots];
}

/**
 * Resolves a relative specifier the way the referencing file's own loader
 * would. A declaration file writes `from './x.js'` and means `./x.d.ts`.
 */
function resolveSpecifier(fromFile, specifier) {
    const base = resolve(dirname(fromFile), specifier);
    const candidates = [];
    if (DECLARATION.test(fromFile)) {
        candidates.push(
            base.replace(/\.js$/, '.d.ts'),
            base.replace(/\.cjs$/, '.d.cts'),
            base.replace(/\.mjs$/, '.d.mts'),
            `${base}.d.ts`,
            `${base}.d.cts`,
            join(base, 'index.d.ts'),
        );
    }
    candidates.push(base, `${base}.js`, `${base}.cjs`, `${base}.mjs`);
    candidates.push(join(base, 'index.js'), join(base, 'index.cjs'));
    return candidates.find(isFile) ?? null;
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
            const roots = entryPoints(root, pkg, distFiles);
            return { root, pkg, distFiles, roots, ...traverse(roots) };
        });
}

describe('dist/ contains exactly what the entry points reach', () => {
    const packages = builtPackages();

    test('the sweep actually found built packages', () => {
        // Without this, a missing build or a renamed directory turns every
        // assertion below into a vacuous pass.
        assert.ok(
            packages.length >= 6,
            `expected at least 6 packages with a dist/, found ${packages.length}. ` +
                'Run `pnpm -r build` first.',
        );
    });

    for (const { pkg, roots, distFiles, reached, dangling } of packages) {
        test(`${pkg.name}: the export map names entry points that exist`, () => {
            assert.ok(
                roots.length > 0,
                `${pkg.name} has a dist/ but no export target resolves into it — ` +
                    'the two checks below would pass without looking at anything.',
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
