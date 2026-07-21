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

/** `@saasicat/x@1.2.3`, `@saasicat/x@^1.2`, `create-saasicat-admin@~1.0` — but not `@latest`. */
const PINNED = /(?:@saasicat\/[a-z-]+|create-saasicat-admin)@[\^~]?\d[\w.-]*/g;

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
            for (const hit of line.match(PINNED) ?? []) {
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
