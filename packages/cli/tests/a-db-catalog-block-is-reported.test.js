// @requirement SC-CFG-019 — A migration tool reports a setting that moved; it does not delete it
// @requirement SC-COMP-004 — The upgrade command reports what it cannot decide rather than guessing

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { findDbCatalogBlocks, WHERE_DB_CATALOG_GOES } from '../dist/index.js';

// `dbCatalog` names the file now. A block that still carries the settings as
// values is reported with its line and left in place: the file those values
// were forwarded from is a variable in another module more often than a
// literal here, and a rewrite that guessed would be wrong quietly. The boot
// refusal is what keeps the report from being acted on halfway.

describe('what the codemod says about a dbCatalog that still carries the values', () => {
    test('an object literal with no path is reported, with its line', () => {
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
        assert.deepEqual(findDbCatalogBlocks(source).occurrences, [{ line: 3, shape: 'values' }]);
    });

    test('a nested object inside the block does not end it early', () => {
        const source = `dbCatalog: { app: { name: 'X', version: '1' }, currency: 'EUR' },`;
        assert.deepEqual(findDbCatalogBlocks(source).occurrences, [{ line: 1, shape: 'values' }]);
    });

    test('one that names the file is what the option takes, so it is not reported', () => {
        const source = `dbCatalog: { path: 'config/saas.yaml' },\ndbCatalog: {\n    path: SAAS_CONFIG_PATH,\n    env: process.env,\n},`;
        assert.deepEqual(findDbCatalogBlocks(source).occurrences, []);
    });

    test('a value it cannot see into is named for a person to look at', () => {
        const source = `const options = {\n    dbCatalog: DB_CATALOG,\n};`;
        assert.deepEqual(findDbCatalogBlocks(source).occurrences, [
            { line: 2, shape: 'reference' },
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
            { line: 1, shape: 'values' },
        ]);
    });

    test('the sentence says what to write', () => {
        assert.match(WHERE_DB_CATALOG_GOES, /dbCatalog: \{ path: 'config\/saas\.yaml' \}/);
        assert.match(WHERE_DB_CATALOG_GOES, /Delete the values/);
    });
});
