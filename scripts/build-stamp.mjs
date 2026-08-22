#!/usr/bin/env node
// A build stamp: what a package's `dist/` was built from.
//
// `pnpm run coverage` used to rebuild every package before measuring, because
// "is dist/ current?" had no decidable answer — a staleness heuristic here was
// wrong three review rounds in a row (a deleted source file, `tsup.config.ts`,
// the helpers that config imports). Enumerating the inputs of an arbitrary
// build script is not winnable. Hashing everything that COULD be one is: the
// stamp is a hash over every file in the package except its outputs and its
// tests, over the root files every build reads, and over the same hash of
// each workspace dependency. A change anywhere in that closure changes the
// stamp, whether or not anyone knew it was an input.
//
// `build-and-prune.mjs` writes it after a successful build; `build-if-stale.mjs`
// rebuilds the packages whose stamp does not match. The cost of a wrong guess
// is asymmetric — a needless rebuild wastes a minute, a missed one measures a
// program nobody is running — so anything not provably an output counts as an
// input.
//
//   node scripts/build-stamp.mjs write     (from a package directory)

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STAMP_FILE = join('dist', '.build-stamp');

/**
 * Files every package build reads, outside the package itself.
 *
 * The lockfile and the workspace file are in here because they decide which
 * tsup, esbuild and SWC get installed: a dependency bump changes every bundle
 * without touching a single file inside a package.
 */
const SHARED_INPUTS = [
    'tsconfig.base.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'scripts/build-and-prune.mjs',
    'scripts/build-stamp.mjs',
];

/**
 * What is NOT an input: the outputs, the installed modules, and the tests.
 *
 * Tests are excluded on purpose — they never reach `dist/`, and a stamp that
 * changed with every test edit would rebuild on exactly the edits the ratchet
 * is run for most. Anything else in the package, README included, is an input:
 * a needless rebuild is the cheaper mistake.
 */
const isOutputOrTest = (name) =>
    name === 'dist' ||
    name === 'node_modules' ||
    name === 'coverage' ||
    name === 'test-results' ||
    name === '.integration-tmp' ||
    name === 'CHANGELOG.md' ||
    name.startsWith('tests');

function* walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
    )) {
        if (isOutputOrTest(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else if (entry.isFile()) yield full;
    }
}

const fileHash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The workspace packages `packageDir` depends on, as directories. */
export function workspaceDependencies(packageDir, workspace) {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    const names = new Set();
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
            if (typeof spec === 'string' && spec.startsWith('workspace:')) names.add(name);
        }
    }
    return [...names].map((name) => workspace.get(name)).filter(Boolean);
}

/** Every workspace package, by name → directory. */
export function readWorkspace(root = REPO_ROOT) {
    const map = new Map();
    for (const group of ['packages', 'examples']) {
        const dir = join(root, group);
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir)) {
            const manifest = join(dir, entry, 'package.json');
            if (!existsSync(manifest)) continue;
            map.set(JSON.parse(readFileSync(manifest, 'utf8')).name, join(dir, entry));
        }
    }
    return map;
}

/**
 * The hash of everything `packageDir`'s build could have read.
 *
 * Deterministic: sorted paths, content hashes, no timestamps. `seen` breaks
 * the cycle ui-vue ↔ ui-vue-tenant have through devDependencies.
 */
export function inputsHash(packageDir, workspace, root = REPO_ROOT, seen = new Set()) {
    if (seen.has(packageDir)) return 'cycle';
    seen.add(packageDir);
    const hash = createHash('sha256');
    for (const file of walk(packageDir)) {
        hash.update(`${relative(packageDir, file)}\0${fileHash(file)}\n`);
    }
    for (const shared of SHARED_INPUTS) {
        const file = join(root, shared);
        if (existsSync(file)) hash.update(`${shared}\0${fileHash(file)}\n`);
    }
    for (const dep of workspaceDependencies(packageDir, workspace).sort()) {
        hash.update(`dep:${relative(root, dep)}\0${inputsHash(dep, workspace, root, seen)}\n`);
    }
    return hash.digest('hex');
}

/**
 * Whether a package's build writes a stamp at all.
 *
 * Only a build that runs through `build-and-prune.mjs` does — derived from the
 * script, not listed. The example app builds with `prisma generate && tsc`
 * and the admin/web with vite, and a package the stamp cannot see is not
 * "stale", it is out of scope: nothing the ratchet measures comes from it.
 */
export function writesStamp(packageDir) {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    return (
        typeof manifest.scripts?.build === 'string' &&
        manifest.scripts.build.includes('build-and-prune')
    );
}

export function readStamp(packageDir) {
    const file = join(packageDir, STAMP_FILE);
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

/**
 * Removes the stamp. Called before a build starts: a build that fails or is
 * interrupted leaves whatever it got through in `dist/` (see
 * `build-and-prune.mjs`), and a stamp from the previous build beside that
 * would pass the partial output off as current.
 */
export function clearStamp(packageDir) {
    rmSync(join(packageDir, STAMP_FILE), { force: true });
}

export function writeStamp(packageDir, workspace = readWorkspace()) {
    mkdirSync(join(packageDir, 'dist'), { recursive: true });
    writeFileSync(join(packageDir, STAMP_FILE), `${inputsHash(packageDir, workspace)}\n`);
}

/** Whether `packageDir`'s `dist/` was built from what is there now. */
export function isCurrent(packageDir, workspace = readWorkspace()) {
    const stamp = readStamp(packageDir);
    return stamp !== null && stamp === inputsHash(packageDir, workspace);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv[2] !== 'write') {
        console.error('build-stamp: usage: node scripts/build-stamp.mjs write');
        process.exit(1);
    }
    writeStamp(process.cwd());
}
