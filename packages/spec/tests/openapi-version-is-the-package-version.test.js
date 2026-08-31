// `info.version` in the OpenAPI document is the package version, or the
// document is describing a release that never existed.
//
// It said `0.1.0-draft` for 53 paths while the fixed group had passed 0.27.0.
// Nobody noticed, because nothing read it — which is exactly the property that
// makes a version claim rot: it is the one field a reader trusts without
// checking, and the one nobody edits.
//
// The release stamps it (`pnpm run release:version` → `scripts/stamp-spec-version.mjs`),
// so this test is the gate on that step rather than a chore for the author.

// @requirement SC-COMP-001 — All packages carry one version number and move together
// @requirement SC-COMP-008 — An implementation offers only what it can actually answer

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the OpenAPI document carries the version this package publishes', () => {
    const { version } = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    const document = readFileSync(join(PACKAGE_ROOT, 'admin-api.openapi.yaml'), 'utf8');

    const line = document.split('\n').find((candidate) => candidate.startsWith('    version: '));
    assert.ok(line, 'no info.version line found — has the document been reformatted?');
    assert.equal(
        line.slice('    version: '.length).trim(),
        version,
        'Run `node scripts/stamp-spec-version.mjs` from the repository root. ' +
            'The release does this automatically; a mismatch here means a manual version edit.',
    );
});
