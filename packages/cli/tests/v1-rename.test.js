import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { namedImports, rewriteManifest, rewriteNames } from '../dist/index.js';

// naming-history: this file names the retired spellings because they are what
// the codemod rewrites. The rules come from `codemods/v1-rename.map.json`, the
// table the platform's own rename was checked against — shipped, so what a
// consumer's code becomes cannot disagree with what the packages export.

const TABLE = JSON.parse(
    readFileSync(fileURLToPath(new URL('../codemods/v1-rename.map.json', import.meta.url)), 'utf8'),
);

describe('the table points at things that exist', () => {
    test('it has entries in every section', () => {
        for (const section of ['identifierStems', 'registryKeys', 'entryTokens', 'subpaths']) {
            assert.ok(Object.keys(TABLE[section]).length > 0, `${section} is empty`);
        }
    });

    test('every registry-key target is inside the one namespace', () => {
        for (const to of Object.values(TABLE.registryKeys)) {
            assert.match(to, /^saasicat\/[a-z-]+\//, `${to} is outside saasicat/<package>/`);
        }
    });

    test('every per-entry token target is exported by that entry', async () => {
        // A rewrite to a name the entry does not export moves the failure into
        // the consumer's build, where this file cannot be seen.
        for (const [specifier, names] of Object.entries(TABLE.entryTokens)) {
            const entry = await import(specifier);
            for (const to of Object.values(names)) {
                assert.ok(typeof entry[to] === 'symbol', `${specifier} does not export ${to}`);
            }
        }
    });

    test('every identifier stem resolves to the one spelling', () => {
        for (const to of Object.values(TABLE.identifierStems)) assert.equal(to, 'SaaSiCat');
    });
});

describe('the shapes a consumer meets', () => {
    test('the module class and the option types', () => {
        const { text, rewritten } = rewriteNames(
            "import { SaasPlatformModule, type SaasPlatformModuleOptions } from '@saasicat/nest';\nSaasPlatformModule.forRoot(o as SaasPlatformModuleOptions);",
            TABLE,
        );
        assert.equal(
            text,
            "import { SaaSiCatModule, type SaaSiCatModuleOptions } from '@saasicat/nest';\nSaaSiCatModule.forRoot(o as SaaSiCatModuleOptions);",
        );
        assert.equal(rewritten, 4);
    });

    test('a stem inside a longer identifier', () => {
        const { text } = rewriteNames(
            "import { createSaasPlatformTestModule } from '@saasicat/nest/testing';\nconst a: SaasicatPersistenceAdapter = x;",
            TABLE,
        );
        assert.match(text, /createSaaSiCatTestModule/);
        assert.match(text, /SaaSiCatPersistenceAdapter/);
    });

    test('the lowercase scope and file names are not a stem', () => {
        const source = "import x from '@saasicat/nest';\nimport y from './define-saasicat.js';";
        assert.equal(rewriteNames(source, TABLE).text, source);
    });

    test('a registry key a consumer spelled themselves, on one line or three', () => {
        const { text } = rewriteNames(
            "const A = Symbol.for('saas-platform/MfaPort');\nconst B = Symbol.for(\n    'saas-platform-nest/PlatformSubscriptionRepository',\n);\nconst C = Symbol.for('saas-platform-cli/Config');\nconst D = Symbol.for('@saasicat/ui-vue/SA_THEME');",
            TABLE,
        );
        assert.match(text, /Symbol\.for\('saasicat\/nest\/MfaPort'\)/);
        assert.match(text, /'saasicat\/nest\/PlatformSubscriptionRepository'/);
        assert.match(text, /'saasicat\/cli\/Config'/);
        assert.match(text, /Symbol\.for\('saasicat\/ui-vue\/SA_THEME'\)/);
    });

    test('an import specifier that looks like the ui-vue key prefix is left alone', () => {
        const source = "import Page from '@saasicat/ui-vue/pages/UsersPage.vue';";
        assert.equal(rewriteNames(source, TABLE).text, source);
    });

    test('the token that meant two things is renamed by the entry it came from', () => {
        const billing = rewriteNames(
            "import { FEATURE_UI_REGISTRY_TOKEN } from '@saasicat/nest/billing';\n@Inject(FEATURE_UI_REGISTRY_TOKEN) r;",
            TABLE,
        );
        assert.match(billing.text, /import \{ BILLING_FEATURE_UI_REGISTRY_TOKEN \}/);
        assert.match(billing.text, /@Inject\(BILLING_FEATURE_UI_REGISTRY_TOKEN\)/);
        assert.deepEqual(billing.ambiguous, []);

        const catalog = rewriteNames(
            "import { FEATURE_UI_REGISTRY_TOKEN } from '@saasicat/nest/catalog';",
            TABLE,
        );
        assert.match(catalog.text, /CATALOG_FEATURE_UI_REGISTRY_TOKEN/);
    });

    test('and reported, not guessed, when the entry does not say which', () => {
        const source = "import { FEATURE_UI_REGISTRY_TOKEN } from '@saasicat/nest';";
        const result = rewriteNames(source, TABLE);
        assert.equal(result.text, source);
        assert.deepEqual(result.ambiguous, ["FEATURE_UI_REGISTRY_TOKEN from '@saasicat/nest'"]);
    });

    test('the package that stopped being only types', () => {
        const { text } = rewriteNames(
            "import type { PlanVersionRow } from '@saasicat/types';\nimport { classifyPlanDiff } from '@saasicat/types';",
            TABLE,
        );
        assert.equal(
            text,
            "import type { PlanVersionRow } from '@saasicat/core';\nimport { classifyPlanDiff } from '@saasicat/core';",
        );
    });

    test('the e2e helper subpath', () => {
        const { text } = rewriteNames(
            "import { runAdminPagesSuite } from '@saasicat/ui-vue/testing-e2e/admin-pages-suite';",
            TABLE,
        );
        assert.equal(
            text,
            "import { runAdminPagesSuite } from '@saasicat/ui-vue/testing/admin-pages-suite';",
        );
    });

    test('a second run changes nothing', () => {
        const once = rewriteNames(
            "import { SaasPlatformModule } from '@saasicat/nest';\nSymbol.for('saas-platform/X');\nSymbol.for('FakeTransactionRunner.tx');",
            TABLE,
        );
        const twice = rewriteNames(once.text, TABLE);
        assert.equal(twice.text, once.text);
        assert.equal(twice.rewritten, 0);
    });
});

describe('reading named imports', () => {
    test('single-line, multi-line, type-only and aliased forms', () => {
        const found = namedImports(
            [
                "import { A, type B } from '@saasicat/nest';",
                'import type {',
                '    C as D,',
                '    E,',
                '} from "@saasicat/nest/billing";',
                "import F from '@saasicat/core';",
            ].join('\n'),
        );
        assert.deepEqual(found, [
            { names: ['A', 'B'], specifier: '@saasicat/nest' },
            { names: ['C', 'E'], specifier: '@saasicat/nest/billing' },
        ]);
    });

    test('finishes on the input a backtracking expression would choke on', () => {
        // CodeQL's case: many `import {{` in a row, then no closing statement.
        const hostile = `${'import {{'.repeat(20_000)} from 'x'`;
        const started = Date.now();
        namedImports(hostile);
        assert.ok(Date.now() - started < 1_000, 'the scan is not linear');
        const spaces = `import { A${' '.repeat(50_000)}as B } from 'y'`;
        assert.deepEqual(namedImports(spaces)[0]?.names, ['A']);
    });
});

describe('one name from two entries in one file', () => {
    test('is reported, not rewritten to whichever import came last', () => {
        const source = [
            "import { FEATURE_UI_REGISTRY_TOKEN as BILLING } from '@saasicat/nest/billing';",
            "import { FEATURE_UI_REGISTRY_TOKEN as CATALOG } from '@saasicat/nest/catalog';",
            '',
        ].join('\n');
        const result = rewriteNames(source, TABLE);
        assert.equal(result.text, source);
        assert.deepEqual(result.ambiguous, [
            "FEATURE_UI_REGISTRY_TOKEN from '@saasicat/nest/catalog'",
        ]);
    });
});

describe('a renamed package reaches the manifest', () => {
    test('the dependency fields are rewritten, nothing else is', () => {
        const before = JSON.stringify(
            {
                name: 'my-app',
                description: 'uses @saasicat/types',
                dependencies: { '@saasicat/types': '^1.0.0-rc.0', vue: '^3.5.0' },
                devDependencies: { '@saasicat/ui-vue': 'workspace:^' },
                peerDependencies: { '@saasicat/types': '^1.0.0-rc.0' },
            },
            null,
            2,
        );
        const { text, rewritten } = rewriteManifest(before + '\n', TABLE);
        const after = JSON.parse(text);
        assert.equal(rewritten, 2);
        assert.deepEqual(after.dependencies, { '@saasicat/core': '^1.0.0-rc.0', vue: '^3.5.0' });
        assert.deepEqual(after.peerDependencies, { '@saasicat/core': '^1.0.0-rc.0' });
        assert.equal(after.description, 'uses @saasicat/types', 'prose is not a dependency');
        assert.match(text, /^ {2}"name"/m, 'the two-space indentation survived');
        assert.ok(text.endsWith('\n'));
    });

    test('a manifest without the package is returned untouched', () => {
        const before = '{\n    "name": "x",\n    "dependencies": { "vue": "^3.5.0" }\n}\n';
        const result = rewriteManifest(before, TABLE);
        assert.equal(result.text, before);
        assert.equal(result.rewritten, 0);
    });

    test('the specifier rewrite stops at the package boundary', () => {
        const { text } = rewriteNames(
            "import a from '@saasicat/types';\nimport b from '@saasicat/types/dist/x.js';\nimport c from '@saasicat/types-extra';",
            TABLE,
        );
        assert.match(text, /from '@saasicat\/core';/);
        assert.match(text, /from '@saasicat\/core\/dist\/x\.js';/);
        assert.match(text, /from '@saasicat\/types-extra';/);
    });
});
