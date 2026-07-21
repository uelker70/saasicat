import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { promoStatus, pickActivePromo, applyPromo } from '../dist/index.js';

// Promotion pure functions (SPEC_V2 §9a) — shared between the public catalog
// backend and the UI preview.

const TODAY = new Date('2026-05-17T12:00:00Z');

function promo(over = {}) {
    return {
        id: 'p1',
        projectKey: 'clubapp',
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

describe('promoStatus', () => {
    test('active within the window', () => {
        assert.equal(promoStatus(promo(), TODAY), 'active');
    });
    test('scheduled before validFrom', () => {
        assert.equal(promoStatus(promo({ validFrom: '2026-08-01' }), TODAY), 'scheduled');
    });
    test('expired after validTo', () => {
        assert.equal(promoStatus(promo({ validTo: '2026-05-10' }), TODAY), 'expired');
    });
});

describe('pickActivePromo', () => {
    test('highest priority wins on overlap', () => {
        const low = promo({ id: 'low', priority: 5 });
        const high = promo({ id: 'high', priority: 30 });
        const r = pickActivePromo([low, high], 'STANDARD', 'de', 'monthly', TODAY);
        assert.equal(r.id, 'high');
    });
    test('onlyLocales filters', () => {
        const trOnly = promo({ onlyLocales: ['tr'] });
        assert.equal(pickActivePromo([trOnly], 'STANDARD', 'de', 'monthly', TODAY), null);
        assert.ok(pickActivePromo([trOnly], 'STANDARD', 'tr', 'monthly', TODAY));
    });
    test('billingCycle filters', () => {
        const yearly = promo({ billingCycle: 'yearly' });
        assert.equal(pickActivePromo([yearly], 'STANDARD', 'de', 'monthly', TODAY), null);
    });
    test('requiresCoupon promotions are not selected automatically', () => {
        const coupon = promo({ requiresCoupon: true });
        assert.equal(pickActivePromo([coupon], 'STANDARD', 'de', 'monthly', TODAY), null);
    });
    test('non-matching plan → null', () => {
        assert.equal(pickActivePromo([promo()], 'PRO', 'de', 'monthly', TODAY), null);
    });
    test('targetType filters bundle promotions separately from plan promotions', () => {
        const bundlePromo = promo({
            id: 'bundle',
            appliesTo: ['FINANCE_PLUS'],
            targetType: 'BUNDLE',
        });
        assert.equal(pickActivePromo([bundlePromo], 'FINANCE_PLUS', 'de', 'monthly', TODAY), null);
        assert.equal(
            pickActivePromo([bundlePromo], 'FINANCE_PLUS', 'de', 'monthly', TODAY, 'BUNDLE').id,
            'bundle',
        );
    });
});

describe('applyPromo', () => {
    test('percent', () => {
        const r = applyPromo(promo({ type: 'percent', value: 20 }), 100);
        assert.equal(r.kind, 'percent');
        assert.equal(r.discounted, 80);
        assert.equal(r.original, 100);
    });
    test('amount', () => {
        const r = applyPromo(promo({ type: 'amount', value: 15 }), 49);
        assert.equal(r.kind, 'amount');
        assert.equal(r.discounted, 34);
    });
    test('amount clamps at 0', () => {
        const r = applyPromo(promo({ type: 'amount', value: 999 }), 49);
        assert.equal(r.discounted, 0);
    });
    test('intro', () => {
        const r = applyPromo(promo({ type: 'intro', value: { price: 9, months: 3 } }), 49);
        assert.equal(r.kind, 'intro');
        assert.equal(r.discounted, 9);
        assert.equal(r.months, 3);
    });
    test('freeMonths', () => {
        const r = applyPromo(promo({ type: 'freeMonths', value: 2 }), 49);
        assert.equal(r.kind, 'free');
        assert.equal(r.discounted, 0);
        assert.equal(r.months, 2);
    });
    test('null when promotion is missing', () => {
        assert.equal(applyPromo(null, 100), null);
    });
});
