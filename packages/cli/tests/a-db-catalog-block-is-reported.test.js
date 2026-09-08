// @requirement SC-CFG-019 — A migration tool reports a setting that moved; it does not delete it
// @requirement SC-COMP-004 — The upgrade command reports what it cannot decide rather than guessing

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { findDbCatalogBlocks, WHERE_DB_CATALOG_GOES } from '../dist/index.js';
import { DB_CATALOG_MEMBERS } from '@saasicat/nest/platform';

// `dbCatalog` names the file now. A block that still carries the settings as
// values is reported with its line and left in place: the file those values
// were forwarded from is a variable in another module more often than a
// literal here, and a rewrite that guessed would be wrong quietly. The boot
// refusal is what keeps the report from being acted on halfway.

describe('what the codemod says about a dbCatalog that still carries the values', () => {
    test('an object literal with no path is reported, with its line and its members', () => {
        const source = `
            export const CONFIG = defineSaaSiCat({
                dbCatalog: {
                    app: SAAS_CONFIG.app,
                    currency: SAAS_CONFIG.currency,
                    vatRate: SAAS_CONFIG.vatRate,
                    tenantBilling: SAAS_CONFIG.tenantBilling,
                },
                persistence: PERSISTENCE,
            });`;
        assert.deepEqual(findDbCatalogBlocks(source).occurrences, [
            {
                line: 3,
                shape: 'values',
                leftovers: ['app', 'currency', 'vatRate', 'tenantBilling'],
            },
        ]);
    });

    test('a nested object inside the block does not end it early, and its members are not this block’s', () => {
        const source = `dbCatalog: { app: { name: 'X', version: '1' }, currency: 'EUR' },`;
        assert.deepEqual(findDbCatalogBlocks(source).occurrences, [
            { line: 1, shape: 'values', leftovers: ['app', 'currency'] },
        ]);
    });

    test('one that names the file, and nothing else, is what the option takes, so it is not reported', () => {
        const source = `dbCatalog: { path: 'config/saas.yaml' },\ndbCatalog: {\n    path: SAAS_CONFIG_PATH,\n    env: process.env,\n},\ndbCatalog: { path },`;
        assert.deepEqual(findDbCatalogBlocks(source).occurrences, []);
    });

    test('a path with a value left beside it is an upgrade that stopped halfway, and the value is named', () => {
        const source = `dbCatalog: {\n    path: 'config/saas.yaml',\n    vatRate: SAAS_CONFIG.vatRate,\n    tenantBilling: SAAS_CONFIG.tenantBilling,\n},`;
        assert.deepEqual(findDbCatalogBlocks(source).occurrences, [
            { line: 1, shape: 'mixed', leftovers: ['vatRate', 'tenantBilling'] },
        ]);
    });

    test('a spread beside the path is named as one, because what it carries is decided elsewhere', () => {
        const source = `dbCatalog: { ...identity, path: 'config/saas.yaml' },`;
        assert.deepEqual(findDbCatalogBlocks(source).occurrences, [
            { line: 1, shape: 'mixed', leftovers: ['...identity'] },
        ]);
    });

    test('a path that is not this block’s own does not count as one', () => {
        // Nested under `app`, and mentioned in a comment: neither is a `path`
        // member of the block, so the block still carries only values.
        const source = `dbCatalog: {\n    // path: 'config/saas.yaml' once this is migrated\n    app: { path: 'x', name: 'X' },\n    currency: 'EUR', // the colon in a string decides nothing: 'a:b'\n},`;
        assert.deepEqual(findDbCatalogBlocks(source).occurrences, [
            { line: 1, shape: 'values', leftovers: ['app', 'currency'] },
        ]);
    });

    test('a value it cannot see into is named for a person to look at', () => {
        const source = `const options = {\n    dbCatalog: DB_CATALOG,\n};`;
        assert.deepEqual(findDbCatalogBlocks(source).occurrences, [
            { line: 2, shape: 'reference', leftovers: [] },
        ]);
    });

    test('a mention that is not a property is not a block', () => {
        // `saasicat init` writes this sentence into every generated app.module.ts,
        // and a type member is a declaration, not a value passed.
        const source = `// SuperAdmin UI pass \`dbCatalog\` instead.\ninterface Options { dbCatalog?: { path: string } }\nconst x = myDbCatalog;`;
        assert.deepEqual(findDbCatalogBlocks(source).occurrences, []);
    });

    test('a block the file ends inside is still reported rather than lost', () => {
        assert.deepEqual(findDbCatalogBlocks(`dbCatalog: { currency: 'EUR'`).occurrences, [
            { line: 1, shape: 'values', leftovers: ['currency'] },
        ]);
    });

    test('what counts as migrated is the list the platform refuses by, not a copy of it', () => {
        // Both halves read `DB_CATALOG_MEMBERS`: the platform's boot refusal
        // and this report. A member the option gains reaches both at once.
        const members = DB_CATALOG_MEMBERS.map((member) => `${member}: x`).join(', ');
        assert.deepEqual(findDbCatalogBlocks(`dbCatalog: { ${members} },`).occurrences, []);
        assert.ok(DB_CATALOG_MEMBERS.includes('path'));
    });

    test('the sentence says what to write', () => {
        assert.match(WHERE_DB_CATALOG_GOES, /dbCatalog: \{ path: 'config\/saas\.yaml' \}/);
        assert.match(WHERE_DB_CATALOG_GOES, /Delete the values/);
    });
});
