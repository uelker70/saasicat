// The Stripe side of a gateway account: what it asks Stripe for when a payment
// method is set up, and what it makes of the callback Stripe sends afterwards.
//
// Run against a local server standing in for Stripe's API, so the requests are
// read as they go over the wire, and against callbacks signed the way Stripe
// signs them.

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isPaymentCallbackRejectedError } from '@saasicat/core';

import { StripePaymentGateway } from '../dist/index.js';
import { fakeStripe, signedCallback } from './support/fake-stripe.js';

const WEBHOOK_SECRET = 'whsec_test_secret';

const HOLDER = {
    name: 'Meier GmbH',
    email: 'rechnung@meier.example',
    address: {
        addressLine1: 'Hauptstraße 1',
        addressLine2: null,
        postalCode: '10115',
        city: 'Berlin',
        country: 'DE',
    },
    customerRef: null,
};

const SETUP = {
    subject: { kind: 'registration', pendingRegistrationId: 'pending-1' },
    holder: HOLDER,
    methods: ['card', 'sepa_debit'],
    successUrl: 'https://app.example/welcome',
    cancelUrl: 'https://app.example/step-4',
};

const SESSION = {
    id: 'cs_test_1',
    object: 'checkout.session',
    url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    customer: 'cus_1',
    mode: 'setup',
    setup_intent: 'seti_1',
    metadata: { saasicat_subject_kind: 'registration', saasicat_subject_id: 'pending-1' },
};

const CARD_INTENT = {
    id: 'seti_1',
    object: 'setup_intent',
    status: 'succeeded',
    customer: 'cus_1',
    mandate: null,
    payment_method: {
        id: 'pm_card_1',
        object: 'payment_method',
        type: 'card',
        card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030, country: 'DE' },
    },
};

const SEPA_INTENT = {
    id: 'seti_2',
    object: 'setup_intent',
    status: 'succeeded',
    customer: 'cus_2',
    mandate: {
        id: 'mandate_1',
        object: 'mandate',
        payment_method_details: { sepa_debit: { reference: 'ABC-123' }, type: 'sepa_debit' },
    },
    payment_method: {
        id: 'pm_sepa_1',
        object: 'payment_method',
        type: 'sepa_debit',
        sepa_debit: { last4: '3000', country: 'DE', bank_code: '37040044' },
    },
};

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
            webhookSecret: WEBHOOK_SECRET,
            currency: 'EUR',
            client: server.client,
        }),
    };
}

const event = (type, object, id = 'evt_1') => ({
    id,
    object: 'event',
    type,
    created: 1_789_000_000,
    data: { object },
});

describe('the form is opened at Stripe', () => {
    test('a party with no customer at the account gets one, and the session is opened for it', async () => {
        const ctx = await gatewayOver({
            'POST /v1/customers': { id: 'cus_new', object: 'customer' },
            'POST /v1/checkout/sessions': { ...SESSION, customer: 'cus_new' },
        });

        const session = await ctx.gateway.startPaymentMethodSetup(SETUP);

        assert.deepEqual(session, {
            sessionRef: 'cs_test_1',
            redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
            customerRef: 'cus_new',
        });
        const [customer, checkout] = ctx.requests;
        assert.deepEqual(customer.body, {
            name: 'Meier GmbH',
            email: 'rechnung@meier.example',
            'address[line1]': 'Hauptstraße 1',
            'address[postal_code]': '10115',
            'address[city]': 'Berlin',
            'address[country]': 'DE',
            'metadata[saasicat_subject_kind]': 'registration',
            'metadata[saasicat_subject_id]': 'pending-1',
        });
        assert.match(
            customer.headers['idempotency-key'],
            /^saasicat:customer:pending-1:[0-9a-f]{32}$/,
        );
        assert.deepEqual(checkout.body, {
            mode: 'setup',
            customer: 'cus_new',
            'payment_method_types[0]': 'card',
            'payment_method_types[1]': 'sepa_debit',
            currency: 'eur',
            success_url: 'https://app.example/welcome',
            cancel_url: 'https://app.example/step-4',
            'metadata[saasicat_subject_kind]': 'registration',
            'metadata[saasicat_subject_id]': 'pending-1',
            'setup_intent_data[metadata][saasicat_subject_kind]': 'registration',
            'setup_intent_data[metadata][saasicat_subject_id]': 'pending-1',
        });
    });

    test('a party that already has a customer there is not given a second one', async () => {
        const ctx = await gatewayOver({ 'POST /v1/checkout/sessions': SESSION });

        const session = await ctx.gateway.startPaymentMethodSetup({
            ...SETUP,
            holder: { ...HOLDER, customerRef: 'cus_known' },
        });

        assert.equal(session.customerRef, 'cus_known');
        assert.deepEqual(
            ctx.requests.map((request) => request.path),
            ['/v1/checkout/sessions'],
        );
        assert.equal(ctx.requests[0].body.customer, 'cus_known');
    });

    test('a party without an invoice address of its own leaves the field out rather than sending nothing', async () => {
        const ctx = await gatewayOver({
            'POST /v1/customers': { id: 'cus_new', object: 'customer' },
            'POST /v1/checkout/sessions': SESSION,
        });

        await ctx.gateway.startPaymentMethodSetup({
            ...SETUP,
            holder: {
                ...HOLDER,
                email: null,
                address: { ...HOLDER.address, addressLine2: null, city: null },
            },
        });

        const [customer] = ctx.requests;
        assert.equal('email' in customer.body, false);
        assert.equal('address[city]' in customer.body, false);
        assert.equal(customer.body['address[line1]'], 'Hauptstraße 1');
    });

    test('a session without a form to send the person to is refused, naming it', async () => {
        const ctx = await gatewayOver({
            'POST /v1/checkout/sessions': { ...SESSION, url: null },
        });

        await assert.rejects(
            ctx.gateway.startPaymentMethodSetup({
                ...SETUP,
                holder: { ...HOLDER, customerRef: 'cus_known' },
            }),
            /checkout session cs_test_1 without a URL/,
        );
    });

    test('the same request repeated keeps its key, and a changed one takes another', async () => {
        const ctx = await gatewayOver({
            'POST /v1/customers': { id: 'cus_new', object: 'customer' },
            'POST /v1/checkout/sessions': SESSION,
        });
        const keyFor = async (holder) => {
            await ctx.gateway.startPaymentMethodSetup({ ...SETUP, holder });
            return ctx.requests.filter((r) => r.path === '/v1/customers').at(-1).headers[
                'idempotency-key'
            ];
        };

        const first = await keyFor(HOLDER);
        const again = await keyFor({ ...HOLDER });
        // Another administrator of the same party, with another address on the
        // form: a different request, so a key of its own rather than the
        // refusal Stripe answers a reused key with.
        const changed = await keyFor({ ...HOLDER, email: 'buchhaltung@meier.example' });

        assert.equal(again, first, 'the same request asked under a different key');
        assert.notEqual(changed, first, 'a changed request reused the key of another one');
    });

    test('the subject of a subscriber rides along as its own identifier', async () => {
        const ctx = await gatewayOver({
            'POST /v1/customers': { id: 'cus_new', object: 'customer' },
            'POST /v1/checkout/sessions': SESSION,
        });

        await ctx.gateway.startPaymentMethodSetup({
            ...SETUP,
            subject: { kind: 'subscriber', subscriberId: 'subscriber-7' },
        });

        const [customer, checkout] = ctx.requests;
        assert.match(
            customer.headers['idempotency-key'],
            /^saasicat:customer:subscriber-7:[0-9a-f]{32}$/,
        );
        assert.equal(checkout.body['metadata[saasicat_subject_kind]'], 'subscriber');
        assert.equal(checkout.body['metadata[saasicat_subject_id]'], 'subscriber-7');
    });
});

describe('the callback Stripe sends is read', () => {
    test('a completed card setup becomes a confirmed payment method with its masked details', async () => {
        const ctx = await gatewayOver({ 'GET /v1/setup_intents/seti_1': CARD_INTENT });

        const read = await ctx.gateway.readCallback(
            signedCallback(event('checkout.session.completed', SESSION), WEBHOOK_SECRET),
        );

        assert.deepEqual(read, {
            kind: 'payment-method-confirmed',
            eventId: 'evt_1',
            occurredAt: new Date(1_789_000_000_000),
            sessionRef: 'cs_test_1',
            subject: { kind: 'registration', pendingRegistrationId: 'pending-1' },
            paymentMethod: {
                type: 'card',
                brand: 'visa',
                last4: '4242',
                expiryMonth: 12,
                expiryYear: 2030,
                country: 'DE',
                bankCode: null,
                mandateReference: null,
                customerRef: 'cus_1',
                paymentMethodRef: 'pm_card_1',
            },
        });
        // Both in one read: the payment method for what is shown, the mandate
        // for the reference a debit announcement quotes.
        assert.deepEqual(ctx.requests[0].query, {
            'expand[0]': 'payment_method',
            'expand[1]': 'mandate',
        });
    });

    test('a completed direct debit setup carries its bank details and the mandate reference', async () => {
        const ctx = await gatewayOver({ 'GET /v1/setup_intents/seti_2': SEPA_INTENT });
        const session = {
            ...SESSION,
            id: 'cs_test_2',
            customer: 'cus_2',
            setup_intent: 'seti_2',
            metadata: { saasicat_subject_kind: 'subscriber', saasicat_subject_id: 'subscriber-7' },
        };

        const read = await ctx.gateway.readCallback(
            signedCallback(event('checkout.session.completed', session), WEBHOOK_SECRET),
        );

        assert.deepEqual(read.subject, { kind: 'subscriber', subscriberId: 'subscriber-7' });
        assert.deepEqual(read.paymentMethod, {
            type: 'sepa_debit',
            brand: null,
            last4: '3000',
            expiryMonth: null,
            expiryYear: null,
            country: 'DE',
            bankCode: '37040044',
            mandateReference: 'ABC-123',
            customerRef: 'cus_2',
            paymentMethodRef: 'pm_sepa_1',
        });
    });

    test('a setup intent the session names only by identifier is still read', async () => {
        const ctx = await gatewayOver({
            'GET /v1/setup_intents/seti_1': { ...CARD_INTENT, customer: 'cus_1' },
        });

        const read = await ctx.gateway.readCallback(
            signedCallback(
                event('checkout.session.completed', { ...SESSION, customer: null }),
                WEBHOOK_SECRET,
            ),
        );

        assert.equal(read.paymentMethod.customerRef, 'cus_1');
    });

    test('a session that ran out is reported as a setup that failed, so the sign-up can try again', async () => {
        const ctx = await gatewayOver({});

        const read = await ctx.gateway.readCallback(
            signedCallback(event('checkout.session.expired', SESSION, 'evt_gone'), WEBHOOK_SECRET),
        );

        assert.deepEqual(read, {
            kind: 'payment-method-setup-failed',
            eventId: 'evt_gone',
            occurredAt: new Date(1_789_000_000_000),
            sessionRef: 'cs_test_1',
            subject: { kind: 'registration', pendingRegistrationId: 'pending-1' },
        });
    });

    test("a session the application opened for its own business is none of the platform's", async () => {
        const ctx = await gatewayOver({});
        const foreign = { ...SESSION, metadata: { order: '4711' } };

        for (const type of ['checkout.session.completed', 'checkout.session.expired']) {
            const read = await ctx.gateway.readCallback(
                signedCallback(event(type, foreign), WEBHOOK_SECRET),
            );
            assert.deepEqual(read, {
                kind: 'unhandled',
                eventId: 'evt_1',
                occurredAt: new Date(1_789_000_000_000),
                type,
            });
        }
        // Nothing was asked of Stripe about a session that is not ours.
        assert.deepEqual(ctx.requests, []);
    });

    test('a session paying for something is not a payment method being set up', async () => {
        const ctx = await gatewayOver({});

        const read = await ctx.gateway.readCallback(
            signedCallback(
                event('checkout.session.completed', { ...SESSION, mode: 'payment' }),
                WEBHOOK_SECRET,
            ),
        );

        assert.equal(read.kind, 'unhandled');
    });

    test('an event about something else is answered as needing nothing, with its own name', async () => {
        const ctx = await gatewayOver({});

        const read = await ctx.gateway.readCallback(
            signedCallback(event('invoice.paid', { id: 'in_1' }, 'evt_other'), WEBHOOK_SECRET),
        );

        assert.deepEqual(read, {
            kind: 'unhandled',
            eventId: 'evt_other',
            occurredAt: new Date(1_789_000_000_000),
            type: 'invoice.paid',
        });
    });

    test('a completed setup without a setup intent or without a payment method is reported', async () => {
        const ctx = await gatewayOver({
            'GET /v1/setup_intents/seti_empty': {
                id: 'seti_empty',
                object: 'setup_intent',
                status: 'succeeded',
            },
        });
        const completed = (session) =>
            ctx.gateway.readCallback(
                signedCallback(event('checkout.session.completed', session), WEBHOOK_SECRET),
            );

        await assert.rejects(
            completed({ ...SESSION, setup_intent: null }),
            /cs_test_1 as completed in setup mode without a setup intent/,
        );
        await assert.rejects(
            completed({ ...SESSION, setup_intent: 'seti_empty' }),
            /seti_empty as succeeded without a payment method/,
        );
    });

    test('a payment method SaaSiCat has no shape for records nothing and keeps the endpoint', async () => {
        const ctx = await gatewayOver({
            'GET /v1/setup_intents/seti_1': {
                ...CARD_INTENT,
                payment_method: { id: 'pm_link_1', object: 'payment_method', type: 'link' },
            },
            'GET /v1/setup_intents/seti_no_iban': {
                ...SEPA_INTENT,
                id: 'seti_no_iban',
                payment_method: {
                    id: 'pm_sepa_2',
                    object: 'payment_method',
                    type: 'sepa_debit',
                    sepa_debit: { country: 'DE' },
                },
            },
        });

        for (const [intent, said] of [
            ['seti_1', 'pm_link_1 is a link'],
            ['seti_no_iban', 'pm_sepa_2 is a sepa_debit with nothing to tell it apart by'],
        ]) {
            const read = await ctx.gateway.readCallback(
                signedCallback(
                    event('checkout.session.completed', { ...SESSION, setup_intent: intent }),
                    WEBHOOK_SECRET,
                ),
            );
            // Answered, not raised: asking again reads the same answer, and an
            // endpoint Stripe turns off takes every other sign-up at this
            // account with it. Named, so a dropped session of ours is not the
            // same log line as a session that was never ours.
            assert.equal(read.kind, 'unhandled', `${intent} was not answered as unhandled`);
            assert.ok(read.type.startsWith('checkout.session.completed'), read.type);
            assert.ok(read.type.includes(said), read.type);
        }
    });

    test('a setup that produced no payment method is a setup that failed, whichever state it ended in', async () => {
        const ctx = await gatewayOver({
            // Where a failed attempt lands: the intent asks for a payment
            // method again, with the error beside it.
            'GET /v1/setup_intents/seti_rejected': {
                ...SEPA_INTENT,
                id: 'seti_rejected',
                status: 'requires_payment_method',
                last_setup_error: { code: 'payment_method_provider_decline' },
            },
            'GET /v1/setup_intents/seti_canceled': {
                ...CARD_INTENT,
                id: 'seti_canceled',
                status: 'canceled',
            },
        });

        for (const intent of ['seti_rejected', 'seti_canceled']) {
            const read = await ctx.gateway.readCallback(
                signedCallback(
                    event('checkout.session.completed', { ...SESSION, setup_intent: intent }),
                    WEBHOOK_SECRET,
                ),
            );
            assert.deepEqual(read, {
                kind: 'payment-method-setup-failed',
                eventId: 'evt_1',
                occurredAt: new Date(1_789_000_000_000),
                sessionRef: 'cs_test_1',
                subject: { kind: 'registration', pendingRegistrationId: 'pending-1' },
            });
        }
    });

    test('a setup still on its way is asked about again, and given up on once the race is old', async () => {
        const ctx = await gatewayOver({
            'GET /v1/setup_intents/seti_processing': {
                ...SEPA_INTENT,
                id: 'seti_processing',
                status: 'processing',
            },
            'GET /v1/setup_intents/seti_action': {
                ...CARD_INTENT,
                id: 'seti_action',
                status: 'requires_action',
            },
        });
        const completedAt = (intent, createdSecondsAgo) =>
            ctx.gateway.readCallback(
                signedCallback(
                    {
                        ...event('checkout.session.completed', {
                            ...SESSION,
                            setup_intent: intent,
                        }),
                        created: Math.floor(Date.now() / 1000) - createdSecondsAgo,
                    },
                    WEBHOOK_SECRET,
                ),
            );

        // Raised rather than answered: the state is read after the delivery, so
        // failing it is what makes Stripe ask again once the setup has settled.
        for (const intent of ['seti_processing', 'seti_action']) {
            await assert.rejects(completedAt(intent, 5), (error) => {
                assert.ok(error.message.includes(`${intent} is '`), error.message);
                return true;
            });
        }

        // Stripe's later attempts still ask, and the last of them is inside
        // the window; only a delivery older than it is given up on, and it says
        // which setup it gave up on.
        await assert.rejects(completedAt('seti_processing', 10 * 60 * 60), (error) => {
            assert.ok(error.message.includes("seti_processing is '"), error.message);
            return true;
        });

        const read = await completedAt('seti_processing', 13 * 60 * 60);
        assert.equal(read.kind, 'unhandled');
        assert.ok(read.type.includes("seti_processing still 'processing'"), read.type);
    });

    test('an intent asking for a payment method with nothing tried yet is still on its way', async () => {
        const ctx = await gatewayOver({
            'GET /v1/setup_intents/seti_untried': {
                ...CARD_INTENT,
                id: 'seti_untried',
                status: 'requires_payment_method',
                last_setup_error: null,
            },
        });

        // Only an attempt that left an error behind is a setup that failed;
        // without one, nothing has been tried, so the next read decides.
        await assert.rejects(
            ctx.gateway.readCallback(
                signedCallback(
                    {
                        ...event('checkout.session.completed', {
                            ...SESSION,
                            setup_intent: 'seti_untried',
                        }),
                        created: Math.floor(Date.now() / 1000),
                    },
                    WEBHOOK_SECRET,
                ),
            ),
            (error) => {
                assert.ok(error.message.includes("seti_untried is '"), error.message);
                return true;
            },
        );
    });
});

describe('a callback that is not Stripe never reaches a field', () => {
    test('no signature, a forged one, one from another secret, and a body altered after signing', async () => {
        const ctx = await gatewayOver({ 'GET /v1/setup_intents/seti_1': CARD_INTENT });
        const genuine = signedCallback(
            event('checkout.session.completed', SESSION),
            WEBHOOK_SECRET,
        );
        const refused = [
            { body: genuine.body, headers: {} },
            { body: genuine.body, headers: { 'stripe-signature': 't=1,v1=deadbeef' } },
            signedCallback(event('checkout.session.completed', SESSION), 'whsec_someone_else'),
            { body: `${genuine.body} `, headers: genuine.headers },
        ];

        for (const callback of refused) {
            await assert.rejects(ctx.gateway.readCallback(callback), (error) => {
                assert.ok(isPaymentCallbackRejectedError(error), `${error} is not a rejection`);
                assert.equal(error.message.includes(WEBHOOK_SECRET), false, 'the secret leaked');
                return true;
            });
        }
        assert.deepEqual(
            ctx.requests,
            [],
            'a callback that does not verify asked Stripe something',
        );
    });

    test('a signature the server handed over as a list, and a raw body as bytes, are read', async () => {
        const ctx = await gatewayOver({ 'GET /v1/setup_intents/seti_1': CARD_INTENT });
        const genuine = signedCallback(
            event('checkout.session.completed', SESSION),
            WEBHOOK_SECRET,
        );

        const read = await ctx.gateway.readCallback({
            body: new TextEncoder().encode(genuine.body),
            headers: { 'Stripe-Signature': [genuine.headers['stripe-signature']] },
        });

        assert.equal(read.kind, 'payment-method-confirmed');
    });
});
