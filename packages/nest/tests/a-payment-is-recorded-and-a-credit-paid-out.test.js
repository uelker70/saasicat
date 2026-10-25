// What the gateway reports about money, recorded against the invoices: the
// payment a collection brought — from the run asking, or from the gateway's
// callback, once whichever comes first —, a refund the operator made in the
// gateway against the credits it pays out, and the credit an invoice whose
// total is negative leaves.
//
// Over an installation in memory whose attempts and payments are kept as the
// persistence contract holds both adapters to keep them, a gateway whose
// answers each test writes, and the callback route's own service, so what is
// asserted is what a callback is answered and what the installation records.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { INVOICE_COLLECTION_LEASE_MS } from '@saasicat/core';

import { InvoicePaymentService, SubscriptionInvoiceCron } from '../dist/billing/index.js';
import { PaymentCallbackService } from '../dist/payments/index.js';
import {
    FIRST_RUN,
    ISSUED,
    aCollectingInstallation,
    after,
    anInvoiceToCollect,
    clockAt,
    clockFrom,
    entriesOf,
    quietLog,
    sinceHeld,
} from './helpers/invoice-collection.js';
import { collectionReported, refundReported, succeeded } from './helpers/money-events.js';
import {
    MAIN_ACCOUNT,
    MemoryPaymentEventLog,
    RollbackRunner,
    lostAfter,
    signedCallback,
} from './helpers/payments.js';

/**
 * An invoice whose first attempt left and whose answer was lost: it stands
 * submitted, and the gateway holds `outcome` for it.
 */
async function anAttemptOnItsWay(outcome = null) {
    const installation = await anInvoiceToCollect();
    const made = outcome ?? succeeded(installation.invoice, 'pi_made');
    installation.gateway.answers.push(lostAfter(made));
    await installation.collect(FIRST_RUN);
    const [attempt] = installation.collections.attempts;
    assert.equal(attempt.status, 'SUBMITTED', 'the attempt is not on its way');
    /** Hands `event` to the webhook route's service, as the gateway delivers it. */
    const deliver = (event) => installation.callbacks.handle(MAIN_ACCOUNT, signedCallback(event));
    return { ...installation, attempt, made, deliver };
}

// @requirement SC-PRIC-029 — A payment is recorded against its invoice once the gateway has confirmed it
describe('a payment the gateway confirmed', () => {
    clockFrom(FIRST_RUN);

    test('is recorded against its invoice by the run that collected it, settling what it owes, and audited once', async () => {
        const { collect, payments, audits, invoice } = await anInvoiceToCollect();

        await collect(FIRST_RUN);
        await collect(after(FIRST_RUN, { minutes: 15 }));

        const [payment] = await payments.listPaymentsByInvoice(invoice.id);
        assert.equal(payment.gatewayRef, 'pi_1');
        assert.equal(payment.amount, invoice.totalGross);
        assert.equal(await payments.owedBy(invoice.id), 0);
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_PAYMENT_RECORDED'), [
            {
                number: invoice.number,
                attempt: 1,
                paymentRef: 'pi_1',
                amount: invoice.totalGross,
                currency: 'EUR',
                settled: invoice.totalGross,
            },
        ]);
    });

    test("reported by the gateway's callback settles the attempt at once, and the run that asks later records nothing more", async () => {
        const { deliver, collect, collections, payments, audits, attempt, invoice, made } =
            await anAttemptOnItsWay();

        assert.equal(
            await deliver(collectionReported('evt_1', attempt.attemptKey, made)),
            'handled',
        );
        assert.equal(collections.attempts[0].status, 'SUCCEEDED');
        assert.equal(await payments.owedBy(invoice.id), 0);

        clockAt(sinceHeld(attempt, INVOICE_COLLECTION_LEASE_MS + 1));
        const run = await collect(sinceHeld(attempt, INVOICE_COLLECTION_LEASE_MS + 1));

        assert.equal(run.collected, 0, 'the run counted a collection the callback recorded');
        assert.equal((await payments.listPaymentsByInvoice(invoice.id)).length, 1);
        assert.equal(entriesOf(audits, 'SUBSCRIPTION_INVOICE_PAYMENT_RECORDED').length, 1);
    });

    test('reported again is a duplicate, and reported under another event changes nothing', async () => {
        const { deliver, payments, audits, attempt, invoice, made } = await anAttemptOnItsWay();
        await deliver(collectionReported('evt_1', attempt.attemptKey, made));

        assert.equal(
            await deliver(collectionReported('evt_1', attempt.attemptKey, made)),
            'duplicate',
        );
        assert.equal(
            await deliver(collectionReported('evt_2', attempt.attemptKey, made)),
            'handled',
        );
        assert.equal((await payments.listPaymentsByInvoice(invoice.id)).length, 1);
        assert.equal(entriesOf(audits, 'SUBSCRIPTION_INVOICE_PAYMENT_RECORDED').length, 1);
    });

    test('for an attempt this installation does not hold, or one another account reports, records nothing', async () => {
        quietLog();
        const { deliver, payments, collections, attempt, invoice, made } =
            await anAttemptOnItsWay();
        collections.attempts[0].gatewayAccount = 'stripe-other';

        await deliver(collectionReported('evt_1', 'saasicat:collect:elsewhere:1', made));
        await deliver(collectionReported('evt_2', attempt.attemptKey, made));

        assert.equal(collections.attempts[0].status, 'SUBMITTED');
        assert.deepEqual(await payments.listPaymentsByInvoice(invoice.id), []);
    });

    test('under another reference than the attempt recorded records nothing', async () => {
        quietLog();
        const { deliver, payments, collections, attempt, invoice } = await anAttemptOnItsWay();
        collections.attempts[0].paymentRef = 'pi_recorded';

        await deliver(
            collectionReported('evt_1', attempt.attemptKey, succeeded(invoice, 'pi_other')),
        );

        assert.equal(collections.attempts[0].status, 'SUBMITTED');
        assert.deepEqual(await payments.listPaymentsByInvoice(invoice.id), []);
    });

    test('whose recording fails leaves the event unclaimed, and the redelivery records it', async () => {
        quietLog();
        const { deliver, payments, collections, eventLog, attempt, invoice, made } =
            await anAttemptOnItsWay();
        collections.failNextRecord = new Error('the database went away');

        await assert.rejects(deliver(collectionReported('evt_1', attempt.attemptKey, made)));
        assert.deepEqual(await payments.listPaymentsByInvoice(invoice.id), []);
        assert.deepEqual(eventLog.claims, [], 'the claim outlived what it was about');

        assert.equal(
            await deliver(collectionReported('evt_1', attempt.attemptKey, made)),
            'handled',
        );
        assert.equal((await payments.listPaymentsByInvoice(invoice.id)).length, 1);
    });

    test('whose audit entry cannot be written stays recorded', async () => {
        quietLog();
        const installation = aCollectingInstallation({ failingAuditWrites: 1 });
        const { subscriber } = await installation.aPayingSubscriber('t1', 'card');
        const invoice = await installation.anInvoiceMailed(subscriber.id, ISSUED);

        await installation.collect(FIRST_RUN);

        assert.equal(await installation.payments.owedBy(invoice.id), 0);
        assert.deepEqual(
            entriesOf(installation.audits, 'SUBSCRIPTION_INVOICE_PAYMENT_RECORDED'),
            [],
        );
    });

    test('reported after the attempt was recorded as failed is recorded all the same, and what was planned after it is not sent', async () => {
        quietLog();
        const { deliver, collect, gateway, collections, payments, attempt, invoice } =
            await anAttemptOnItsWay({
                status: 'failed',
                paymentRef: 'pi_made',
                reason: 'insufficient-funds',
                gatewayCode: 'insufficient_funds',
            });
        await deliver(
            collectionReported('evt_1', attempt.attemptKey, {
                status: 'failed',
                paymentRef: 'pi_made',
                reason: 'insufficient-funds',
                gatewayCode: 'insufficient_funds',
            }),
        );
        await collect(after(FIRST_RUN, { minutes: 15 }));
        assert.equal(collections.attempts[1]?.status, 'SCHEDULED', 'no retry was planned');

        await deliver(
            collectionReported('evt_2', attempt.attemptKey, succeeded(invoice, 'pi_made')),
        );
        clockAt(after(FIRST_RUN, { days: 8 }));
        await collect(after(FIRST_RUN, { days: 8 }));

        assert.deepEqual(
            collections.attempts.map((each) => each.status),
            ['SUCCEEDED', 'WITHDRAWN'],
        );
        assert.equal(gateway.collections.length, 1, 'the invoice was charged again');
        assert.equal(await payments.owedBy(invoice.id), 0);
    });
});

// @requirement SC-PRIC-029 — A payment is recorded against its invoice once the gateway has confirmed it
describe('an invoice a late payment covered', () => {
    clockFrom(FIRST_RUN);

    test('is collected no further when the attempt beside it fails, and nobody is told of a failure on a paid invoice', async () => {
        quietLog();
        const installation = await anInvoiceToCollect();
        const { collections, gateway, payments, notices, audits, invoice } = installation;
        const deliver = (event) =>
            installation.callbacks.handle(MAIN_ACCOUNT, signedCallback(event));
        // Attempt 1 failed and was followed up; attempt 2, with the payment
        // method that replaced it, is on its way.
        const first = await collections.startAttempt({
            invoiceId: invoice.id,
            gatewayAccount: MAIN_ACCOUNT,
            paymentMethodId: 'card-1',
            paymentMethodType: 'card',
            customerRef: 'cus_t1',
            paymentMethodRef: 'pm_card_1',
            invoiceNumber: invoice.number,
            amount: invoice.totalGross,
            currency: 'EUR',
            at: FIRST_RUN,
        });
        await collections.recordOutcome(
            first.id,
            {
                status: 'failed',
                paymentRef: 'pi_first',
                reason: 'authentication-required',
                gatewayCode: 'authentication_required',
            },
            FIRST_RUN,
        );
        await collections.markFollowedUp(first.id, FIRST_RUN);
        const second = await collections.plan({
            invoiceId: invoice.id,
            after: 1,
            gatewayAccount: MAIN_ACCOUNT,
            paymentMethodId: 'debit-2',
            paymentMethodType: 'sepa_debit',
            customerRef: 'cus_t1',
            paymentMethodRef: 'pm_debit_2',
            invoiceNumber: invoice.number,
            amount: invoice.totalGross,
            currency: 'EUR',
            collectOn: '2026-02-20',
        });
        await collections.submitPlanned(second.id, FIRST_RUN);
        await collections.recordOutcome(
            second.id,
            { status: 'pending', paymentRef: 'pi_second' },
            FIRST_RUN,
        );

        // The customer confirms the first intent after all: the money arrives.
        await deliver(
            collectionReported('evt_late', first.attemptKey, succeeded(invoice, 'pi_first')),
        );
        assert.equal(await payments.owedBy(invoice.id), 0);
        assert.equal(collections.attempts[0].status, 'FAILED', 'the premise: one is on its way');

        // Then the direct debit beside it is returned for want of funds.
        gateway.held.set(second.attemptKey, {
            status: 'failed',
            paymentRef: 'pi_second',
            reason: 'insufficient-funds',
            gatewayCode: 'insufficient_funds',
        });
        const later = after(FIRST_RUN, { days: 1 });
        clockAt(later);
        await installation.collect(later);
        clockAt(after(later, { days: 8 }));
        await installation.collect(after(later, { days: 8 }));

        assert.deepEqual(
            collections.attempts.map((each) => each.status),
            ['FAILED', 'FAILED'],
            'something more was planned for a paid invoice',
        );
        assert.ok(collections.attempts[1].followedUpAt, 'the failure was not followed up');
        assert.equal(gateway.collections.length, 0, 'the paid invoice was charged again');
        assert.ok(
            ![...notices.rows.values()].some((row) => row.subject === second.attemptKey),
            'the subscriber was told of a failure on a paid invoice',
        );
        assert.equal(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_PLANNED').length, 0);
    });

    test('has a retry whose request never reached the gateway settled rather than sent again', async () => {
        quietLog();
        const installation = await anInvoiceToCollect();
        const { collect, collections, gateway, audits, notices, invoice } = installation;
        const deliver = (event) =>
            installation.callbacks.handle(MAIN_ACCOUNT, signedCallback(event));
        // The first collection fails for want of funds; the run plans a retry.
        gateway.answers.push({
            status: 'failed',
            paymentRef: 'pi_first',
            reason: 'insufficient-funds',
            gatewayCode: 'insufficient_funds',
        });
        await collect(FIRST_RUN);
        await collect(after(FIRST_RUN, { minutes: 15 }));
        const [first, retry] = collections.attempts;
        assert.equal(retry?.status, 'SCHEDULED', 'the premise: a retry is planned');

        // The retry is sent on its day, and its request never arrives.
        const retryDay = after(FIRST_RUN, { days: 7 });
        clockAt(retryDay);
        gateway.answers.push(new Error('the connection was refused'));
        await collect(retryDay);
        assert.equal(collections.attempts[1].status, 'SUBMITTED', 'the premise: on its way');

        // The first intent succeeds after all, while the retry is open.
        await deliver(
            collectionReported('evt_late', first.attemptKey, succeeded(invoice, 'pi_first')),
        );
        const sentBefore = gateway.collections.length;

        const afterTheLease = sinceHeld(collections.attempts[1], INVOICE_COLLECTION_LEASE_MS + 1);
        clockAt(afterTheLease);
        await collect(afterTheLease);

        assert.equal(gateway.collections.length, sentBefore, 'the paid invoice was charged again');
        assert.deepEqual(
            [collections.attempts[1].status, collections.attempts[1].failureCode],
            ['FAILED', 'saasicat_invoice_paid'],
        );
        assert.ok(
            ![...notices.rows.values()].some((row) => row.subject === retry.attemptKey),
            'the subscriber was told of a failure on a paid invoice',
        );
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_ABANDONED'), [
            { number: invoice.number, attempt: 2 },
        ]);
        assert.equal(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_WITHDRAWN').length, 0);
    });

    test('sends nothing again for a request a report settled while the gateway was asked', async () => {
        quietLog();
        const installation = await anInvoiceToCollect();
        const { collect, collections, gateway, audits } = installation;
        const deliver = (event) =>
            installation.callbacks.handle(MAIN_ACCOUNT, signedCallback(event));
        gateway.answers.push(new Error('the connection was refused'));
        await collect(FIRST_RUN);
        const [attempt] = collections.attempts;
        assert.equal(attempt?.status, 'SUBMITTED', 'the premise: on its way');
        const failure = {
            status: 'failed',
            paymentRef: 'pi_meanwhile',
            reason: 'insufficient-funds',
            gatewayCode: 'insufficient_funds',
        };
        // The gateway's answer that it holds nothing crosses its report of
        // the attempt, recorded before the run decides what to do.
        const holdsNothing = gateway.findCollection.bind(gateway);
        gateway.findCollection = async (input) => {
            const answer = await holdsNothing(input);
            await deliver(collectionReported('evt_meanwhile', attempt.attemptKey, failure));
            return answer;
        };
        const sentBefore = gateway.collections.length;

        const afterTheLease = sinceHeld(attempt, INVOICE_COLLECTION_LEASE_MS + 1);
        clockAt(afterTheLease);
        await collect(afterTheLease);

        assert.equal(gateway.collections.length, sentBefore, 'a settled request was sent again');
        assert.deepEqual(
            [collections.attempts[0].status, collections.attempts[0].failureCode],
            ['FAILED', 'insufficient_funds'],
        );
        assert.equal(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_ABANDONED').length, 0);
    });

    test('records nothing twice for a report that arrives after the run decided to send again', async () => {
        quietLog();
        const installation = await anInvoiceToCollect();
        const { collect, collections, gateway, audits, notices } = installation;
        const deliver = (event) =>
            installation.callbacks.handle(MAIN_ACCOUNT, signedCallback(event));
        gateway.answers.push(new Error('the connection was refused'));
        await collect(FIRST_RUN);
        const [attempt] = collections.attempts;
        const failure = {
            status: 'failed',
            paymentRef: 'pi_after',
            reason: 'insufficient-funds',
            gatewayCode: 'insufficient_funds',
        };
        // The request reached the gateway after all, and its report arrives
        // right after the run decided to send it again.
        const decide = collections.abandonPaid.bind(collections);
        collections.abandonPaid = async (id, at) => {
            const decided = await decide(id, at);
            gateway.held.set(attempt.attemptKey, failure);
            await deliver(collectionReported('evt_after', attempt.attemptKey, failure));
            return decided;
        };

        const afterTheLease = sinceHeld(attempt, INVOICE_COLLECTION_LEASE_MS + 1);
        clockAt(afterTheLease);
        await collect(afterTheLease);

        assert.equal(gateway.collections.length, 2, 'the premise: the request was sent again');
        assert.deepEqual(
            [collections.attempts[0].status, collections.attempts[0].failureCode],
            ['FAILED', 'insufficient_funds'],
        );
        assert.equal(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_FAILED').length, 1);
        assert.equal(
            [...notices.rows.values()].filter((row) => row.subject === attempt.attemptKey).length,
            1,
            'the subscriber was told of one failure twice',
        );
    });

    test('has a planned attempt withdrawn rather than sent, naming why', async () => {
        const { collections, payments, gateway, audits, invoice, collect } =
            await anInvoiceToCollect();
        const first = await collections.startAttempt({
            invoiceId: invoice.id,
            gatewayAccount: MAIN_ACCOUNT,
            paymentMethodId: 'card-1',
            paymentMethodType: 'card',
            customerRef: 'cus_t1',
            paymentMethodRef: 'pm_card_1',
            invoiceNumber: invoice.number,
            amount: invoice.totalGross,
            currency: 'EUR',
            at: FIRST_RUN,
        });
        await collections.recordOutcome(
            first.id,
            {
                status: 'failed',
                paymentRef: 'pi_first',
                reason: 'insufficient-funds',
                gatewayCode: 'insufficient_funds',
            },
            FIRST_RUN,
        );
        await collections.markFollowedUp(first.id, FIRST_RUN);
        const planned = await collections.plan({
            invoiceId: invoice.id,
            after: 1,
            gatewayAccount: MAIN_ACCOUNT,
            paymentMethodId: 'card-1',
            paymentMethodType: 'card',
            customerRef: 'cus_t1',
            paymentMethodRef: 'pm_card_1',
            invoiceNumber: invoice.number,
            amount: invoice.totalGross,
            currency: 'EUR',
            collectOn: '2026-02-08',
        });
        // A payment covers the invoice without settling an attempt, as one
        // recorded beside another attempt does.
        await payments.recordPayment({
            invoiceId: invoice.id,
            collectionId: first.id,
            gatewayAccount: MAIN_ACCOUNT,
            provider: 'stripe',
            gatewayRef: 'pi_first',
            amount: invoice.totalGross,
            currency: 'EUR',
            at: FIRST_RUN,
        });

        clockAt(after(FIRST_RUN, { days: 8 }));
        await collect(after(FIRST_RUN, { days: 8 }));

        assert.equal(
            collections.attempts.find((each) => each.id === planned.id).status,
            'WITHDRAWN',
        );
        assert.equal(gateway.collections.length, 0);
        assert.deepEqual(
            entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_WITHDRAWN').map(
                (entry) => entry.because,
            ),
            ['paid'],
        );
    });
});

describe('a collection the gateway reports on its own', () => {
    clockFrom(FIRST_RUN);

    test('as failed is recorded once with its reason, and followed up by the next run', async () => {
        quietLog();
        const { deliver, collect, collections, audits, attempt, invoice } =
            await anAttemptOnItsWay();
        const failure = {
            status: 'failed',
            paymentRef: 'pi_made',
            reason: 'insufficient-funds',
            gatewayCode: 'insufficient_funds',
        };

        await deliver(collectionReported('evt_1', attempt.attemptKey, failure));
        await deliver(collectionReported('evt_2', attempt.attemptKey, failure));
        await collect(after(FIRST_RUN, { minutes: 15 }));

        assert.equal(collections.attempts[0].status, 'FAILED');
        assert.ok(collections.attempts[0].followedUpAt, 'the failure was not followed up');
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_FAILED'), [
            {
                number: invoice.number,
                attempt: 1,
                reason: 'insufficient-funds',
                gatewayCode: 'insufficient_funds',
            },
        ]);
    });

    test('as on its way leaves the attempt open, to be asked about', async () => {
        const { deliver, collections, attempt } = await anAttemptOnItsWay();

        await deliver(
            collectionReported('evt_1', attempt.attemptKey, {
                status: 'pending',
                paymentRef: 'pi_made',
            }),
        );

        assert.equal(collections.attempts[0].status, 'PENDING');
    });
});

// @requirement SC-PRIC-083 — A credit is paid out by the operator, and never offset against a later invoice
describe('a refund the operator made in the gateway', () => {
    clockFrom(FIRST_RUN);

    /** An invoice paid with 5.00 beyond what it owed, so its payment left a credit. */
    async function paidBeyond() {
        const installation = await anAttemptOnItsWay();
        const { deliver, attempt, invoice } = installation;
        await deliver(
            collectionReported(
                'evt_paid',
                attempt.attemptKey,
                succeeded(invoice, 'pi_made', invoice.totalGross + 5),
            ),
        );
        return installation;
    }

    test('is recorded against the credit its payment left, once, and audited', async () => {
        const { deliver, payments, audits, attempt, subscriber } = await paidBeyond();

        const event = refundReported('evt_r1', attempt.attemptKey, {
            refundRef: 're_1',
            paymentRef: 'pi_made',
            amountCents: 500,
        });
        assert.equal(await deliver(event), 'handled');
        await deliver({ ...event, eventId: 'evt_r2' });

        const [credit] = await payments.listCredits(subscriber.id);
        assert.equal(credit.open, 0);
        assert.deepEqual(
            entriesOf(audits, 'SUBSCRIBER_REFUND_RECORDED').map((entry) => entry.parts),
            [[{ creditId: credit.credit.id, amount: 5 }]],
        );
        assert.deepEqual(entriesOf(audits, 'SUBSCRIBER_REFUND_UNMATCHED'), []);
    });

    // @requirement SC-ADM-039 — The operator reconciles what no credit matched, and finds each case in the record
    test('beyond what the subscriber is owed is recorded, and what matches nothing is a case to reconcile, audited', async () => {
        quietLog();
        const { deliver, payments, audits, attempt } = await paidBeyond();

        await deliver(
            refundReported('evt_r1', attempt.attemptKey, {
                refundRef: 're_1',
                paymentRef: 'pi_made',
                amountCents: 3500,
            }),
        );

        const [opened] = await payments.listCases({ state: 'open' }, { limit: 10 });
        assert.deepEqual(
            [opened?.kind, opened?.amount, opened?.gatewayRef],
            ['REFUND_UNMATCHED', 30, 're_1'],
        );
        assert.deepEqual(entriesOf(audits, 'SUBSCRIBER_REFUND_UNMATCHED'), [
            {
                refundRef: 're_1',
                paymentRef: 'pi_made',
                unmatched: 30,
                currency: 'EUR',
                caseId: opened.id,
            },
        ]);
    });

    test('that fails gives back what it paid out, once', async () => {
        const { deliver, payments, audits, attempt, subscriber } = await paidBeyond();
        const refund = { refundRef: 're_1', paymentRef: 'pi_made', amountCents: 500 };
        await deliver(refundReported('evt_r1', attempt.attemptKey, refund));

        await deliver(
            refundReported('evt_r2', attempt.attemptKey, { ...refund, status: 'failed' }),
        );
        await deliver(
            refundReported('evt_r3', attempt.attemptKey, { ...refund, status: 'failed' }),
        );

        const [credit] = await payments.listCredits(subscriber.id);
        assert.equal(credit.open, 5);
        assert.equal(entriesOf(audits, 'SUBSCRIBER_REFUND_GIVEN_BACK').length, 1);
    });

    test('of an attempt this installation does not hold, or another account sent, records nothing and is not refused', async () => {
        quietLog();
        const { deliver, eventLog, payments, collections, attempt, made } =
            await anAttemptOnItsWay();
        await deliver(collectionReported('evt_paid', attempt.attemptKey, made));
        const refund = { refundRef: 're_1', paymentRef: 'pi_made', amountCents: 500 };

        assert.equal(
            await deliver(refundReported('evt_r1', 'saasicat:collect:elsewhere:1', refund)),
            'handled',
        );
        collections.attempts[0].gatewayAccount = 'stripe-other';
        assert.equal(
            await deliver(refundReported('evt_r2', attempt.attemptKey, refund)),
            'handled',
        );

        assert.deepEqual(payments.refunds, []);
        assert.equal(eventLog.claims.length, 3, 'the two refunds were not taken as handled');
    });

    test('of a payment not recorded yet is refused, so the gateway delivers it again once it is', async () => {
        quietLog();
        const { deliver, eventLog, payments, attempt, made } = await anAttemptOnItsWay();
        const event = refundReported('evt_r1', attempt.attemptKey, {
            refundRef: 're_1',
            paymentRef: 'pi_made',
            amountCents: 500,
        });

        await assert.rejects(deliver(event), /is not recorded yet/);
        assert.deepEqual(eventLog.claims, [], 'the refused refund was claimed');

        await deliver(collectionReported('evt_paid', attempt.attemptKey, made));
        assert.equal(await deliver(event), 'handled');
        assert.equal(
            (await payments.findPaymentByRef(MAIN_ACCOUNT, 'pi_made'))?.gatewayRef,
            'pi_made',
        );
    });
});

// @requirement SC-PRIC-083 — A credit is paid out by the operator, and never offset against a later invoice
describe('an invoice whose total is negative', () => {
    test('is credited to its subscriber once, by the run after it was issued', async () => {
        const { money, payments, store, audits, invoice, subscriber } = await anInvoiceToCollect();
        store.invoices.push({
            ...invoice,
            id: 'invoice-credit',
            number: 'AHP-2026-000099',
            totalGross: -40,
            payment: null,
        });

        assert.equal(await money.creditDue(), 1);
        assert.equal(await money.creditDue(), 0);

        const [standing] = await payments.listCredits(subscriber.id);
        assert.deepEqual(standing.credit.origin, { kind: 'invoice', invoiceId: 'invoice-credit' });
        assert.equal(standing.open, 40);
        assert.deepEqual(
            entriesOf(audits, 'SUBSCRIBER_CREDIT_RECORDED').map((entry) => entry.amount),
            [40],
        );
    });
});

describe('an event about money', () => {
    test('where nothing collects invoices is answered as one nobody acts on, and claims nothing', async () => {
        quietLog();
        const { gateways, attempt, made } = await anAttemptOnItsWay();
        const eventLog = new MemoryPaymentEventLog();
        const alone = new PaymentCallbackService(
            gateways,
            eventLog,
            new RollbackRunner([eventLog]),
        );

        const outcome = await alone.handle(
            MAIN_ACCOUNT,
            signedCallback(collectionReported('evt_1', attempt.attemptKey, made)),
        );

        assert.equal(outcome, 'unhandled');
        assert.deepEqual(eventLog.claims, []);
    });
});

describe('what the gateway reports about money', () => {
    clockFrom(FIRST_RUN);

    test('is handled inside the RLS bypass: its transaction, and what is written after it', async () => {
        const installation = await anAttemptOnItsWay();
        const { gateways, collections, payments, eventLog, attempt, made } = installation;
        let inside = 0;
        const seen = [];
        const rlsBypass = {
            async runWithBypass(fn) {
                inside += 1;
                try {
                    return await fn();
                } finally {
                    inside -= 1;
                }
            },
        };
        const watched = Object.create(payments);
        watched.recordPayment = (payment, tx) => {
            seen.push(['payment', inside > 0]);
            return payments.recordPayment(payment, tx);
        };
        const callbacks = new PaymentCallbackService(
            gateways,
            eventLog,
            new RollbackRunner([payments, eventLog]),
            rlsBypass,
        );
        new InvoicePaymentService(collections, watched, gateways, callbacks, null, {
            log: async (entry) => seen.push([entry.action, inside > 0]),
        }).onModuleInit();

        await callbacks.handle(
            MAIN_ACCOUNT,
            signedCallback(collectionReported('evt_1', attempt.attemptKey, made)),
        );

        assert.deepEqual(seen, [
            ['payment', true],
            ['SUBSCRIPTION_INVOICE_PAYMENT_RECORDED', true],
        ]);
    });

    test('whose outcome the run cannot record leaves no payment behind, and the run after the lease records it once', async () => {
        quietLog();
        const { collect, collections, payments, invoice } = await anInvoiceToCollect();
        collections.failNextRecord = new Error('database unreachable');

        await collect(FIRST_RUN);
        assert.deepEqual(await payments.listPaymentsByInvoice(invoice.id), []);

        const [submitted] = collections.attempts;
        await collect(clockAt(sinceHeld(submitted, INVOICE_COLLECTION_LEASE_MS + 1)));
        assert.equal((await payments.listPaymentsByInvoice(invoice.id)).length, 1);
    });

    test('is not taken without the payments whose callbacks report it, and says so', async () => {
        const { collections, payments } = await anInvoiceToCollect();
        const alone = new InvoicePaymentService(collections, payments);

        assert.throws(() => alone.onModuleInit(), /needs PaymentsModule/);
    });
});

describe('the quarter-hourly run', () => {
    test('credits what it issued right after issuing it, before the documents, and goes on where crediting fails', async () => {
        quietLog();
        const steps = [];
        const cron = new SubscriptionInvoiceCron(
            {
                issueDue: async () => {
                    steps.push('issue');
                    return { issued: 0, held: 0, failed: 0 };
                },
            },
            null,
            {
                archiveDue: async () => {
                    steps.push('archive');
                    return { archived: 0, held: 0, failed: 0 };
                },
                deliverDue: async () => {
                    steps.push('deliver');
                    return { delivered: 0, held: 0, failed: 0 };
                },
            },
            null,
            {
                creditDue: async () => {
                    steps.push('credit');
                    throw new Error('the database is unreachable');
                },
            },
        );

        await cron.issueDueInvoices();

        assert.deepEqual(steps, ['issue', 'credit', 'archive', 'deliver']);
    });
});
