import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every app that embeds the UI package must resolve one copy of each peer.
//
// `createSuperAdminApp()` CREATES the router, the Pinia instance and the Quasar
// plugin; the consumer's own pages then read them back with `useRoute()`,
// `useRouter()` and store hooks. Those APIs work by MODULE IDENTITY — inject
// with a key that is a module-level symbol — so two copies of the library do not
// share one and the lookup returns `undefined` instead of failing loudly.
//
// The package ships its pages as `.vue` source (decision E3), so their
// `import … from 'vue-router'` resolves relative to the PACKAGE while the app's
// own files resolve relative to the app. Any consumer that installs its own copy
// therefore ends up with two in the bundle unless it dedupes.
//
// What that costs, observed on `examples/notesapp/admin`: the admin shell
// rendered — header, drawer, navigation — and the content area of
// `/admin/tenants/:slug` was empty, with
// `TypeError: Cannot read properties of undefined (reading 'params')` in the
// console. `useRoute()` had returned `undefined`. The list page worked, because
// it reads no route params. Nothing in the repo could see it: every frontend
// guard drives platform components in a harness the platform itself controls,
// and this defect only exists in an ASSEMBLED app.
//
// This test is static on purpose — no install, no bundler, no browser. It is the
// cheapest possible place to catch a failure whose runtime symptom is a blank
// page and a `undefined` that never says where it came from.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Apps that embed the package, and therefore have to dedupe.
 *
 * The scaffolder template is in the list because it is the config every future
 * consumer starts from: fixing the two examples and leaving the template alone
 * would hand the same defect to everybody who runs `create-saasicat-admin`.
 */
const CONSUMER_CONFIGS = [
    'examples/notesapp/admin/vite.config.ts',
    'examples/notesapp/web/vite.config.ts',
    'packages/create-saasicat-admin/templates/vite.config.ts.tpl',
];

/**
 * Derived from `peerDependencies`, not written out by hand.
 *
 * A peer dependency IS the declaration "the host owns exactly one of these" —
 * so the set that must be deduped is exactly the peer set, and it stays correct
 * when a peer is added or dropped. A hand-kept list would not.
 */
function singletonPeers() {
    const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages/saas-platform-ui-vue/package.json'), 'utf8'),
    );
    return Object.keys(manifest.peerDependencies ?? {}).sort();
}

/** The names inside a `dedupe: [...]` array literal. */
function dedupedIn(source) {
    const match = /dedupe:\s*\[([\s\S]*?)\]/.exec(source);
    if (!match) return null;
    return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
}

describe('a consumer resolves one copy of every singleton peer', () => {
    const peers = singletonPeers();

    test('the peer set is non-empty and is what we think it is', () => {
        // Without this the loop below passes for every config the moment the
        // manifest is renamed or the field disappears — the vacuum-green shape
        // this repo has been caught by before.
        assert.ok(peers.length >= 4, `only ${peers.length} peers found`);
        assert.deepEqual(peers, ['pinia', 'quasar', 'vue', 'vue-router']);
    });

    for (const relative of CONSUMER_CONFIGS) {
        test(`${relative} dedupes them`, () => {
            const path = join(REPO_ROOT, relative);
            assert.ok(existsSync(path), `${relative} is gone — update this list or restore it`);

            const deduped = dedupedIn(readFileSync(path, 'utf8'));
            assert.ok(
                deduped,
                `${relative} declares no \`resolve.dedupe\`. Add ` +
                    `\`resolve: { dedupe: ${JSON.stringify(peers)} }\` — without it a second ` +
                    'copy of vue-router makes `useRoute()` return undefined in this app’s own ' +
                    'pages, and the symptom is a blank content area rather than an error.',
            );
            assert.deepEqual(
                peers.filter((peer) => !deduped.includes(peer)),
                [],
                `${relative} does not dedupe every peer of @saasicat/ui-vue`,
            );
        });
    }
});
