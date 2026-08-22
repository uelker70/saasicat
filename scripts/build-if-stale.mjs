#!/usr/bin/env node
// Rebuilds the workspace packages whose `dist/` is not built from what is
// there now, and nothing else.
//
// The decision is the stamp from `build-stamp.mjs`: a hash over every input a
// build could have read, including its workspace dependencies' inputs — so a
// stale dependency makes its dependents stale too, and the selection below is
// closed under "depends on". `pnpm -r` then builds the selection in
// dependency order.
//
// A package whose build does not go through `build-and-prune.mjs` never has a
// stamp and is left alone — nothing the ratchet measures comes from it.

import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';

import { REPO_ROOT, isCurrent, readWorkspace, writesStamp } from './build-stamp.mjs';

const workspace = readWorkspace();
const stale = [];
for (const [name, dir] of workspace) {
    if (!writesStamp(dir)) continue;
    if (!isCurrent(dir, workspace)) stale.push({ name, dir });
}

if (stale.length === 0) {
    console.log('build-if-stale: every dist/ is current — nothing to build.');
    process.exit(0);
}

console.log(
    `build-if-stale: ${stale.length} package(s) changed since their last build — ` +
        stale.map(({ dir }) => relative(REPO_ROOT, dir)).join(', '),
);
const filters = stale.flatMap(({ name }) => ['--filter', name]);
const result = spawnSync('pnpm', ['-r', ...filters, 'build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
});
process.exit(result.status ?? 1);
