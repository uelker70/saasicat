// Every package this repository publishes carries the same version number.
//
// That is the point of the Changesets *fixed group*: one version across the
// set, no compatibility matrix, and `@saasicat/ui-vue@1.2.0` provably means
// `@saasicat/nest@1.2.0`. A package outside the group is not refused by
// Changesets — it simply gets a version line of its own, quietly, and the
// promise stops being true for it.
//
// This check exists because that nearly happened: `@saasicat/ui-vue-tenant` was
// created in phase 4 and its entry in `.changeset/config.json` was a separate
// step from creating the package. Nothing would have failed. The next release
// would have shipped it at a different number than the package it is a peer of.
//
// Derived from the workspace, not from a list: a package is in scope when it has
// a `package.json` under `packages/` that is not `private`. Adding one and
// forgetting the group is what this fails on.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Package names under `packages/` that npm would publish. */
function publishablePackages() {
    return readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(ROOT, 'packages', entry.name, 'package.json'))
        .flatMap((file) => {
            let manifest;
            try {
                manifest = JSON.parse(readFileSync(file, 'utf8'));
            } catch {
                return [];
            }
            return manifest.private === true ? [] : [manifest.name];
        });
}

describe('the release group covers everything that is published', () => {
    const config = JSON.parse(readFileSync(join(ROOT, '.changeset', 'config.json'), 'utf8'));

    test('there is exactly one fixed group', () => {
        // Two groups would mean two version lines, which is the thing this
        // configuration exists to rule out.
        assert.equal(
            config.fixed?.length,
            1,
            'expected a single fixed group; more than one reintroduces the compatibility matrix',
        );
    });

    test('every publishable package is in it', () => {
        const published = publishablePackages();
        assert.ok(
            published.length >= 8,
            `only ${published.length} packages found — the scan broke`,
        );

        const group = new Set(config.fixed[0]);
        const missing = published.filter((name) => !group.has(name));
        assert.deepEqual(
            missing,
            [],
            'these are published but version independently — a release would give them a ' +
                'different number than the packages they are peers of',
        );
    });

    test('the group names no package that does not exist', () => {
        // The other direction, and it fails differently: Changesets errors on
        // an unknown name at `version` time, which is late — on `main`, in the
        // release workflow, after the merge.
        const published = new Set(publishablePackages());
        const stale = config.fixed[0].filter((name) => !published.has(name));
        assert.deepEqual(stale, [], 'the fixed group names packages this workspace does not have');
    });
});
