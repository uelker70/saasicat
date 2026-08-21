import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildImportMap, isNoLongerPublic, rewriteImports, rewriteSubpath } from '../dist/index.js';

// The rewrite a consumer runs must agree with the move that happened.
//
// Both read the same table — `codemods/v1-imports.map.json`, the file the
// platform's own 4.1 move ran on. That is the point of shipping it rather than
// writing the rules twice: a destination cannot be right in one place and wrong
// in the other.

const TABLE = JSON.parse(
    readFileSync(
        fileURLToPath(new URL('../codemods/v1-imports.map.json', import.meta.url)),
        'utf8',
    ),
);
const MAP = buildImportMap(TABLE);

describe('the map is derived from the move, not written beside it', () => {
    test('it has entries', () => {
        // Every assertion below is vacuously true on an empty map.
        assert.ok(MAP.size >= 20, `only ${MAP.size} mappings derived`);
    });

    test('every destination is on the public surface', () => {
        const offenders = [...MAP.values()].filter((to) => !/^(ui|layouts|auth|pages)\//.test(to));
        assert.deepEqual(offenders, [], 'the codemod points at something not exported');
    });
});

describe('the four shapes a consumer meets', () => {
    test('a primitive that moved into ui/', () => {
        assert.equal(
            rewriteSubpath(MAP, 'components/admin-page/AdminTable.vue'),
            'ui/data/AdminTable.vue',
        );
    });

    test('the shell, which left pages/ for layouts/ — under either old spelling', () => {
        assert.equal(rewriteSubpath(MAP, 'pages/AdminLayout.vue'), 'layouts/AdminLayout.vue');
        assert.equal(
            rewriteSubpath(MAP, 'pages-standard/AdminLayout.vue'),
            'layouts/AdminLayout.vue',
        );
    });

    test('a page that only lost the second spelling', () => {
        assert.equal(rewriteSubpath(MAP, 'pages-standard/UsersPage.vue'), 'pages/UsersPage.vue');
    });

    test('a page that was already right stays untouched', () => {
        // Returning a value here would rewrite an import to itself and count as
        // a change, which makes the summary lie about what the run did.
        assert.equal(rewriteSubpath(MAP, 'pages/UsersPage.vue'), null);
    });
});

describe('what has no new home is reported, not guessed at', () => {
    test('a domain component is recognised as unreachable', () => {
        assert.equal(isNoLongerPublic(MAP, 'components/plan-list/PlanList.vue'), true);
        assert.equal(rewriteSubpath(MAP, 'components/plan-list/PlanList.vue'), null);
    });

    test('and it survives the rewrite untouched, so the build names it', () => {
        // Rewriting it to a plausible-looking path would turn a clear "this is
        // gone" into a module-not-found on a path the consumer never wrote.
        const source = "import P from '@saasicat/ui-vue/components/plan-list/PlanList.vue';";
        const result = rewriteImports(source, MAP);
        assert.equal(result.text, source);
        assert.equal(result.rewritten, 0);
        assert.equal(result.unmapped.get('components/plan-list/PlanList.vue'), 1);
    });

    test('a primitive is not reported — it has somewhere to go', () => {
        assert.equal(isNoLongerPublic(MAP, 'components/FeatureGate.vue'), false);
    });
});

describe('rewriting a file', () => {
    test('counts what it changed and leaves the rest alone', () => {
        const source = [
            "import A from '@saasicat/ui-vue/components/FeatureGate.vue';",
            "import B from '@saasicat/ui-vue/pages/UsersPage.vue';",
            "import { useThing } from '@saasicat/ui-vue';",
            "import C from 'some-other-package/pages/UsersPage.vue';",
        ].join('\n');

        const result = rewriteImports(source, MAP);
        assert.equal(result.rewritten, 1);
        assert.match(result.text, /ui\/entitlement\/FeatureGate\.vue/);
        assert.match(result.text, /@saasicat\/ui-vue\/pages\/UsersPage\.vue/);
        assert.match(result.text, /some-other-package\/pages\/UsersPage\.vue/);
    });
});
