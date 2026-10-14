// The Stripe side of collecting an invoice: the payment intent it confirms
// without the subscriber present, what it makes of Stripe's answer — collected,
// a direct debit on its way, or a refusal and its reason —, and how it finds an
// attempt again when the answer was lost.
//
// Run against a local server standing in for Stripe's API, so the requests are
// read as they go over the wire.

// @requirement SC-PRIC-034 — A collection retried after an unanswered request never charges twice

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { StripePaymentGateway } from '../dist/index.js';
import { fakeStripe, reply } from './support/fake-stripe.js';

const KEY = 'saasicat:collect:invoice-1:1';

/** The collection of a card-paid invoice of 58.31 EUR. */
const BY_CARD = {
    attemptKey: KEY,
    invoiceId: 'invoice-1',
    invoiceNumber: 'AHP-2026-000123',
    amountCents: 5831,
    currency: 'EUR',
    customerRef: 'cus_1',
    paymentMethodRef: 'pm_card',
    type: 'card',
};

const BY_DEBIT = { ...BY_CARD, paymentMethodRef: 'pm_debit', type: 'sepa_debit' };

/** A payment intent as Stripe answers it, carrying the attempt's key. */
const intent = (status, overrides = {}) => ({
    id: 'pi_1',
    object: 'payment_intent',
    status,
    metadata: { saasicat_attempt: KEY, saasicat_invoice: 'invoice-1' },
    last_payment_error: null,
    latest_charge: null,
    cancellation_reason: null,
    ...overrides,
});

/** Stripe's answer to a declined card: 402, with the intent it created where it created one. */
function declined(declineCode, paymentIntent = null) {
    const error = {
        type: 'card_error',
        code: 'card_declined',
        decline_code: declineCode,
        message: 'Your card was declined.',
    };
    if (paymentIntent) error.payment_intent = paymentIntent;
    return reply(402, { error });
}

const open = [];
afterEach(async () => {
    for (const server of open.splice(0)) await server.close();
});

/** A gateway over a local Stripe, with the routes a test needs. */
async function gatewayOver(routes) {
    const server = await fakeStripe(routes);
    open.push(server);
    return {
        ...server,
        gateway: new StripePaymentGateway({
            secretKey: 'sk_test_unused',
            webhookSecret: 'whsec_test_secret',
            currency: 'EUR',
            client: server.client,
        }),
    };
}

describe('an invoice is collected off session', () => {
    test('as a payment intent confirmed for the payment method it announced, under the attempt key', async () => {
        const ctx = await gatewayOver({ 'POST /v1/payment_intents': intent('succeeded') });

        const outcome = await ctx.gateway.collect(BY_CARD);

        assert.deepEqual(outcome, { status: 'succeeded', paymentRef: 'pi_1' });
        const [request] = ctx.requests;
        assert.equal(request.headers['idempotency-key'], KEY);
        assert.deepEqual(request.body, {
            amount: '5831',
            currency: 'eur',
            customer: 'cus_1',
            payment_method: 'pm_card',
            'payment_method_types[0]': 'card',
            off_session: 'true',
            confirm: 'true',
            description: 'Invoice AHP-2026-000123',
            'metadata[saasicat_attempt]': KEY,
            'metadata[saasicat_invoice]': 'invoice-1',
            'expand[0]': 'latest_charge',
        });
    });

    test('a direct debit is on its way until the bank settles it', async () => {
        const ctx = await gatewayOver({ 'POST /v1/payment_intents': intent('processing') });

        const outcome = await ctx.gateway.collect(BY_DEBIT);

        assert.deepEqual(outcome, { status: 'pending', paymentRef: 'pi_1' });
        assert.equal(ctx.requests[0].body['payment_method_types[0]'], 'sepa_debit');
    });

    test('the same attempt sent again is the same request, under the same key', async () => {
        const ctx = await gatewayOver({ 'POST /v1/payment_intents': intent('succeeded') });

        await ctx.gateway.collect(BY_CARD);
        await ctx.gateway.collect(BY_CARD);

        assert.deepEqual(ctx.requests[1].body, ctx.requests[0].body);
        assert.equal(ctx.requests[1].headers['idempotency-key'], KEY);
    });
});

describe('a refusal is a failure with its reason', () => {
    const refusals = [
        [
            'a card short of funds, with the intent it created',
            declined(
                'insufficient_funds',
                intent('requires_payment_method', {
                    last_payment_error: {
                        code: 'card_declined',
                        decline_code: 'insufficient_funds',
                    },
                }),
            ),
            {
                status: 'failed',
                paymentRef: 'pi_1',
                reason: 'insufficient-funds',
                gatewayCode: 'insufficient_funds',
            },
        ],
        [
            'a lost card, refused before any intent',
            declined('lost_card'),
            {
                status: 'failed',
                paymentRef: null,
                reason: 'payment-method-unusable',
                gatewayCode: 'lost_card',
            },
        ],
        [
            'a card whose bank asks the subscriber to confirm',
            declined(
                'authentication_required',
                intent('requires_payment_method', {
                    last_payment_error: {
                        code: 'authentication_required',
                        decline_code: 'authentication_required',
                    },
                }),
            ),
            {
                status: 'failed',
                paymentRef: 'pi_1',
                reason: 'authentication-required',
                gatewayCode: 'authentication_required',
            },
        ],
        [
            'a generic decline',
            declined('generic_decline'),
            {
                status: 'failed',
                paymentRef: null,
                reason: 'declined',
                gatewayCode: 'generic_decline',
            },
        ],
        [
            'a decline code this build does not know',
            declined('something_new'),
            {
                status: 'failed',
                paymentRef: null,
                reason: 'other',
                gatewayCode: 'something_new',
            },
        ],
        [
            'a payment method detached since, which Stripe refuses as a request',
            reply(400, {
                error: {
                    type: 'invalid_request_error',
                    code: 'resource_missing',
                    message: 'No such PaymentMethod',
                },
            }),
            {
                status: 'failed',
                paymentRef: null,
                reason: 'payment-method-unusable',
                gatewayCode: 'resource_missing',
            },
        ],
        [
            'an intent the bank asks an action of, which nobody present can take',
            intent('requires_action'),
            {
                status: 'failed',
                paymentRef: 'pi_1',
                reason: 'authentication-required',
                gatewayCode: 'authentication_required',
            },
        ],
        [
            'an intent cancelled at Stripe',
            intent('canceled', { cancellation_reason: 'abandoned' }),
            { status: 'failed', paymentRef: 'pi_1', reason: 'other', gatewayCode: 'abandoned' },
        ],
    ];
    for (const [what, answer, outcome] of refusals) {
        test(`${what}`, async () => {
            const ctx = await gatewayOver({ 'POST /v1/payment_intents': answer });

            assert.deepEqual(await ctx.gateway.collect(BY_CARD), outcome);
        });
    }
});

describe('an answer that says nothing about a charge is thrown, so the attempt is asked about later', () => {
    for (const [what, answer] of [
        ["Stripe's own error", reply(500, { error: { type: 'api_error', message: 'oops' } })],
        [
            'a rate limit',
            reply(429, { error: { type: 'invalid_request_error', code: 'rate_limit' } }),
        ],
        [
            'a key reused with other parameters',
            reply(400, {
                error: { type: 'idempotency_error', message: 'Keys for idempotent requests' },
            }),
        ],
        ['an intent in a state a confirmed one never stands in', intent('requires_capture')],
    ]) {
        test(`${what}`, async () => {
            const ctx = await gatewayOver({ 'POST /v1/payment_intents': answer });

            await assert.rejects(ctx.gateway.collect(BY_CARD));
        });
    }
});

describe('what became of an attempt is asked of Stripe', () => {
    const SUBMITTED_AT = new Date('2026-02-01T05:20:00.000Z');
    const ASKED = {
        attemptKey: KEY,
        customerRef: 'cus_1',
        paymentRef: null,
        submittedAt: SUBMITTED_AT,
    };

    test('by its key among the customer’s intents created since an hour before it was submitted', async () => {
        const ctx = await gatewayOver({
            'GET /v1/payment_intents': {
                object: 'list',
                url: '/v1/payment_intents',
                has_more: false,
                data: [
                    intent('succeeded', {
                        id: 'pi_other',
                        metadata: { saasicat_attempt: 'saasicat:collect:invoice-2:1' },
                    }),
                    intent('processing'),
                ],
            },
        });

        const found = await ctx.gateway.findCollection(ASKED);

        assert.deepEqual(found, { status: 'pending', paymentRef: 'pi_1' });
        const [request] = ctx.requests;
        assert.equal(request.query.customer, 'cus_1');
        assert.equal(
            request.query['created[gte]'],
            String(SUBMITTED_AT.getTime() / 1000 - 60 * 60),
        );
    });

    test('nothing under its key: the request never arrived', async () => {
        const ctx = await gatewayOver({
            'GET /v1/payment_intents': {
                object: 'list',
                url: '/v1/payment_intents',
                has_more: false,
                data: [intent('succeeded', { metadata: {} })],
            },
        });

        assert.equal(await ctx.gateway.findCollection(ASKED), null);
    });

    test('by its reference where an answer named one: a direct debit the bank refused names the charge’s code', async () => {
        const ctx = await gatewayOver({
            'GET /v1/payment_intents/pi_1': intent('requires_payment_method', {
                latest_charge: {
                    id: 'ch_1',
                    object: 'charge',
                    failure_code: 'debit_not_authorized',
                },
                last_payment_error: { code: 'payment_method_provider_decline' },
            }),
        });

        const found = await ctx.gateway.findCollection({ ...ASKED, paymentRef: 'pi_1' });

        assert.deepEqual(found, {
            status: 'failed',
            paymentRef: 'pi_1',
            reason: 'mandate-invalid',
            gatewayCode: 'debit_not_authorized',
        });
    });

    test('an intent under its reference that carries another attempt is not taken for it', async () => {
        const ctx = await gatewayOver({
            'GET /v1/payment_intents/pi_1': intent('succeeded', {
                metadata: { saasicat_attempt: 'saasicat:collect:invoice-2:1' },
            }),
        });

        await assert.rejects(
            ctx.gateway.findCollection({ ...ASKED, paymentRef: 'pi_1' }),
            /carries another attempt/,
        );
    });
});

describe('the currency', () => {
    test('one Stripe takes in other units than cents is refused, before anything is collected in it', () => {
        assert.throws(
            () =>
                new StripePaymentGateway({
                    secretKey: 'sk_test_unused',
                    webhookSecret: 'whsec_test_secret',
                    currency: 'JPY',
                }),
            /Stripe takes JPY in other units than cents/,
        );
    });
});
