// The payment method card on a tenant's plan page is shown to whoever holds the
// billing permission, and to nobody else — decided by the server, which answers
// 403 to a user without it and 404 where the installation takes no payment
// methods. The composable reads those two as "not for this user", every other
// failure as an error the card has to say, and sends a change to the gateway's
// form without touching the payment method in use.

// @requirement SC-UI-023 — A tenant's invoices, payment method and billing details need the billing permission

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useTenantPaymentMethod } from '../dist/index.js';

const CARD = {
    type: 'card',
    brand: 'visa',
    last4: '4242',
    expiryMonth: 12,
    expiryYear: 2030,
    country: 'DE',
    mandateReference: null,
    confirmedAt: '2026-09-15T10:00:00.000Z',
};

/** An HTTP client answering each request with the next scripted status and body. */
function scriptedHttp(...answers) {
    const calls = [];
    return {
        calls,
        client: async (url, init) => {
            calls.push({
                url,
                method: init?.method ?? 'GET',
                body: init?.body ? JSON.parse(init.body) : undefined,
            });
            const [status, body] = answers.shift();
            return {
                status,
                headers: { get: () => null },
                json: async () => body,
                text: async () => JSON.stringify(body),
            };
        },
    };
}

describe('loading the payment method', () => {
    test('a user holding the permission sees the one in use', async () => {
        const { client, calls } = scriptedHttp([200, { paymentMethod: CARD }]);
        const method = useTenantPaymentMethod({ http: client, autoLoad: false });

        await method.reload();

        assert.deepEqual(calls, [
            { url: '/billing/payment-method', method: 'GET', body: undefined },
        ]);
        assert.equal(method.available.value, true);
        assert.deepEqual(method.paymentMethod.value, CARD);
        assert.equal(method.error.value, null);
    });

    test('a subscriber without one yet is shown the card, empty', async () => {
        const { client } = scriptedHttp([200, { paymentMethod: null }]);
        const method = useTenantPaymentMethod({ http: client, autoLoad: false });

        await method.reload();

        assert.equal(method.available.value, true);
        assert.equal(method.paymentMethod.value, null);
    });

    for (const [status, why] of [
        [403, 'the user lacks the billing permission'],
        [404, 'the installation takes no payment methods'],
    ]) {
        test(`a ${status} hides the card without an error: ${why}`, async () => {
            const { client } = scriptedHttp(
                [200, { paymentMethod: CARD }],
                [status, { code: 'X' }],
            );
            const method = useTenantPaymentMethod({ http: client, autoLoad: false });
            await method.reload();

            await method.reload();

            assert.equal(method.available.value, false);
            assert.equal(
                method.paymentMethod.value,
                null,
                'a card hidden after a reload kept its data',
            );
            assert.equal(method.error.value, null);
        });
    }

    test('any other failure keeps the card and says it failed', async () => {
        const { client } = scriptedHttp([500, { message: 'boom' }]);
        const method = useTenantPaymentMethod({ http: client, autoLoad: false });

        await method.reload();

        assert.equal(method.available.value, true);
        assert.ok(method.error.value instanceof Error);
        assert.equal(method.loading.value, false);
    });

    test('an answer in another shape is an error, not a subscriber without a payment method', async () => {
        const { client } = scriptedHttp([200, []]);
        const method = useTenantPaymentMethod({ http: client, autoLoad: false });

        await method.reload();

        assert.equal(method.available.value, true);
        assert.equal(method.paymentMethod.value, null);
        assert.match(method.error.value?.message ?? '', /did not answer with \{ paymentMethod \}/);
    });

    test('the prefix the billing routes sit under is used as given', async () => {
        const { client, calls } = scriptedHttp([200, { paymentMethod: null }]);
        const method = useTenantPaymentMethod({
            http: client,
            apiPrefix: '/api/v1/billing/',
            autoLoad: false,
        });

        await method.reload();

        assert.equal(calls[0].url, '/api/v1/billing/payment-method');
    });
});

describe('changing the payment method', () => {
    test('asks for the gateway form with both URLs, and answers where to go', async () => {
        const { client, calls } = scriptedHttp([
            200,
            { redirectUrl: 'https://gateway.example/form/cs_1' },
        ]);
        const method = useTenantPaymentMethod({ http: client, autoLoad: false });
        const urls = {
            successUrl: 'https://app.example/plan?changed=1',
            cancelUrl: 'https://app.example/plan',
        };

        assert.equal(await method.startChange(urls), 'https://gateway.example/form/cs_1');
        assert.deepEqual(calls, [
            { url: '/billing/payment-method/setup', method: 'POST', body: urls },
        ]);
    });

    test('a refusal reaches the caller with its code', async () => {
        const { client } = scriptedHttp([409, { code: 'PAYMENTS_NOT_CONFIGURED', message: 'no' }]);
        const method = useTenantPaymentMethod({ http: client, autoLoad: false });

        await assert.rejects(
            method.startChange({ successUrl: 'https://a.example', cancelUrl: 'https://a.example' }),
            (error) => error.code === 'PAYMENTS_NOT_CONFIGURED' && error.status === 409,
        );
    });
});
