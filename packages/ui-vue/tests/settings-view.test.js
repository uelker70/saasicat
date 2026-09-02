// How the settings page shows a subtree: one row per leaf, values that stay
// distinguishable.

// @requirement SC-CFG-008 — An operator can see when the running configuration was applied, and from where

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { flattenSettings, showSettingValue } from '../dist/client/index.js';

describe('flattenSettings', () => {
    test('one row per leaf, at the path the file spells, in the order it wrote them', () => {
        assert.deepEqual(
            flattenSettings({
                currency: 'EUR',
                tenantBilling: {
                    cancellationNoticeDays: { monthly: 14, yearly: 90 },
                    selfServiceBlockedPlans: { asTarget: ['ENTERPRISE'], asSource: [] },
                },
            }),
            [
                { path: 'currency', value: 'EUR' },
                { path: 'tenantBilling.cancellationNoticeDays.monthly', value: 14 },
                { path: 'tenantBilling.cancellationNoticeDays.yearly', value: 90 },
                { path: 'tenantBilling.selfServiceBlockedPlans.asTarget', value: ['ENTERPRISE'] },
                { path: 'tenantBilling.selfServiceBlockedPlans.asSource', value: [] },
            ],
        );
    });

    test('a list is one leaf — one setting the operator wrote, not a row per plan', () => {
        assert.deepEqual(flattenSettings({ asTarget: ['A', 'B'] }), [
            { path: 'asTarget', value: ['A', 'B'] },
        ]);
    });

    test('nothing in, nothing out', () => {
        assert.deepEqual(flattenSettings({}), []);
    });
});

describe('showSettingValue', () => {
    test('a string reads as itself, everything else as JSON, so 0, "0" and [] stay apart', () => {
        assert.equal(showSettingValue('EUR', '—'), 'EUR');
        assert.equal(showSettingValue(0, '—'), '0');
        assert.equal(showSettingValue('0', '—'), '0');
        assert.equal(showSettingValue([], '—'), '[]');
        assert.equal(showSettingValue(['ENTERPRISE'], '—'), '["ENTERPRISE"]');
        assert.equal(showSettingValue(null, '—'), 'null');
    });

    test('a leaf that did not exist on one side reads as the word for absent', () => {
        assert.equal(showSettingValue(undefined, '— not set —'), '— not set —');
    });
});
