import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildImportMap, isNoLongerPublic, rewriteImports, rewriteSubpath } from '../dist/index.js';

// The rewrite a consumer runs must agree with the move that happened.
//
// Both read the same table — `codemods/v1-imports.map.json`, the file the
// platform's own 4.1 move ran on. That is the point of shipping it rather than
// writing the rules twice: a destination cannot be right in one place and wrong
// in the other.

const HERE = dirname(fileURLToPath(import.meta.url));

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

    test('every destination is on a public surface', () => {
        // Two kinds of destination, and both have to be real: a subpath that
        // stayed in `@saasicat/ui-vue` must be one it still exports, and a
        // target naming another package must name one that exists. A codemod
        // that rewrites an import to something unresolvable moves the failure
        // into a consumer's build, where nobody can see this file.
        // An `internal/` target is a declared removal: `rewriteSubpath` never
        // emits it, it is what makes a nested `pages-standard/` path report
        // instead of rewrite. Everything else must resolve.
        const offenders = [...MAP.values()].filter(
            (to) =>
                !/^(ui|layouts|auth|pages)\//.test(to) &&
                !to.startsWith('@saasicat/') &&
                !to.startsWith('internal/'),
        );
        assert.deepEqual(offenders, [], 'the codemod points at something not exported');
    });

    test('every move lands on a file that exists — in this package or the one it names', () => {
        // The header promises the table cannot disagree with what happened to
        // the files. It did: five `components/plan/*` rows pointed at
        // `features/plan/…` while the files live in `@saasicat/ui-vue-tenant`,
        // and because that target is not on the surface the rows fell out of
        // the map — so the codemod told consumers to COPY components that are
        // still shipped. The check above only saw the map, which is after the
        // filter; this one reads the table.
        const packagesDir = resolve(HERE, '..', '..');
        const missing = Object.entries(TABLE.moves)
            .filter(([, to]) => !to.startsWith('internal/') && !to.startsWith('features/'))
            .map(([from, to]) => {
                const target = to.startsWith('@')
                    ? resolve(packagesDir, to.replace(/^@saasicat\/([^/]+)\//, '$1/src/'))
                    : resolve(packagesDir, 'ui-vue', 'src', to);
                return existsSync(target) ? null : `${from} → ${to}`;
            })
            .filter(Boolean);
        assert.deepEqual(missing, [], 'the table names a destination that is not there');
        const privateMoves = Object.values(TABLE.moves).filter(
            (to) => to.startsWith('internal/') || to.startsWith('features/'),
        );
        for (const to of privateMoves) {
            assert.ok(
                existsSync(resolve(packagesDir, 'ui-vue', 'src', to)),
                `${to} is listed as a private destination but does not exist`,
            );
        }
    });

    test('a component that left for the tenant package is rewritten, not reported', () => {
        assert.equal(
            rewriteSubpath(MAP, 'components/plan/PlanGrid.vue'),
            '@saasicat/ui-vue-tenant/plan/PlanGrid.vue',
        );
        assert.equal(isNoLongerPublic(MAP, 'components/plan/PlanGrid.vue'), false);
        const { text } = rewriteImports(
            "import G from '@saasicat/ui-vue/components/plan/PlanGrid.vue';",
            MAP,
        );
        assert.equal(text, "import G from '@saasicat/ui-vue-tenant/plan/PlanGrid.vue';");
    });

    test('a package target names a package this repository publishes', () => {
        const packages = [...MAP.values()].filter((to) => to.startsWith('@saasicat/'));
        assert.ok(packages.length > 0, 'no package target — the prefix case lost its subject');
        for (const target of packages) {
            // `@saasicat/<pkg>` is the first two segments; a file path may follow.
            const dir = target.split('/')[1];
            assert.ok(
                existsSync(resolve(HERE, '..', '..', dir, 'package.json')),
                `${target} has no package in this workspace`,
            );
        }
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

    test('a page-private part under the old alias is a removal, not a page', () => {
        // `pages-standard/bundles-page/BundleAccordionList.vue` went to
        // `internal/`. The alias fallback used to turn it into
        // `pages/bundles-page/…` — a path that resolves to nothing.
        const nested = 'pages-standard/bundles-page/BundleAccordionList.vue';
        assert.equal(rewriteSubpath(MAP, nested), null);
        assert.equal(isNoLongerPublic(MAP, nested), true);
        const result = rewriteImports(`import X from '@saasicat/ui-vue/${nested}';`, MAP);
        assert.equal(result.rewritten, 0);
        assert.equal(result.unmapped.get(nested), 1);
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

// A subpath that left the package entirely, not one that moved inside it.
//
// `pages-tenant/*` became `@saasicat/ui-vue-tenant/*` in 4.12. The rewrite has
// to emit that specifier verbatim — prefixing it the way every other target is
// prefixed would produce `@saasicat/ui-vue/@saasicat/ui-vue-tenant/…`, which
// resolves to nothing and fails in a consumer's build rather than here.
describe('a prefix that moved to another package', () => {
    test('the whole path below it comes along', () => {
        const map = buildImportMap(TABLE);
        assert.equal(
            rewriteSubpath(map, 'pages-tenant/TenantPlanSection.vue'),
            '@saasicat/ui-vue-tenant/TenantPlanSection.vue',
        );
        assert.equal(
            rewriteSubpath(map, 'pages-tenant/tenant-plan-section/TenantUsageGrid.vue'),
            '@saasicat/ui-vue-tenant/tenant-plan-section/TenantUsageGrid.vue',
        );
    });

    test('the emitted specifier is not prefixed with the old package', () => {
        const map = buildImportMap(TABLE);
        const { text, rewritten } = rewriteImports(
            "import X from '@saasicat/ui-vue/pages-tenant/TenantPlanSection.vue';",
            map,
        );
        assert.equal(rewritten, 1);
        assert.equal(text, "import X from '@saasicat/ui-vue-tenant/TenantPlanSection.vue';");
        assert.ok(!text.includes('@saasicat/ui-vue/@'), 'the old package must not survive');
    });

    test('a subpath that merely starts with the same letters is untouched', () => {
        const map = buildImportMap(TABLE);
        // `pages-tenants/` is not `pages-tenant/`. A prefix match without the
        // separator would move it too.
        assert.equal(rewriteSubpath(map, 'pages-tenantsomething/X.vue'), null);
    });
});
