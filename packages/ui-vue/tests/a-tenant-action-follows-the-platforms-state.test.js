// Which of suspending and reactivating a tenant row offers, from the platform's
// state of the tenant where the server says it (`SC-ADM-055`), and from
// `isActive` where it does not.

// @requirement SC-ADM-055 — A suspended tenant cannot act, and a read-only one writes only to pay or to leave

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tenantActionVisible } from '../dist/index.js';

const SUSPEND = { actionKey: 'tenants.suspend' };
const REACTIVATE = { actionKey: 'tenants.reactivate' };
const IMPERSONATE = { actionKey: 'tenants.impersonate' };

const offered = (row) =>
    [SUSPEND, REACTIVATE]
        .filter((def) => tenantActionVisible(def, row))
        .map((def) => def.actionKey);

describe("a tenant row offers what the platform's state allows", () => {
    test('an open or read-only tenant can be suspended, not reactivated', () => {
        assert.deepEqual(offered({ isActive: true, access: 'open' }), ['tenants.suspend']);
        assert.deepEqual(offered({ isActive: true, access: 'read-only' }), ['tenants.suspend']);
    });

    test('a suspended tenant can be reactivated, not suspended again', () => {
        assert.deepEqual(offered({ isActive: false, access: 'suspended' }), ['tenants.reactivate']);
    });

    test('a tenant being deleted offers neither', () => {
        assert.deepEqual(offered({ isActive: false, access: 'deleting' }), []);
    });

    test('a tenant the application deactivated is not offered a reactivation that would change nothing', () => {
        assert.deepEqual(offered({ isActive: false, access: 'open' }), ['tenants.suspend']);
    });

    test('a row without a state falls back to isActive', () => {
        assert.deepEqual(offered({ isActive: true }), ['tenants.suspend']);
        assert.deepEqual(offered({ isActive: false }), ['tenants.reactivate']);
    });

    test('other actions are not the state’s to decide', () => {
        assert.equal(
            tenantActionVisible(IMPERSONATE, { isActive: false, access: 'suspended' }),
            true,
        );
    });
});
