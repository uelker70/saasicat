// Guards the documentation against hardcoded package version pins.
//
// Docs pinned `@saasicat/*@^0.1.0` while the first release published 0.2.0.
// Because caret pins the minor for 0.x, that range matches nothing on npm and
// every documented install command failed with ETARGET. The scaffolder
// template had the same defect. Version numbers in docs rot silently at every
// release, so the policy is: never pin, always resolve to latest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;

/**
 * Captures the spec after a package name: `@saasicat/x@<spec>`.
 *
 * Matching the spec loosely and classifying it afterwards is deliberate.
 * Enumerating range syntax misses forms npm happily accepts — `@v0.2.1`,
 * `@=0.2.1`, `@>=0.2.0` all install fine and all rot the same way.
 */
const SPEC = /(?:@saasicat\/[a-z-]+|create-saasicat-admin)@([^\s`'")\]]+)/g;

/**
 * A spec is a version pin if it carries a number. Dist-tags (`latest`, `next`,
 * `beta`) resolve at install time and never go stale, so they stay allowed.
 */
function isVersionPin(spec) {
    return /\d/.test(spec);
}

function docFiles() {
    const files = [];
    const root = join(REPO_ROOT, 'README.md');
    if (existsSync(root)) files.push(root);

    const docs = join(REPO_ROOT, 'docs');
    if (existsSync(docs)) {
        for (const f of readdirSync(docs)) {
            if (f.endsWith('.md')) files.push(join(docs, f));
        }
    }

    const pkgs = join(REPO_ROOT, 'packages');
    if (existsSync(pkgs)) {
        for (const d of readdirSync(pkgs)) {
            const readme = join(pkgs, d, 'README.md');
            if (existsSync(readme)) files.push(readme);
        }
    }
    return files;
}

test('documentation pins no package versions (they rot at every release)', () => {
    const offenders = [];
    for (const file of docFiles()) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
            for (const [hit, spec] of line.matchAll(SPEC)) {
                if (!isVersionPin(spec)) continue;
                offenders.push(`${file.replace(REPO_ROOT, '')}:${i + 1}  ${hit}`);
            }
        });
    }
    assert.deepEqual(
        offenders,
        [],
        `Remove the version pin(s); docs should resolve to latest:\n  ${offenders.join('\n  ')}`,
    );
});

test('pin detection covers every spec form npm accepts', () => {
    // Regression guard for the detector itself. `v0.2.1`, `=0.2.1` and
    // `>=0.2.0` were accepted by an earlier caret/tilde-only pattern even
    // though npm installs all three — a doc using them would have rotted
    // unnoticed.
    const pinned = [
        '@saasicat/nest@0.2.1',
        '@saasicat/nest@^0.1.0',
        '@saasicat/nest@~0.1.0',
        '@saasicat/nest@v0.2.1',
        '@saasicat/nest@=0.2.1',
        '@saasicat/nest@>=0.2.0',
        '@saasicat/nest@0.2.x',
        'create-saasicat-admin@0.2.0',
    ];
    for (const sample of pinned) {
        const hits = [...sample.matchAll(SPEC)].filter(([, spec]) => isVersionPin(spec));
        assert.equal(hits.length, 1, `should be flagged as a pin: ${sample}`);
    }

    // Dist-tags and bare names resolve at install time and must stay allowed.
    const allowed = [
        '@saasicat/nest@latest',
        'create-saasicat-admin@latest',
        '@saasicat/nest@next',
        '@saasicat/nest',
        'pnpm add @saasicat/nest @saasicat/types',
    ];
    for (const sample of allowed) {
        const hits = [...sample.matchAll(SPEC)].filter(([, spec]) => isVersionPin(spec));
        assert.equal(hits.length, 0, `should NOT be flagged: ${sample}`);
    }
});
