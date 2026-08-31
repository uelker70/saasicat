// Smoke tests for PromoCodePublicController.
// Direct instantiation without NestJS bootstrap, using a minimal PromoCodesService
// stub implementation. The guard in front of the route is covered separately
// at the bottom of this file (wire contract of its 429).

// @requirement SC-PROMO-006 — A discount runs for at most 24 months or billing periods
// @requirement SC-PROMO-016 — A code past its validity stops working without anybody having to run anything

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PromoCodePublicController, PromoCodeRateLimitGuard } from '../dist/promo/index.js';

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

test('preview passes code/plan/billingCycle 1:1 through to the service', async () => {
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

test('preview passes email + ipHash + sessionId through to the service', async () => {
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

test('preview forwards invalid response 1:1', async () => {
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

test('preview works without an authenticated user (sessionId undefined)', async () => {
    const promo = buildPromoStub();
    const ctrl = new PromoCodePublicController(promo);
    await ctrl.preview(
        { code: 'EINSTEIGER20', plan: 'SPORT', billingCycle: 'YEARLY' },
        { headers: {}, ip: '127.0.0.1' },
    );
    const [call] = promo.previewCalls;
    assert.equal(call.sessionId, undefined);
});

// RATE_LIMITED promises `retryAfterSeconds`; a client renders it directly.
// The value must belong to the limiter that tripped — IP window one minute,
// session window one hour.
function buildGuardContext(req) {
    return { switchToHttp: () => ({ getRequest: () => req }) };
}

function rejectionOf(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    assert.fail('the guard must throw');
}

test('rate limit 429 carries retryAfterSeconds of the IP window', () => {
    const guard = new PromoCodeRateLimitGuard();
    const req = { headers: {}, ip: '198.51.100.7' };
    for (let i = 0; i < 20; i++) {
        assert.equal(guard.canActivate(buildGuardContext(req)), true);
    }
    const error = rejectionOf(() => guard.canActivate(buildGuardContext(req)));
    assert.equal(error.getStatus(), 429);
    assert.deepEqual(error.getResponse(), {
        code: 'RATE_LIMITED',
        message: 'Too many attempts. Please try again in 60 seconds.',
        params: { retryAfterSeconds: 60 },
        retryAfterSeconds: 60,
        valid: false,
        reason: 'RATE_LIMITED',
    });
});

test('rate limit 429 carries retryAfterSeconds of the session window', () => {
    const guard = new PromoCodeRateLimitGuard();
    // One request per IP, so only the session bucket can overflow.
    for (let i = 0; i < 50; i++) {
        const req = { headers: {}, ip: `203.0.113.${i}`, user: { id: 'onb-1' } };
        assert.equal(guard.canActivate(buildGuardContext(req)), true);
    }
    const error = rejectionOf(() =>
        guard.canActivate(
            buildGuardContext({ headers: {}, ip: '203.0.113.99', user: { id: 'onb-1' } }),
        ),
    );
    assert.equal(error.getResponse().retryAfterSeconds, 3600);
});
