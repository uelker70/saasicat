#!/usr/bin/env node
// Runs a package build, then removes the outputs that build did not write.
//
// Usage, from a package directory:
//
//     node ../../scripts/build-and-prune.mjs tsup
//     node ../../scripts/build-and-prune.mjs "tsup src/index.ts --dts && node post.mjs"
//
// The arguments are rejoined into one command line and run through a shell.
// Quote the command whenever it contains something the *calling* shell would
// act on itself — `&&`, `|`, `;`, a redirect — or only its first word would be
// wrapped and the rest would run outside the prune.
//
// Why this exists instead of tsup's `clean`
// -----------------------------------------
// `clean` (the `--clean` flag or `clean: true` in a tsup config) empties
// `dist/` before the build. tsup then writes the JS bundles and runs the
// declaration pass afterwards, so there is a window — measured between 1.1 s
// and 12.5 s per package — in which `dist/index.js` exists and
// `dist/index.d.ts` does not. That is precisely the state TypeScript reports
// as TS7016 ("Could not find a declaration file for module ..."), and a
// TypeScript server caches failed module resolutions: one lookup inside the
// window and an editor shows errors until it is restarted by hand, long after
// the build finished and the file came back.
//
// Pruning afterwards keeps what `clean` is actually for — outputs whose entry
// no longer exists do not linger — without ever removing a file that is still
// current. A rebuild overwrites each output in place, so no consumer, editor
// or type server observes a half-built package.
//
// How "did not write" is decided
// ------------------------------
// Every file in `dist/` is recorded with its mtime before the build, and each
// one is compared only against its own earlier value. A file the build
// rewrote has a new mtime; a file left untouched still carries the old one and
// is an orphan. Nothing is compared against a wall clock, so filesystem
// timestamp granularity cannot make a freshly written file look stale.
//
// The prune runs only after the build succeeds. A failed build leaves `dist/`
// exactly as it was.
import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, rmSync, existsSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DIST_DIR = 'dist';

/** Absolute paths of every file below `dir`, mapped to their mtime in ms. */
function snapshot(dir) {
    const files = new Map();
    if (!existsSync(dir)) return files;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            for (const [k, v] of snapshot(full)) files.set(k, v);
        } else {
            files.set(full, lstatSync(full).mtimeMs);
        }
    }
    return files;
}

/** True while `dir` sits strictly below `root`. */
function isBelow(dir, root) {
    const rel = path.relative(root, dir);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Removes `dir` and its ancestors up to `stopAt` while they are empty. */
function removeEmptyAncestors(dir, stopAt) {
    let current = dir;
    while (isBelow(current, stopAt)) {
        if (!existsSync(current) || readdirSync(current).length > 0) return;
        rmdirSync(current);
        current = path.dirname(current);
    }
}

const command = process.argv.slice(2).join(' ').trim();
if (!command) {
    console.error('build-and-prune: no build command given');
    process.exit(1);
}

const dist = path.resolve(process.cwd(), DIST_DIR);
const before = snapshot(dist);

const result = spawnSync(command, { shell: true, stdio: 'inherit' });
if (result.error) {
    console.error(`build-and-prune: could not start "${command}": ${result.error.message}`);
    process.exit(1);
}
if (result.signal) {
    console.error(`build-and-prune: build terminated by ${result.signal}`);
    process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const orphans = [...snapshot(dist)]
    .filter(([file, mtimeMs]) => before.get(file) === mtimeMs)
    .map(([file]) => file);

for (const file of orphans) {
    rmSync(file);
    removeEmptyAncestors(path.dirname(file), dist);
}

// Silence means the build wrote everything that is in dist/. Reporting a clean
// prune on every build would train the reader to skip the line that matters.
if (orphans.length > 0) {
    const relative = orphans.map((f) => path.relative(process.cwd(), f)).sort();
    console.log(`pruned ${relative.length} stale output(s): ${relative.join(', ')}`);
}
