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
// timestamp granularity cannot make a freshly written file look stale — which
// holds as long as two writes of the SAME file are further apart than the
// filesystem's timestamp resolution, and a build takes longer than that.
//
// The prune runs only after the build succeeds. That is the property the mtime
// comparison needs, and it is narrower than "a failed build leaves `dist/`
// exactly as it was" — which this comment used to claim and which is not true.
// A build that dies partway has already written whatever it got through, so
// `dist/` can hold new JavaScript beside declarations from the previous build.
//
// That state is not repaired here, deliberately. Restoring it means copying
// `dist/` aside on every build, or building into a staging directory and
// swapping — a large change to buy protection against something the next green
// build resolves. In CI it never surfaces: the build step fails and nothing
// runs after it. Locally it can confuse a type check, so the failure path says
// what it left behind instead of leaving the reader to find out.
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

// Exactly one argument, so the shell's quoting survives the hand-off. Joining
// several would re-split whatever the caller had quoted, and a command written
// as `a && b` would then prune between the two: b's output carries no earlier
// mtime, so it looks like an orphan on the next run. Refusing is cheaper than
// the warning that used to stand here.
if (process.argv.length !== 3 || process.argv[2].trim() === '') {
    console.error(
        'build-and-prune: expects exactly one argument, the whole build command as one ' +
            'string. Quote it: build-and-prune.mjs "tsup && node scripts/x.mjs".',
    );
    process.exit(1);
}
const command = process.argv[2].trim();

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
if (result.status !== 0) {
    console.error(
        'build-and-prune: the build failed, so nothing was pruned. dist/ holds whatever the ' +
            'build wrote before it stopped, which can be new output beside output from the ' +
            'previous build — do not trust it until the next successful build.',
    );
    process.exit(result.status ?? 1);
}

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
