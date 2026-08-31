// The coverage ratchet measures every package it is able to measure.
//
// Its package list used to be nine names in an array. It was correct on the day
// it was written and stayed correct by luck — the two packages added since have
// no `node --test` script, so nobody found out that one which did would have
// gone unmeasured. Silently, with a green gate, which is the worst way for a
// ratchet to be wrong.
//
// The list is derived now. This holds the derivation against the manifests, so
// a package that becomes measurable and is not measured fails here rather than
// disappearing from a number nobody reads twice.

// @requirement SC-READ-002 — A gap is named rather than papered over

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A package this ratchet can measure: its suite is a plain `node --test` run. */
function measurable() {
    return readdirSync(join(ROOT, 'packages'))
        .filter((dir) => {
            const manifest = join(ROOT, 'packages', dir, 'package.json');
            if (!existsSync(manifest)) return false;
            const test = JSON.parse(readFileSync(manifest, 'utf8')).scripts?.test ?? '';
            return test.startsWith('node --test');
        })
        .sort();
}

describe('the coverage ratchet sees every package it can', () => {
    const packages = measurable();
    const baseline = JSON.parse(readFileSync(join(ROOT, 'coverage-baseline.json'), 'utf8'));

    test('the sweep finds the packages', () => {
        // Vacuously true on an empty list, which is what a moved directory gives.
        assert.ok(packages.length >= 8, `only ${packages.length} measurable packages found`);
    });

    test('every measurable package has a recorded baseline', () => {
        const missing = packages.filter((name) => !(name in baseline));
        assert.deepEqual(
            missing,
            [],
            'These packages run a `node --test` suite and no coverage number is kept for them.\n' +
                'Run `pnpm run coverage:update` to record one: ' +
                missing.join(', '),
        );
    });

    test('no baseline entry describes a package that is gone', () => {
        const orphans = Object.keys(baseline).filter((name) => !packages.includes(name));
        assert.deepEqual(orphans, [], `baseline entries with no package: ${orphans.join(', ')}`);
    });
});
