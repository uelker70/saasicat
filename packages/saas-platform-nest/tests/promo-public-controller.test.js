// Smoke-Tests für PromoCodePublicController.
// Direktes Instanziieren ohne NestJS-Bootstrap, mit minimaler PromoCodesService-
// Stub-Implementierung. RateLimitGuard wird nicht in diesen Tests exercised
// (eigener Guard-Test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PromoCodePublicController } from '../dist/promo/index.js';

function buildPromoStub({ previewResult } = {}) {
    return {
        previewCalls: [],
        async preview(input) {
            this.previewCalls.push(input);
            return (
                previewResult ?? {
                    valid: true,
                    code: input.code.toUpperCase(),
                    label: '25 % Rabatt',
                    discount: {
                        valueType: 'PERCENT',
                        value: '25.00',
                        durationType: 'ONCE',
                        durationValue: null,
                    },
                    price: {
                        originalGross: '199.00',
                        discountGross: '49.75',
                        discountedGross: '149.25',
                        includedVat: '23.84',
                        nextRegularAmountGross: '199.00',
                        regularStartsAt: null,
                    },
                }
            );
        },
    };
}

function buildReq() {
    return {
        headers: { 'x-forwarded-for': '203.0.113.1' },
        ip: '203.0.113.1',
        user: { id: 'u-onb-1' },
    };
}

test('preview reicht code/plan/billingCycle 1:1 an den Service durch', async () => {
    const promo = buildPromoStub();
    const ctrl = new PromoCodePublicController(promo);
    const result = await ctrl.preview(
        { code: 'EINSTEIGER20', plan: 'SPORT', billingCycle: 'YEARLY' },
        buildReq(),
    );
    assert.equal(result.valid, true);
    assert.equal(promo.previewCalls.length, 1);
    const [call] = promo.previewCalls;
    assert.equal(call.code, 'EINSTEIGER20');
    assert.equal(call.planId, 'SPORT');
    assert.equal(call.billingCycle, 'YEARLY');
});

test('preview reicht email + ipHash + sessionId an den Service durch', async () => {
    const promo = buildPromoStub();
    const ctrl = new PromoCodePublicController(promo);
    await ctrl.preview(
        {
            code: 'EINSTEIGER20',
            plan: 'SPORT',
            billingCycle: 'YEARLY',
            email: 'admin@example.org',
        },
        buildReq(),
    );
    const [call] = promo.previewCalls;
    assert.equal(call.email, 'admin@example.org');
    assert.equal(call.sessionId, 'u-onb-1');
    assert.match(call.ipHash ?? '', /^ip[0-9a-f]+$/);
});

test('preview leitet invalid-Antwort 1:1 weiter', async () => {
    const promo = buildPromoStub({
        previewResult: { valid: false, reason: 'EXPIRED' },
    });
    const ctrl = new PromoCodePublicController(promo);
    const result = await ctrl.preview(
        { code: 'OLDCODE', plan: 'SPORT', billingCycle: 'MONTHLY' },
        buildReq(),
    );
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'EXPIRED');
});

test('preview funktioniert ohne authentifizierten Nutzer (sessionId undefined)', async () => {
    const promo = buildPromoStub();
    const ctrl = new PromoCodePublicController(promo);
    await ctrl.preview(
        { code: 'EINSTEIGER20', plan: 'SPORT', billingCycle: 'YEARLY' },
        { headers: {}, ip: '127.0.0.1' },
    );
    const [call] = promo.previewCalls;
    assert.equal(call.sessionId, undefined);
});
