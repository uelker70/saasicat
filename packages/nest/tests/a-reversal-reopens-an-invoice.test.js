// A payment the gateway takes back — a direct debit the bank returned, a
// chargeback — and the gateway giving it back: recorded against what the
// payment brought, the credit first; the attempt marked reversed where its
// invoice is open again; the subscriber told by the next run, and the invoice
// collected again only with another payment method; a dispute won taking the
// reversal back, what was paid meanwhile a credit.
//
// Over an installation in memory whose attempts and payments are kept as the
// persistence contract holds both adapters to keep them, a gateway whose
// answers each test writes, and the callback route's own service.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents } from '@saasicat/core';

import {
    FIRST_RUN,
    after,
    anInvoiceToCollect,
    clockAt,
    clockFrom,
    entriesOf,
    paymentMethodOf,
    quietLog,
} from './helpers/invoice-collection.js';
import { aMailbox } from './helpers/invoice-documents.js';
import {
    collectionReported,
    refundReported,
    reversalReported,
    succeeded,
} from './helpers/money-events.js';
import { MAIN_ACCOUNT, lostAfter, signedCallback } from './helpers/payments.js';

const LATER = after(FIRST_RUN, { days: 30 });

/**
 * An invoice paid at the first run, by a payment that brought `beyond` more
 * than it owed, and a way to deliver what the gateway reports.
 */
async function aPaidInvoice({ beyond = 0, method = 'card', mail } = {}) {
    const installation = await anInvoiceToCollect(method, { mail });
    const { invoice, gateway } = installation;
    const brought = (toCents(invoice.totalGross) + toCents(beyond)) / 100;
    gateway.answers.push(succeeded(invoice, 'pi_1', brought));
    await installation.collect(FIRST_RUN);
    const [attempt] = installation.collections.attempts;
    assert.equal(attempt.status, 'SUCCEEDED', 'the premise: paid');
    const deliver = (event) => installation.callbacks.handle(MAIN_ACCOUNT, signedCallback(event));
    /** A reversal of the payment, withdrawn and given back so far, in euros. */
    const reversal = (eventId, withdrawn, reinstated = 0) =>
        reversalReported(eventId, attempt.attemptKey, {
            reversalRef: 'du_1',
            paymentRef: 'pi_1',
            withdrawnCents: toCents(withdrawn),
            reinstatedCents: toCents(reinstated),
        });
    return { ...installation, attempt, brought, deliver, reversal };
}

/** Runs the quarter-hourly run at `at`, with the clock there. */
async function runAt(installation, at) {
    clockAt(at);
    return installation.collect(at);
}

// @requirement SC-PRIC-084 — A returned debit or a chargeback is recorded, and what the payment settled opens again
describe('a reversal the gateway reports', () => {
    clockFrom(FIRST_RUN);

    test('opens the invoice again, marks the attempt reversed, and is recorded and audited once', async () => {
        quietLog();
        const { deliver, reversal, payments, collections, audits, invoice, attempt } =
            await aPaidInvoice();

        assert.equal(await deliver(reversal('evt_d1', invoice.totalGross)), 'handled');
        await deliver(reversal('evt_d2', invoice.totalGross));

        assert.equal(await payments.owedBy(invoice.id), invoice.totalGross);
        assert.equal(collections.attempts[0].status, 'REVERSED');
        assert.deepEqual(entriesOf(audits, 'SUBSCRIBER_REVERSAL_RECORDED'), [
            {
                reversalRef: 'du_1',
                paymentRef: 'pi_1',
                currency: 'EUR',
                withdrawn: invoice.totalGross,
                credit: null,
                invoices: [{ invoiceId: invoice.id, amount: invoice.totalGross }],
                unmatched: 0,
            },
        ]);
        assert.equal(attempt.attemptKey, collections.attempts[0].attemptKey);
    });

    test('that only shrinks a credit leaves the attempt and the invoice as they were', async () => {
        quietLog();
        const { deliver, reversal, payments, collections, subscriber, invoice } =
            await aPaidInvoice({ beyond: 5 });

        await deliver(reversal('evt_d1', 5));

        assert.equal(await payments.owedBy(invoice.id), 0);
        assert.equal(collections.attempts[0].status, 'SUCCEEDED');
        const [credit] = await payments.listCredits(subscriber.id);
        assert.equal(credit.open, 0);
    });

    test('of an attempt this installation does not hold records nothing', async () => {
        quietLog();
        const { deliver, payments, audits, invoice } = await aPaidInvoice();

        await deliver(
            reversalReported('evt_d1', 'saasicat:collect:elsewhere:1', {
                reversalRef: 'du_1',
                paymentRef: 'pi_1',
                withdrawnCents: toCents(invoice.totalGross),
            }),
        );

        assert.equal(await payments.owedBy(invoice.id), 0);
        assert.deepEqual(entriesOf(audits, 'SUBSCRIBER_REVERSAL_RECORDED'), []);
    });

    test('of a payment not recorded yet is refused, and recorded when the gateway delivers it again', async () => {
        quietLog();
        const installation = await anInvoiceToCollect();
        const { invoice, gateway, payments } = installation;
        gateway.answers.push(lostAfter(succeeded(invoice, 'pi_1')));
        await installation.collect(FIRST_RUN);
        const [attempt] = installation.collections.attempts;
        const deliver = (event) =>
            installation.callbacks.handle(MAIN_ACCOUNT, signedCallback(event));
        const reversed = reversalReported('evt_d1', attempt.attemptKey, {
            reversalRef: 'du_1',
            paymentRef: 'pi_1',
            withdrawnCents: toCents(invoice.totalGross),
        });

        await assert.rejects(deliver(reversed));
        await deliver(
            collectionReported('evt_paid', attempt.attemptKey, succeeded(invoice, 'pi_1')),
        );
        assert.equal(await deliver(reversed), 'handled');

        assert.equal(await payments.owedBy(invoice.id), invoice.totalGross);
    });

    // @requirement SC-ADM-033 — The operator reconciles what no credit matched, and closes each case with a note
    test('that meets a credit already refunded opens a case, audited for the operator', async () => {
        quietLog();
        const { deliver, reversal, payments, audits, attempt, brought } = await aPaidInvoice({
            beyond: 20,
        });
        await deliver(
            refundReported('evt_r1', attempt.attemptKey, {
                refundRef: 're_1',
                paymentRef: 'pi_1',
                amountCents: 2000,
                status: 'succeeded',
            }),
        );

        await deliver(reversal('evt_d1', brought));

        const [opened] = await payments.listCases({ state: 'open' }, { limit: 10 });
        assert.deepEqual(
            [opened?.kind, opened?.amount, opened?.gatewayRef],
            ['REVERSAL_UNMATCHED', 20, 'du_1'],
        );
        assert.deepEqual(entriesOf(audits, 'SUBSCRIBER_REVERSAL_UNMATCHED'), [
            {
                reversalRef: 'du_1',
                paymentRef: 'pi_1',
                currency: 'EUR',
                unmatched: 20,
                caseId: opened.id,
            },
        ]);
    });
});

// @requirement SC-PRIC-085 — A reversal is told, and the payment method it reversed collects nothing again
describe('after a reversal opened an invoice again', () => {
    clockFrom(FIRST_RUN);

    test('the subscriber is told once, asked to replace the payment method, and nothing is collected from it again', async () => {
        quietLog();
        const installation = await aPaidInvoice();
        const { deliver, reversal, mail, gateway, invoice, subscriber } = installation;
        await deliver(reversal('evt_d1', invoice.totalGross));

        for (const days of [0, 1, 7, 14]) {
            await runAt(installation, after(LATER, { days, minutes: 15 }));
        }

        const told = mail.told.filter((each) => each.notice.kind === 'collection-reversed');
        assert.equal(told.length, 1);
        assert.equal(told[0].to, subscriber.invoiceEmail);
        assert.deepEqual(
            [told[0].notice.invoiceNumber, told[0].notice.owed, told[0].notice.next],
            [invoice.number, invoice.totalGross, { action: 'replace-payment-method' }],
        );
        assert.equal(gateway.collections.length, 1, 'collected again with the reversed card');
    });

    test('with another payment method in use, the subscriber is told so and the invoice is collected with it', async () => {
        quietLog();
        const installation = await aPaidInvoice();
        const { deliver, reversal, mail, gateway, invoice, subscriber, paymentMethods, payments } =
            installation;
        await paymentMethods.recordConfirmed(
            paymentMethodOf(subscriber.id, 'card', { paymentMethodRef: 'pm_card_new' }),
        );
        await deliver(reversal('evt_d1', invoice.totalGross));

        for (const minutes of [15, 30, 45]) {
            await runAt(installation, after(LATER, { minutes }));
        }

        const [told] = mail.told.filter((each) => each.notice.kind === 'collection-reversed');
        assert.deepEqual(told.notice.next, { action: 'collected-with-payment-method-in-use' });
        assert.deepEqual(
            gateway.collections.map((each) => each.paymentMethodRef),
            [`pm_card_${subscriber.id}`, 'pm_card_new'],
        );
        assert.equal(await payments.owedBy(invoice.id), 0);
    });

    test('a direct debit that replaces the payment method waits until the subscriber heard of the reversal', async () => {
        quietLog();
        const mail = aMailbox({ tellFailures: 10, tellFailing: 'collection-reversed' });
        const installation = await aPaidInvoice({ mail });
        const { deliver, reversal, gateway, invoice, subscriber, paymentMethods, audits, attempt } =
            installation;
        await paymentMethods.recordConfirmed(paymentMethodOf(subscriber.id, 'sepa_debit'));
        await deliver(reversal('evt_d1', invoice.totalGross));

        for (const minutes of [15, 30, 45]) {
            await runAt(installation, after(LATER, { minutes }));
        }

        assert.equal(gateway.collections.length, 1);
        assert.ok(
            entriesOf(audits, 'SUBSCRIPTION_INVOICE_COLLECTION_WAITING').some(
                (entry) =>
                    entry.code === 'SUBSCRIPTION_INVOICE_FAILURE_NOT_TOLD' &&
                    entry.params.attemptKey === attempt.attemptKey,
            ),
            'the announcement went out before the reversal was told',
        );
    });

    test('a reversal given back before the run follows it up tells nobody', async () => {
        quietLog();
        const installation = await aPaidInvoice();
        const { deliver, reversal, mail, gateway, invoice, collections } = installation;
        await deliver(reversal('evt_d1', invoice.totalGross));
        await deliver(reversal('evt_d2', invoice.totalGross, invoice.totalGross));

        await runAt(installation, after(LATER, { minutes: 15 }));

        assert.deepEqual(
            mail.told.filter((each) => each.notice.kind === 'collection-reversed'),
            [],
        );
        assert.ok(collections.attempts[0].followedUpAt, 'the reversal was not followed up');
        assert.equal(gateway.collections.length, 1);
    });
});

// @requirement SC-PRIC-086 — A dispute won takes its reversal back, and what was paid meanwhile becomes a credit
describe('a reversal the gateway gives back', () => {
    clockFrom(FIRST_RUN);

    test('after the invoice was paid again leaves that payment as a credit, audited', async () => {
        quietLog();
        const installation = await aPaidInvoice();
        const { deliver, reversal, invoice, subscriber, paymentMethods, payments, audits } =
            installation;
        await paymentMethods.recordConfirmed(
            paymentMethodOf(subscriber.id, 'card', { paymentMethodRef: 'pm_card_new' }),
        );
        await deliver(reversal('evt_d1', invoice.totalGross));
        for (const minutes of [15, 30, 45]) {
            await runAt(installation, after(LATER, { minutes }));
        }
        assert.equal(await payments.owedBy(invoice.id), 0, 'the premise: paid again');

        await deliver(reversal('evt_d2', invoice.totalGross, invoice.totalGross));

        assert.equal(await payments.owedBy(invoice.id), 0);
        const credits = await payments.listCredits(subscriber.id);
        assert.deepEqual(
            credits.map(({ credit, open }) => [credit.origin.kind, credit.amount, open]),
            [['reversal', invoice.totalGross, invoice.totalGross]],
        );
        assert.deepEqual(
            entriesOf(audits, 'SUBSCRIBER_REVERSAL_GIVEN_BACK').map((entry) => entry.givenBack),
            [invoice.totalGross],
        );
        assert.deepEqual(
            entriesOf(audits, 'SUBSCRIBER_CREDIT_RECORDED').map((entry) => entry.origin.kind),
            ['reversal'],
        );
    });

    // @requirement SC-ADM-033 — The operator reconciles what no credit matched, and closes each case with a note
    test('closes the cases it opened, audited as closed because the money came back', async () => {
        quietLog();
        const { deliver, reversal, payments, audits, attempt, brought } = await aPaidInvoice({
            beyond: 20,
        });
        await deliver(
            refundReported('evt_r1', attempt.attemptKey, {
                refundRef: 're_1',
                paymentRef: 'pi_1',
                amountCents: 2000,
                status: 'succeeded',
            }),
        );
        await deliver(reversal('evt_d1', brought));
        const [opened] = await payments.listCases({ state: 'open' }, { limit: 10 });

        await deliver(reversal('evt_d2', brought, 20));

        assert.deepEqual(await payments.listCases({ state: 'open' }, { limit: 10 }), []);
        const [closed] = entriesOf(audits, 'SUBSCRIBER_RECONCILIATION_CASE_CLOSED');
        assert.deepEqual(
            [closed?.caseId, closed?.kind, closed?.amount],
            [opened.id, 'REVERSAL_UNMATCHED', 20],
        );
        assert.ok(closed?.note);
    });
});

// @requirement SC-PRIC-030 — A payment method is entered in the gateway's own form, and SaaSiCat keeps a reference
describe('the start', () => {
    test('is refused while a credit not paid out is held at an account the file no longer names, which it names', async () => {
        quietLog();
        const { payments, money, subscriber } = await aPaidInvoice({ beyond: 5 });
        await money.onApplicationBootstrap();
        payments.payments[0].gatewayAccount = 'stripe-old';

        await assert.rejects(
            money.onApplicationBootstrap(),
            /Credits not paid out are held at 'stripe-old', which config\/saas\.yaml#payments\.accounts no longer names/,
        );

        const [credit] = await payments.listCredits(subscriber.id);
        await payments.recordPayout({
            creditId: credit.credit.id,
            amount: 5,
            reference: 'TRF-1',
            paidOn: '2026-02-02',
            note: null,
            recordedBy: 'operator-1',
            at: FIRST_RUN,
        });
        await money.onApplicationBootstrap();
    });
});
