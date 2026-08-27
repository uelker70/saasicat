// Every repository this package exports is reachable through
// `drizzlePersistence()`.
//
// A class can be complete, exported, and covered by the persistence contract
// and still be unreachable for a consumer, because the contract harness
// constructs each repository by hand. That is exactly how
// `DrizzleSubscriptionContractRepository` shipped wired into nothing:
// `SaaSiCatModule.forRoot` could not discover it, so a consumer on the
// documented `drizzlePersistence({ db })` path had no contract-backed
// entitlement and no error telling them why.
//
// The expectation is derived, not listed: the exported names come from the
// package's own entry point and the wiring from the factory's source, so a new
// repository is covered the moment it is exported.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as adapter from '../dist/index.js';

const factorySource = readFileSync(
    fileURLToPath(new URL('../src/drizzle-persistence.ts', import.meta.url)),
    'utf8',
);

/**
 * Every class this package exports, taken as a class rather than as a name.
 *
 * The first version of this check matched `Drizzle*Repository|Adapter`, and a
 * naming convention is not a derivation: `DrizzleTenantSubscriptionWrite` ends
 * in neither word, so the check passed while the class it was meant to protect
 * was reachable from nothing. Asking what a value *is* cannot be narrowed by a
 * name somebody chose later.
 */
const exportedClasses = Object.entries(adapter)
    .filter(
        ([, value]) =>
            typeof value === 'function' &&
            value.prototype !== undefined &&
            Object.getOwnPropertyDescriptor(value, 'prototype')?.writable === false,
    )
    .map(([name]) => name)
    .sort();

describe('the persistence factory', () => {
    test('names enough exports for this check to mean anything', () => {
        // Without this, a broken filter passes by finding nothing.
        assert.ok(
            exportedClasses.length >= 10,
            `expected the package to export classes, found ${exportedClasses.length}`,
        );
    });

    for (const name of exportedClasses) {
        test(`${name} is reachable through drizzlePersistence()`, () => {
            assert.ok(
                factorySource.includes(`new ${name}(`),
                `${name} is exported but never constructed in drizzlePersistence(). ` +
                    'A consumer on the documented path cannot reach it, and nothing ' +
                    'tells them so — wire it into the slice it belongs to.',
            );
        });
    }
});
