// What Stripe reports on its own about the money of a collection: what became
// of the payment intent an attempt created, a refund the operator made of it
// in the Dashboard, and a dispute that takes it back — a chargeback, or a
// direct debit the bank returned. Every report is read again from Stripe, so
// one delivered late or twice says what stands now, and only an intent
// SaaSiCat created — the one carrying an attempt key — is SaaSiCat's to act on.
//
// Run against a local server standing in for Stripe's API, with callbacks
// signed as Stripe signs them.

// @requirement SC-PRIC-029 — A payment is recorded against its invoice once the gateway has confirmed it

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { StripePaymentGateway } from '../dist/index.js';
import { fakeStripe, signedCallback } from './support/fake-stripe.js';

const WEBHOOK_SECRET = 'whsec_test_reports';
const KEY = 'saasicat:collect:invoice-1:1';

/** A payment intent of an attempt, as Stripe answers it now. */
const intent = (status, overrides = {}) => ({
    id: 'pi_1',
    object: 'payment_intent',
    status,
    amount: 5831,
    amount_received: status === 'succeeded' ? 5831 : 0,
    currency: 'eur',
    metadata: { saasicat_attempt: KEY, saasicat_invoice: 'invoice-1' },
    last_payment_error: null,
    latest_charge: null,
    cancellation_reason: null,
    ...overrides,
});

/** A refund of `pi_1`, as Stripe answers it now, with its payment intent expanded. */
const refund = (status, overrides = {}) => ({
    id: 're_1',
    object: 'refund',
    amount: 500,
    currency: 'eur',
    status,
    payment_intent: intent('succeeded'),
    ...overrides,
});

const event = (type, object, id = 'evt_1') => ({
    id,
    object: 'event',
    type,
    created: 1_789_000_000,
    data: { object },
});

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

/** The gateway's reading of `stripeEvent`, delivered as Stripe signs it. */
const read = (ctx, stripeEvent) =>
    ctx.gateway.readCallback(signedCallback(stripeEvent, WEBHOOK_SECRET));

describe('what became of a payment intent', () => {
    test('a success is reported with what Stripe received, for the attempt its key names', async () => {
        const ctx = await gatewayOver({ 'GET /v1/payment_intents/pi_1': intent('succeeded') });

        const reported = await read(ctx, event('payment_intent.succeeded', intent('succeeded')));

        assert.deepEqual(reported, {
            kind: 'collection-reported',
            eventId: 'evt_1',
            occurredAt: new Date(1_789_000_000 * 1000),
            attemptKey: KEY,
            outcome: {
                status: 'succeeded',
                paymentRef: 'pi_1',
                amountCents: 5831,
                currency: 'EUR',
            },
        });
        assert.deepEqual(
            ctx.requests.map((request) => [request.method, request.path, request.query]),
            [['GET', '/v1/payment_intents/pi_1', { 'expand[0]': 'latest_charge' }]],
        );
    });

    test('an event delivered late reports the intent as it stands now', async () => {
        const ctx = await gatewayOver({ 'GET /v1/payment_intents/pi_1': intent('succeeded') });

        const reported = await read(ctx, event('payment_intent.processing', intent('processing')));

        assert.equal(reported.outcome.status, 'succeeded');
    });

    test('a debit on its way, and a failure with its reason, are reported as they stand', async () => {
        const failed = intent('requires_payment_method', {
            last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
        });
        const ctx = await gatewayOver({ 'GET /v1/payment_intents/pi_1': failed });

        const reported = await read(ctx, event('payment_intent.payment_failed', failed));

        assert.deepEqual(reported.outcome, {
            status: 'failed',
            paymentRef: 'pi_1',
            reason: 'insufficient-funds',
            gatewayCode: 'insufficient_funds',
        });
    });

    test('an intent SaaSiCat did not create is not its to act on', async () => {
        const foreign = intent('succeeded', { metadata: {} });
        const ctx = await gatewayOver({ 'GET /v1/payment_intents/pi_1': foreign });

        const reported = await read(ctx, event('payment_intent.succeeded', foreign));

        assert.deepEqual(reported, {
            kind: 'unhandled',
            eventId: 'evt_1',
            occurredAt: new Date(1_789_000_000 * 1000),
            type: 'payment_intent.succeeded',
        });
    });
});

// @requirement SC-PRIC-083 — A credit is paid out by the operator, and never offset against a later invoice
describe('a refund made in the Dashboard', () => {
    for (const [status, reported] of [
        ['pending', 'pending'],
        ['requires_action', 'pending'],
        ['succeeded', 'succeeded'],
        ['failed', 'failed'],
        ['canceled', 'canceled'],
    ]) {
        test(`${status} is reported as ${reported}, with the payment it pays back`, async () => {
            const ctx = await gatewayOver({ 'GET /v1/refunds/re_1': refund(status) });

            const answer = await read(ctx, event('refund.updated', refund(status)));

            assert.deepEqual(answer, {
                kind: 'refund-reported',
                eventId: 'evt_1',
                occurredAt: new Date(1_789_000_000 * 1000),
                attemptKey: KEY,
                refund: {
                    refundRef: 're_1',
                    paymentRef: 'pi_1',
                    amountCents: 500,
                    currency: 'EUR',
                    status: reported,
                },
            });
        });
    }

    test('is read again from Stripe with its payment intent, whatever the event carried', async () => {
        const ctx = await gatewayOver({ 'GET /v1/refunds/re_1': refund('failed') });

        const answer = await read(ctx, event('refund.created', refund('pending')));

        assert.equal(answer.refund.status, 'failed');
        assert.deepEqual(
            ctx.requests.map((request) => [request.method, request.path, request.query]),
            [['GET', '/v1/refunds/re_1', { 'expand[0]': 'payment_intent' }]],
        );
    });

    test('of a payment SaaSiCat did not collect, or of none, is not its to act on', async () => {
        for (const paymentIntent of [intent('succeeded', { metadata: {} }), null]) {
            const foreign = refund('succeeded', { payment_intent: paymentIntent });
            const ctx = await gatewayOver({ 'GET /v1/refunds/re_1': foreign });

            const answer = await read(ctx, event('refund.created', foreign));

            assert.equal(answer.kind, 'unhandled');
        }
    });

    test('in a state Stripe does not document is refused, so Stripe delivers it again', async () => {
        const odd = refund('unheard_of');
        const ctx = await gatewayOver({ 'GET /v1/refunds/re_1': odd });

        await assert.rejects(read(ctx, event('refund.updated', odd)), /'unheard_of'/);
    });
});

/** A balance transaction of a dispute: negative where Stripe withdrew, positive where it gave back. */
const moved = (id, amount, currency = 'eur') => ({
    id,
    object: 'balance_transaction',
    amount,
    fee: amount < 0 ? 1500 : 0,
    net: amount < 0 ? amount - 1500 : amount,
    currency,
});

/** A dispute of `pi_1`, as Stripe answers it now, with its payment intent expanded. */
const dispute = (status, transactions, overrides = {}) => ({
    id: 'du_1',
    object: 'dispute',
    amount: 5831,
    currency: 'eur',
    status,
    charge: 'ch_1',
    payment_intent: intent('succeeded'),
    balance_transactions: transactions,
    ...overrides,
});

// @requirement SC-PRIC-084 — A returned debit or a chargeback is recorded, and what the payment settled opens again
describe('a dispute of a payment', () => {
    for (const type of [
        'charge.dispute.created',
        'charge.dispute.updated',
        'charge.dispute.closed',
        'charge.dispute.funds_withdrawn',
        'charge.dispute.funds_reinstated',
    ]) {
        test(`${type} reports what Stripe withdrew and gave back so far, the fee left out`, async () => {
            const lost = dispute('won', [moved('txn_1', -5831), moved('txn_2', 5831)]);
            const ctx = await gatewayOver({ 'GET /v1/disputes/du_1': lost });

            const answer = await read(ctx, event(type, dispute('needs_response', [])));

            assert.deepEqual(answer, {
                kind: 'reversal-reported',
                eventId: 'evt_1',
                occurredAt: new Date(1_789_000_000 * 1000),
                attemptKey: KEY,
                reversal: {
                    reversalRef: 'du_1',
                    paymentRef: 'pi_1',
                    withdrawnCents: 5831,
                    reinstatedCents: 5831,
                    currency: 'EUR',
                },
            });
        });
    }

    test("is read again from Stripe with its payment intent, and its charge's", async () => {
        const ctx = await gatewayOver({
            'GET /v1/disputes/du_1': dispute('lost', [moved('txn_1', -2000)]),
        });

        const answer = await read(
            ctx,
            event('charge.dispute.created', dispute('warning_needs_response', [])),
        );

        assert.equal(answer.reversal.withdrawnCents, 2000);
        assert.deepEqual(
            ctx.requests.map((request) => [request.method, request.path, request.query]),
            [
                [
                    'GET',
                    '/v1/disputes/du_1',
                    { 'expand[0]': 'payment_intent', 'expand[1]': 'charge.payment_intent' },
                ],
            ],
        );
    });

    test('naming no payment intent of its own is found through its charge', async () => {
        const viaCharge = dispute('lost', [moved('txn_1', -5831)], {
            payment_intent: null,
            charge: { id: 'ch_1', object: 'charge', payment_intent: intent('succeeded') },
        });
        const ctx = await gatewayOver({ 'GET /v1/disputes/du_1': viaCharge });

        const answer = await read(ctx, event('charge.dispute.funds_withdrawn', viaCharge));

        assert.deepEqual([answer.kind, answer.attemptKey], ['reversal-reported', KEY]);
    });

    test('that withdrew nothing yet, an inquiry, is no reversal', async () => {
        const inquiry = dispute('warning_needs_response', []);
        const ctx = await gatewayOver({ 'GET /v1/disputes/du_1': inquiry });

        const answer = await read(ctx, event('charge.dispute.created', inquiry));

        assert.equal(answer.kind, 'unhandled');
    });

    test('of a payment SaaSiCat did not collect, or of none, is not its to act on', async () => {
        for (const paymentIntent of [intent('succeeded', { metadata: {} }), null]) {
            const foreign = dispute('lost', [moved('txn_1', -5831)], {
                payment_intent: paymentIntent,
                charge: { id: 'ch_1', object: 'charge', payment_intent: null },
            });
            const ctx = await gatewayOver({ 'GET /v1/disputes/du_1': foreign });

            const answer = await read(ctx, event('charge.dispute.created', foreign));

            assert.equal(answer.kind, 'unhandled');
        }
    });

    test('moving money in another currency than it disputes is refused, so Stripe delivers it again', async () => {
        const settledElsewhere = dispute('lost', [moved('txn_1', -6400, 'chf')]);
        const ctx = await gatewayOver({ 'GET /v1/disputes/du_1': settledElsewhere });

        await assert.rejects(
            read(ctx, event('charge.dispute.funds_withdrawn', settledElsewhere)),
            /balance transaction txn_1 in chf/,
        );
    });
});
