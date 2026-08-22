import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { rewriteNames } from '../dist/index.js';

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
