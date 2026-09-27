// What an operator's refresh would change on a contract, compared without
// reading anything: the frozen features against today's, the frozen quotas
// against a re-freeze's, and every amount the successor would charge.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    featureChangeOf,
    moneyChangesOf,
    quotaChangesOf,
    vocabularyOf,
} from '../dist/billing/index.js';

const PRICE = {
    currency: 'EUR',
    billingCycle: 'monthly',
    vatRate: 19,
    subtotalNet: 49,
    discountNet: 0,
    totalNet: 49,
    totalGross: 58.31,
};

function line(overrides = {}) {
    return {
        kind: 'plan',
        sourceKey: 'PRO',
        sourceVersionId: 'pv-1',
        quantity: 1,
        billingCycle: 'monthly',
        currency: 'EUR',
        taxRate: 19,
        priceNet: 49,
        priceGross: 58.31,
        taxAmount: 9.31,
        ...overrides,
    };
}

describe('features', () => {
    test('what is added and what is removed, each sorted', () => {
        assert.deepEqual(featureChangeOf(['CORE', 'ATLAS'], ['CORE', 'ATLAS_AES', 'API']), {
            added: ['API', 'ATLAS_AES'],
            removed: ['ATLAS'],
        });
    });

    test('the same set is no change, in whatever order it comes', () => {
        assert.deepEqual(featureChangeOf(['B', 'A'], new Set(['A', 'B'])), {
            added: [],
            removed: [],
        });
    });
});

describe('quotas', () => {
    test('a quota that moves, one that appears and one that goes, and none that stays', () => {
        assert.deepEqual(
            quotaChangesOf(
                { users: 10, storageGb: 25, seats: 3 },
                { users: 5, storageGb: 25, api: -1 },
            ),
            [
                { key: 'api', before: null, after: -1 },
                { key: 'seats', before: 3, after: null },
                { key: 'users', before: 10, after: 5 },
            ],
        );
    });
});

// @requirement SC-ENTL-023 — An operator carries a changed vocabulary into running contracts, seeing it first
describe('money', () => {
    const contract = { priceSnapshot: PRICE, lineItems: [line()] };

    test('a successor that charges the same is no change, whatever version its lines name', () => {
        assert.deepEqual(
            moneyChangesOf(contract, {
                priceSnapshot: { ...PRICE },
                lineItems: [line({ sourceVersionId: 'pv-2' })],
            }),
            [],
        );
    });

    test('a price edited into the version is named, on the total and on the line', () => {
        const changes = moneyChangesOf(contract, {
            priceSnapshot: { ...PRICE, subtotalNet: 59, totalNet: 59, totalGross: 70.21 },
            lineItems: [line({ priceNet: 59, priceGross: 70.21, taxAmount: 11.21 })],
        });
        assert.deepEqual(
            changes.map((change) => change.field),
            [
                'priceSnapshot.subtotalNet',
                'priceSnapshot.totalNet',
                'priceSnapshot.totalGross',
                'line plan:PRO priceNet',
                'line plan:PRO priceGross',
                'line plan:PRO taxAmount',
            ],
        );
        assert.deepEqual(changes[1], { field: 'priceSnapshot.totalNet', before: 49, after: 59 });
    });

    test('a tax rate and a currency are changes of their own', () => {
        const fields = moneyChangesOf(contract, {
            priceSnapshot: { ...PRICE, currency: 'CHF', vatRate: 8.1 },
            lineItems: [line({ currency: 'CHF', taxRate: 8.1 })],
        }).map((change) => change.field);
        assert.ok(fields.includes('priceSnapshot.currency'));
        assert.ok(fields.includes('priceSnapshot.vatRate'));
        assert.ok(fields.includes('line plan:PRO currency'));
        assert.ok(fields.includes('line plan:PRO taxRate'));
    });

    test('a line on one side only is named with its price', () => {
        const withAddOn = {
            priceSnapshot: PRICE,
            lineItems: [line(), line({ kind: 'bundle', sourceKey: 'ARCHIVE', priceNet: 10 })],
        };
        assert.deepEqual(moneyChangesOf(withAddOn, { priceSnapshot: PRICE, lineItems: [line()] }), [
            { field: 'line bundle:ARCHIVE', before: 10, after: null },
        ]);
        assert.deepEqual(moneyChangesOf(contract, withAddOn), [
            { field: 'line bundle:ARCHIVE', before: null, after: 10 },
        ]);
    });
});

// @requirement SC-ENTL-022 — An operator is told which running contracts hold a feature vocabulary left behind
describe('the vocabulary a contract has fallen behind', () => {
    const known = new Set(['CORE', 'ATLAS_AES', 'ATLAS']);

    test('a frozen key nothing knows is unknown; a key granted today and not frozen is missing', () => {
        assert.deepEqual(
            vocabularyOf({
                frozen: new Set(['CORE', 'LEGACY_EXPORT']),
                frozenWithReplacements: new Set(['CORE', 'LEGACY_EXPORT']),
                grantedToday: new Set(['CORE', 'ATLAS_AES']),
                known,
            }),
            { unknown: ['LEGACY_EXPORT'], missing: ['ATLAS_AES'] },
        );
    });

    test('a renamed key a replaces declaration carries over is neither', () => {
        assert.deepEqual(
            vocabularyOf({
                frozen: new Set(['CORE', 'ATLAS']),
                frozenWithReplacements: new Set(['CORE', 'ATLAS', 'ATLAS_AES']),
                grantedToday: new Set(['CORE', 'ATLAS_AES']),
                known,
            }),
            { unknown: [], missing: [] },
        );
    });
});
