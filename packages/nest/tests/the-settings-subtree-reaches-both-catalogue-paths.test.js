// Every setting in the schema reaches the fingerprint on BOTH catalogue paths.
//
// `settingsSubtreeOf` excludes rather than includes, so a block the schema gains
// is fingerprinted by default — for the object bound to `PLAN_CATALOG_TOKEN`. On
// the static path that object is the loaded file, and the exclusion earns its
// keep. On the database path `composePlanCatalog` assembles the object from the
// `dbCatalog` option, member by member, and a block the schema gained but that
// option did not would be fingerprinted on one path and silently absent on the
// other, with both directions of the core test still green.
//
// So the seam is held here: the settings the schema declares are handed to the
// assembler, and every one of them has to come out the other side.

// @requirement SC-CFG-025 — The installation records the configuration it applied, and notices when it changed

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { planCatalogSchema } from '@saasicat/spec';
import { CATALOGUE_KEYS, settingsSubtreeOf } from '@saasicat/core';

import { buildPlanCatalogFromSnapshot } from '../dist/billing/index.js';

const EMPTY_SNAPSHOT = { plans: [], livePlanVersions: [], featureEntries: [] };

describe('the database path carries every setting the schema declares', () => {
    const settingKeys = Object.keys(planCatalogSchema.properties).filter(
        (key) => !CATALOGUE_KEYS.has(key),
    );

    test('the scan sees the settings, so an empty list is not a broken scan', () => {
        assert.ok(settingKeys.includes('tenantBilling'), settingKeys);
        assert.ok(settingKeys.length >= 5, settingKeys);
    });

    test('a value handed in for each of them comes out in the subtree', () => {
        const handedIn = Object.fromEntries(settingKeys.map((key) => [key, { marker: key }]));
        const catalog = buildPlanCatalogFromSnapshot(handedIn, EMPTY_SNAPSHOT);
        const subtree = settingsSubtreeOf(catalog);
        const dropped = settingKeys.filter((key) => subtree[key] === undefined);
        assert.deepEqual(
            dropped,
            [],
            'a setting the schema declares does not reach the fingerprint on the dbCatalog ' +
                'path — `buildPlanCatalogFromSnapshot`, `PlanCatalogModuleOptions` and ' +
                '`SaaSiCatModuleOptions.dbCatalog` have to carry it',
        );
    });
});
