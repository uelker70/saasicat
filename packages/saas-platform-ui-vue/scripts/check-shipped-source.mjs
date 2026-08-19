// Typecheck the source this package SHIPS, under the oldest `lib` a consumer
// may compile it with.
//
// Eight export subpaths hand out `.vue` and `.ts` from `src/` rather than a
// build (decision E3 — consumers need the source for Quasar and Sass theming).
// Those files are therefore compiled by the consumer's `tsconfig`, not by ours.
// Ours says `lib: ES2023`; a consumer said `ES2021`, and `new Error(msg,
// { cause })` in a file they never wrote failed their build.
//
// The floor below is the contract that replaces that surprise. It is checked by
// compiling the real shipped closure — every file reachable from the exported
// subpaths — so a new ES2022+ construct anywhere in it fails here rather than in
// someone else's repository.
//
// Raising the floor is a breaking change for consumers below it: announce it in
// a changeset and in `docs/`, do not bump it to make a build pass.

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FLOOR = { target: 'ES2021', lib: ['ES2021', 'DOM', 'DOM.Iterable'] };
const PROBE = join(PACKAGE_ROOT, 'tsconfig.shipped-source.json');

/**
 * The directories the export map hands out as source — derived from the map, so
 * a new source-shipping subpath is covered the day it is added. A hand-written
 * list would be the same defect one level up.
 */
function shippedSourceDirectories(manifest) {
    const directories = new Set();
    const walk = (node) => {
        if (typeof node === 'string') {
            if (!node.startsWith('./src/')) return;
            const withoutStar = node.includes('*')
                ? node.slice(0, node.indexOf('*'))
                : dirname(node);
            const directory = withoutStar.replace(/\/+$/, '');
            if (directory !== './src') directories.add(directory);
            return;
        }
        if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(manifest.exports ?? {});
    return [...directories].sort();
}

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
const directories = shippedSourceDirectories(manifest);
if (directories.length === 0) {
    console.error(
        'check-shipped-source: the export map hands out no source directories. Either the map ' +
            'changed shape or this check lost its subject — it must not pass by having nothing to do.',
    );
    process.exit(1);
}

writeFileSync(
    PROBE,
    JSON.stringify(
        {
            extends: './tsconfig.json',
            compilerOptions: { ...FLOOR, noEmit: true, types: [] },
            include: directories.map((directory) => `${directory}/**/*`),
        },
        null,
        2,
    ) + '\n',
);

console.log(
    `check-shipped-source: ${directories.length} shipped directories against lib ${FLOOR.lib.join(', ')}`,
);
const result = spawnSync(
    'pnpm',
    ['exec', 'vue-tsc', '-p', 'tsconfig.shipped-source.json', '--noEmit'],
    { cwd: PACKAGE_ROOT, stdio: 'inherit' },
);
rmSync(PROBE, { force: true });

if (result.status !== 0) {
    console.error(
        `\ncheck-shipped-source: the shipped source does not compile under ${FLOOR.target}. A ` +
            'consumer compiling these files gets these errors in code they did not write. Use an ' +
            'equivalent that predates the floor — see `src/client/attach-cause.ts`.',
    );
}
process.exit(result.status ?? 1);
