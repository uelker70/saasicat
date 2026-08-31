// @requirement SC-COMP-001 — All packages carry one version number and move together

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { publicEntries } from '../scripts/entries.mjs';

const require = createRequire(import.meta.url);

// esbuild cannot code-split CommonJS, so building each public entry separately
// copies every shared module into it — and each copy has its own class
// objects. Nest resolves providers by class reference, so a service registered
// through one entry then fails to resolve when injected from another. That
// caused a production outage, and later blocked consumers from composing
// `SaaSiCatModule` with the other platform modules.
//
// The build works around it: one shared bundle (`tsup.cjs.config.ts`) plus
// thin per-entry stubs (`scripts/build-cjs-stubs.mjs`). This test is what
// keeps that arrangement honest — if someone reverts to per-entry CJS bundles,
// every shared export splits in two again and this fails loudly at build time
// instead of silently at a consumer's boot.

// Derived from `package.json` exports, not hand-listed: a new entry point
// must be covered here automatically, otherwise the very check that guards
// this arrangement would be the thing that misses it.
const ENTRIES = publicEntries().map((e) => e.exportPath);

const load = (entry) =>
    require(entry === '.' ? '../dist/index.cjs' : `../dist/${entry.slice(2)}/index.cjs`);

// No exceptions. Two entries once exported the same NAME for different
// registries (`FEATURE_UI_REGISTRY_TOKEN` in `billing` and `catalog`); 1.0
// gave each its own name, so a name that differs across entries is a split
// bundle and nothing else.

describe('CJS entries share one set of objects', () => {
    test('no exported name resolves to different values across entries', () => {
        /** @type {Map<string, Array<{entry: string, value: unknown}>>} */
        const byName = new Map();
        for (const entry of ENTRIES) {
            for (const [name, value] of Object.entries(load(entry))) {
                if (!byName.has(name)) byName.set(name, []);
                byName.get(name).push({ entry, value });
            }
        }

        const split = [];
        for (const [name, occurrences] of byName) {
            if (occurrences.length < 2) continue;
            if (new Set(occurrences.map((o) => o.value)).size > 1) {
                split.push(`${name} differs across ${occurrences.map((o) => o.entry).join(', ')}`);
            }
        }

        assert.deepEqual(
            split.sort(),
            [],
            'these exports have more than one identity in the CJS build — the shared-bundle ' +
                'step is broken, and consumer apps will hit UnknownDependenciesException',
        );
    });

    test('the shared bundle actually backs every entry', () => {
        // Guards against the stub generator silently skipping entries.
        for (const entry of ENTRIES) {
            const mod = load(entry);
            assert.ok(
                Object.keys(mod).length > 0,
                `${entry} exports nothing — its stub did not resolve the shared bundle`,
            );
        }
    });

    test('a class is shared even between entries that never import each other', () => {
        // Spot-check the exact pair that broke consumers: SetupModule lives in
        // the root entry, the AdminModule providing its MfaService is composed
        // by SaaSiCatModule in ./platform.
        assert.equal(load('.').MfaService, load('./platform').MfaService);
        assert.equal(load('.').SetupModule, load('./platform').SetupModule);
    });
});
