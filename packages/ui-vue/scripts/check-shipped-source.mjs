// Typecheck the source this package SHIPS, the way a consumer compiles it.
//
// Several export subpaths hand out `.vue` and `.ts` from `src/` under their
// `types` condition; `default` points at the build (ADR 0011). The consumer's
// bundler therefore loads `dist/`, and their TYPECHECKER reads these files —
// which is why the floor below is theirs and not ours.
// The list is NOT written here, because it moves: `./pages-standard/*` and
// `./components/*` were two of them until phase 4 removed both. It is derived
// from the export map below, and the count is printed on every run.
//
// So the files those subpaths reach are compiled by the consumer's `tsconfig`,
// not by ours. Ours says `lib: ES2023`; a consumer said `ES2021`, and
// `new Error(msg, { cause })` in a file they never wrote failed their build.
//
// The closure GROWS as pages take on more of the package. Migrating one page
// onto the resource registry pulled `src/vue/resource-registry.ts` in for the
// first time, and it used `Object.hasOwn` — ES2022, and pre-existing. That is
// this check working, not a gap in it: the file became a consumer's problem the
// moment something shipped imported it, and it said so that same moment.
//
// `FLOOR` is the contract that replaces that surprise, and it is set to what a
// Vite consumer sets rather than to a bare language level. Two of those options
// are insurance rather than a live check today, and it is worth being exact
// about which: this probe runs `noEmit`, so `useDefineForClassFields` cannot
// produce its define-vs-assign difference at all — at the typechecker it only
// enables TS2610/TS2612 for a subclass shadowing a base member, and on ES2021
// `Error` offers only `name`, `message` and `stack`, which none of the
// package's fourteen `Error` subclasses declares as a field.
// `strictPropertyInitialization` is likewise quiet today; the package's own
// base config turns it off, and a consumer on plain `strict: true` has it on.
// Both are here so the probe does not drift milder than its subject.
//
// What it does NOT pin is the compiler version. `satisfies` in
// `src/client/http/fetch-http-client.ts` needs TypeScript 4.9 or newer whatever
// `lib` says, and checking older compilers would mean installing them. The
// supported minimum is stated in `CONTRIBUTING.md` and the package README
// instead — prose, and named as prose.
//
// Raising the floor is a breaking change for consumers below it: announce it in
// a changeset and in `CONTRIBUTING.md`, do not bump it to make a build pass.

import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';

// The package under test is the working directory, not this file's package:
// `@saasicat/ui-vue-tenant` ships its source under the same floor and runs
// this script from its own `test:shipped-source`.
const PACKAGE_ROOT = process.cwd();
const FLOOR = {
    target: 'ES2021',
    // Deliberately not wider than the package's own `lib` on any axis: a floor
    // that allows more than the roof would pass code the main typecheck rejects.
    lib: ['ES2021', 'DOM'],
    isolatedModules: true,
    useDefineForClassFields: true,
    strictPropertyInitialization: true,
};

/** Extensions that cannot reach the typechecker, so cannot hide a defect here. */
const ASSET_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less', '.json', '.svg']);

/**
 * The directories the export map hands out as source — derived from the map, so
 * a new source-shipping subpath is covered the day it is added. A hand-written
 * list would be the same defect one level up.
 *
 * A code target that reduces to `./src` is refused rather than skipped. That is
 * the shape this derivation cannot express — `./src/index.ts`, or a `*` in the
 * middle of the path. `./src/*.vue` is the one exception: a star directly under
 * `src/` with nothing but an extension behind it hands out the whole tree, so
 * the directory is `src/` itself. Dropping a shape silently would leave the whole closure
 * behind it unchecked while the run stayed green. "Delivers less" has to fail as
 * loudly as "delivers nothing". A stylesheet in the same position is skipped,
 * because no `include` of it would ever produce a diagnostic.
 */
function shippedSourceDirectories(manifest) {
    const directories = new Set();
    const unrepresentable = [];
    const walk = (node) => {
        if (typeof node === 'string') {
            if (!node.startsWith('./src/')) return;
            // `./src/*.vue` hands out everything directly under `src/` and, for
            // a package whose whole tree is source, everything below it: that
            // IS a directory — `src/` itself — and is checked as one.
            if (/^\.\/src\/\*\.[a-z]+$/.test(node)) {
                if (!ASSET_EXTENSIONS.has(extname(node))) directories.add('./src');
                return;
            }
            const head = node.includes('*') ? node.slice(0, node.indexOf('*')) : dirname(node);
            const directory = head.replace(/(?<!\/)\/+$/, '');
            if (directory !== './src') directories.add(directory);
            else if (!ASSET_EXTENSIONS.has(extname(node))) unrepresentable.push(node);
            return;
        }
        if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(manifest.exports ?? {});
    return { directories: [...directories].sort(), unrepresentable };
}

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
const { directories, unrepresentable } = shippedSourceDirectories(manifest);

if (unrepresentable.length > 0) {
    console.error(
        'check-shipped-source: these export targets serve source straight from the root of ' +
            `\`src/\`, which this check cannot narrow to a directory:\n  ${unrepresentable.join('\n  ')}\n` +
            'Give the subpath its own directory, or widen the derivation — do not leave it ' +
            'unchecked.',
    );
    process.exit(1);
}
if (directories.length === 0) {
    console.error(
        'check-shipped-source: the export map hands out no source directories. Either the map ' +
            'changed shape or this check lost its subject — it must not pass by having nothing to do.',
    );
    process.exit(1);
}

// A temporary directory, not the package root: an interrupted run would
// otherwise leave a 2-space JSON behind in a 4-space repository, and
// `format:check` would fail on a file nobody wrote.
const probeDirectory = mkdtempSync(join(tmpdir(), 'saasicat-shipped-source-'));
const probe = join(probeDirectory, 'tsconfig.json');
writeFileSync(
    probe,
    JSON.stringify(
        {
            extends: join(PACKAGE_ROOT, 'tsconfig.json'),
            compilerOptions: { ...FLOOR, noEmit: true, types: [] },
            include: directories.map((directory) =>
                join(PACKAGE_ROOT, directory.slice('./'.length), '**', '*'),
            ),
        },
        null,
        2,
    ) + '\n',
);

console.log(
    `check-shipped-source: ${directories.length} shipped directories against ${FLOOR.target} ` +
        `(lib ${FLOOR.lib.join(', ')})`,
);
// Node with the resolved entry, not `pnpm exec` through a shell. The probe path
// lives under `os.tmpdir()`, and a shell on Windows passes arguments verbatim —
// a user directory with a space in it would truncate `-p` and the guard would
// report that the sources do not compile.
const vueTsc = createRequire(join(PACKAGE_ROOT, 'package.json')).resolve('vue-tsc/bin/vue-tsc.js');
const result = spawnSync(process.execPath, [vueTsc, '-p', probe, '--noEmit'], {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
});
rmSync(probeDirectory, { recursive: true, force: true });

if (result.status !== 0) {
    console.error(
        `\ncheck-shipped-source: the shipped source does not compile at ${FLOOR.target}. A ` +
            'consumer compiling these files gets these errors in code they did not write. Use an ' +
            'equivalent that predates the floor — see `src/client/attach-cause.ts`.',
    );
}
process.exit(result.status ?? 1);
