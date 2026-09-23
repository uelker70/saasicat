// A promotion lowers the price of what it is on, and nothing else: whatever it
// states, the price it produces lies between 0 and the price it meets.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { applyPromo } from '../dist/index.js';

function promo(over = {}) {
    return {
        id: 'p1',
        internalLabel: 'Test',
        type: 'percent',
        value: 20,
        appliesTo: ['STANDARD'],
        billingCycle: 'both',
        validFrom: '2026-05-01',
        validTo: '2026-06-30',
        priority: 10,
        onlyLocales: null,
        requiresCoupon: false,
        codes: [],
        color: '#10b981',
        i18n: {},
        createdAt: '',
        updatedAt: '',
        ...over,
    };
}

// @requirement SC-MKT-010 — Exactly one promotion applies to a given plan, language and rhythm
describe('applyPromo keeps a price between 0 and the price it is applied to', () => {
    for (const [what, fields, basePrice, discounted] of [
        ['a percentage above 100 takes the whole price and no more', { value: 150 }, 30, 0],
        ['exactly 100 % takes the whole price', { value: 100 }, 30, 0],
        ['an amount above the price takes the whole price', { type: 'amount', value: 35 }, 30, 0],
        ['an amount equal to the price takes it', { type: 'amount', value: 30 }, 30, 0],
        [
            'an amount a cent below the price leaves the cent',
            { type: 'amount', value: 29.99 },
            30,
            0.01,
        ],
        [
            'a negative intro price is a free intro, not a credit',
            { type: 'intro', value: { price: -5, months: 1 } },
            30,
            0,
        ],
        [
            'an intro price a cent below the price lowers it by the cent',
            { type: 'intro', value: { price: 29.99, months: 1 } },
            30,
            29.99,
        ],
    ]) {
        test(what, () => {
            const result = applyPromo(promo({ type: 'percent', ...fields }), basePrice);
            assert.equal(result.discounted, discounted);
            assert.equal(result.original, basePrice);
        });
    }

    test('what the result says it takes off is what it takes off', () => {
        assert.equal(applyPromo(promo({ value: 150 }), 30).pct, 100);
        assert.equal(applyPromo(promo({ type: 'amount', value: 35 }), 30).saved, 30);
    });

    for (const [what, fields, basePrice] of [
        ['a negative percentage', { value: -20 }, 30],
        ['a percentage of zero', { value: 0 }, 30],
        ['a negative amount', { type: 'amount', value: -5 }, 30],
        ['an intro price above the price', { type: 'intro', value: { price: 35, months: 1 } }, 30],
        [
            'an intro price equal to the price',
            { type: 'intro', value: { price: 30, months: 1 } },
            30,
        ],
        ['any promotion on a price of zero', { value: 50 }, 0],
        ['an intro with no value at all', { type: 'intro', value: null }, 30],
    ]) {
        test(`${what} takes nothing off, so it is no promotion there`, () => {
            assert.equal(applyPromo(promo({ type: 'percent', ...fields }), basePrice), null);
        });
    }
});
