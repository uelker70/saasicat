// An issued invoice corrected by the operator: a cancellation invoice and a
// replacement, what was paid moved onto the replacement, the preview showing
// exactly what the cancellation then writes, and every case it is refused in;
// and how the collections of the chain carry on — a failure of the cancelled
// invoice's attempt told to nobody, a reversal of a moved payment told about
// the replacement, and a replacement collected only for what is still owed.
//
// Over an installation in memory whose invoices, attempts and payments are kept
// as the persistence contract holds both adapters to keep them, and a gateway
// whose answers each test writes.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { INVOICE_ERROR_CODES, TAX_ERROR_CODES, toCents } from '@saasicat/core';

import { InvoiceCancellationService } from '../dist/billing/index.js';
import {
    FIRST_RUN,
    after,
    anInvoiceToCollect,
    clockAt,
    clockFrom,
    paymentMethodOf,
    quietLog,
} from './helpers/invoice-collection.js';
import { collectionReported, reversalReported, succeeded } from './helpers/money-events.js';
import { MAIN_ACCOUNT, signedCallback } from './helpers/payments.js';

/** 10:00 in Berlin on 20 March, when the operator cancels the invoice of February. */
const CANCELLED_AT = new Date('2026-03-20T09:00:00.000Z');

const REQUEST = { reason: 'The billing address was wrong.' };

/** The coded answer an operator reads, as its status and body. */
async function refusalOf(attempt) {
    try {
        await attempt;
    } catch (error) {
        return [error.getStatus?.(), error.getResponse?.().code];
    }
    throw new Error('it was not refused');
}

/** What the installation holds of invoices and cancellations, to see that nothing was written. */
const heldBy = ({ store }) => [store.invoices.length, store.cancellations.length];

/** Hands invoice `invoiceId`'s document to the mail at `at`, as the document run does. */
function mailed({ store }, invoiceId, at = CANCELLED_AT) {
    store.documents.set(invoiceId, {
        invoiceId,
        checksum: 'b'.repeat(64),
        mediaType: 'application/pdf',
        fileName: `${invoiceId}.pdf`,
        size: 1,
        renderedAt: at,
        archivedAt: at,
        deliveryClaimedAt: at,
        deliveredAt: at,
        deliveredTo: 'billing@t1.example',
    });
}

/** Delivers what the gateway reports about money to the callback route. */
const delivering = (installation) => (event) =>
    installation.callbacks.handle(MAIN_ACCOUNT, signedCallback(event));

/** Runs the quarter-hourly run at `at`, with the clock there. */
async function runAt(installation, at) {
    clockAt(at);
    return installation.collect(at);
}

// @requirement SC-PRIC-025 — An issued invoice is never edited; a cancellation invoice corrects it
describe('an invoice cancelled by the operator', () => {
    clockFrom(FIRST_RUN);

    test('is written as its preview showed it, and the preview writes nothing', async () => {
        const installation = await anInvoiceToCollect();
        const { cancellation, invoice } = installation;
        const before = heldBy(installation);

        const preview = await cancellation.preview('t1', invoice.id, REQUEST, CANCELLED_AT);

        assert.deepEqual(heldBy(installation), before, 'the preview wrote something');
        const cancelled = await cancellation.cancel(
            't1',
            invoice.id,
            REQUEST,
            'operator:anna',
            CANCELLED_AT,
        );
        const {
            number: _n1,
            numberSequence: _s1,
            ...cancellationHead
        } = cancelled.cancellationInvoice;
        const { number: _n2, numberSequence: _s2, ...replacementHead } = cancelled.replacement;
        for (const [written, previewed] of [
            [cancellationHead, preview.cancellation],
            [replacementHead, preview.replacement],
        ]) {
            assert.deepEqual(
                [written.totalNet, written.totalTax, written.totalGross, written.paidOnIssue],
                [
                    previewed.totalNet,
                    previewed.totalTax,
                    previewed.totalGross,
                    previewed.paidOnIssue,
                ],
            );
            assert.deepEqual(
                [written.issueDate, written.dueDate],
                [previewed.issueDate, previewed.dueDate],
            );
        }
        assert.deepEqual(
            [cancelled.cancellationInvoice.number, cancelled.replacement.number],
            ['AHP-2026-000002', 'AHP-2026-000003'],
            'the preview drew a number',
        );
        assert.deepEqual(
            [cancelled.cancellation.reason, cancelled.cancellation.cancelledBy],
            [REQUEST.reason, 'operator:anna'],
        );
    });

    test('is reversed by its cancellation invoice, which asks for nothing, and replaced under a term of its own', async () => {
        const { cancellation, invoice } = await anInvoiceToCollect();

        const { cancellationInvoice, replacement } = await cancellation.cancel(
            't1',
            invoice.id,
            REQUEST,
            'operator:anna',
            CANCELLED_AT,
        );

        assert.deepEqual(
            [
                cancellationInvoice.totalGross,
                cancellationInvoice.payment,
                cancellationInvoice.dueDate,
            ],
            [-invoice.totalGross, null, '2026-03-20'],
        );
        // Due on 15 February, cancelled on 20 March: the replacement is due on 3 April.
        assert.deepEqual(
            [replacement.issueDate, replacement.dueDate, replacement.totalGross],
            ['2026-03-20', '2026-04-03', invoice.totalGross],
        );
        assert.equal(replacement.payment?.type, 'card');
        assert.deepEqual(
            replacement.lines.map((line) => [line.chargeId, line.correctedPosition]),
            invoice.lines.map((line) => [line.chargeId, line.position]),
        );
    });

    test('collected by direct debit, the replacement announces its own day', async () => {
        const { cancellation, invoice } = await anInvoiceToCollect('sepa_debit');

        const { replacement } = await cancellation.cancel(
            't1',
            invoice.id,
            REQUEST,
            'operator:anna',
            CANCELLED_AT,
        );

        assert.deepEqual(
            [replacement.payment?.type, replacement.collectionDate, replacement.dueDate],
            ['sepa_debit', '2026-04-03', '2026-04-03'],
        );
    });

    test('names the subscriber as the operator corrected it, and as its legal identity was corrected since, not its contact details', async () => {
        const { cancellation, invoice, subscribers, subscriber } = await anInvoiceToCollect();
        await subscribers.correctIdentity(subscriber.id, {
            kind: 'correction',
            legalName: 'Customer of t1 Holding GmbH',
            reason: 'Change of name of the same company',
            correctedBy: 'operator:anna',
        });
        await subscribers.changeContact(subscriber.id, { city: 'Potsdam' }, 'operator:anna');

        const { replacement, cancellation: written } = await cancellation.cancel(
            't1',
            invoice.id,
            {
                ...REQUEST,
                corrections: { addressLine1: 'Am Ufer 3', city: invoice.subscriber.city },
            },
            'operator:anna',
            CANCELLED_AT,
        );

        assert.deepEqual(
            [
                replacement.subscriber.legalName,
                replacement.subscriber.addressLine1,
                replacement.subscriber.city,
            ],
            ['Customer of t1 Holding GmbH', 'Am Ufer 3', invoice.subscriber.city],
        );
        assert.deepEqual(written.correctedSubscriber, {
            addressLine1: { previous: invoice.subscriber.addressLine1, corrected: 'Am Ufer 3' },
        });
    });

    test('decides the replacement’s tax for the parties it names: a case the adapter does not treat is refused, and nothing is written', async () => {
        const installation = await anInvoiceToCollect();
        const before = heldBy(installation);

        // A consumer in France, which the test adapter treats in no way.
        const refused = await refusalOf(
            installation.cancellation.cancel(
                't1',
                installation.invoice.id,
                { ...REQUEST, corrections: { country: 'FR' } },
                'operator:anna',
                CANCELLED_AT,
            ),
        );

        assert.deepEqual(refused, [422, TAX_ERROR_CODES.TAX_TREATMENT_NOT_SUPPORTED]);
        assert.deepEqual(heldBy(installation), before);
    });

    test('paid already, moves what was paid onto the replacement, which is then collected no further', async () => {
        const installation = await anInvoiceToCollect();
        const { cancellation, invoice, gateway, payments } = installation;
        await installation.collect(FIRST_RUN);

        const { replacement, credits } = await cancellation.cancel(
            't1',
            invoice.id,
            REQUEST,
            'operator:anna',
            CANCELLED_AT,
        );
        mailed(installation, replacement.id);
        await runAt(installation, after(CANCELLED_AT, { minutes: 15 }));

        assert.deepEqual(
            [replacement.paidOnIssue, replacement.payment, credits],
            [invoice.totalGross, null, []],
        );
        assert.deepEqual(
            [await payments.owedBy(invoice.id), await payments.owedBy(replacement.id)],
            [0, 0],
        );
        assert.equal(gateway.collections.length, 1, 'the replacement was collected again');
    });

    test('paid in part, the replacement is collected for the rest alone', async () => {
        const installation = await anInvoiceToCollect();
        const { cancellation, invoice, gateway, payments } = installation;
        gateway.answers.push(succeeded(invoice, 'pi_part', 20));
        await installation.collect(FIRST_RUN);

        const { replacement } = await cancellation.cancel(
            't1',
            invoice.id,
            REQUEST,
            'operator:anna',
            CANCELLED_AT,
        );
        mailed(installation, replacement.id);
        await runAt(installation, after(CANCELLED_AT, { minutes: 15 }));

        const rest = (toCents(invoice.totalGross) - 2000) / 100;
        assert.deepEqual([replacement.paidOnIssue, replacement.payment?.type], [20, 'card']);
        assert.equal(gateway.collections.at(-1)?.amountCents, toCents(rest));
        assert.equal(await payments.owedBy(replacement.id), 0);
    });

    test('withdraws a collection of it planned and not yet made', async () => {
        const { cancellation, invoice, collections, method } = await anInvoiceToCollect();
        await collections.plan({
            invoiceId: invoice.id,
            after: 0,
            gatewayAccount: MAIN_ACCOUNT,
            paymentMethodId: method.id,
            paymentMethodType: 'card',
            customerRef: method.customerRef,
            paymentMethodRef: method.paymentMethodRef,
            invoiceNumber: invoice.number,
            amount: invoice.totalGross,
            currency: 'EUR',
            collectOn: '2026-03-25',
        });

        const { withdrawnCollections } = await cancellation.cancel(
            't1',
            invoice.id,
            REQUEST,
            'operator:anna',
            CANCELLED_AT,
        );

        assert.equal(withdrawnCollections, 1);
        assert.deepEqual(
            collections.attempts.map((each) => each.status),
            ['WITHDRAWN'],
        );
    });
});

// @requirement SC-PRIC-025 — An issued invoice is never edited; a cancellation invoice corrects it
// @requirement SC-PRIC-036 — What an invoice owes and how it is paid changes one step at a time
describe('a cancellation refused', () => {
    clockFrom(FIRST_RUN);

    const cancel = (installation, invoiceId, request = REQUEST, tenantId = 't1') =>
        installation.cancellation.cancel(
            tenantId,
            invoiceId,
            request,
            'operator:anna',
            CANCELLED_AT,
        );

    test('for an invoice the tenant does not have, or that does not exist', async () => {
        const installation = await anInvoiceToCollect();

        assert.deepEqual(
            await refusalOf(cancel(installation, installation.invoice.id, REQUEST, 't2')),
            [404, INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_FOUND],
        );
        assert.deepEqual(await refusalOf(cancel(installation, 'invoice-unknown')), [
            404,
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_FOUND,
        ]);
    });

    test('for an invoice cancelled already, and for a cancellation invoice, drawing no number', async () => {
        const installation = await anInvoiceToCollect();
        const first = await cancel(installation, installation.invoice.id);
        const before = heldBy(installation);

        assert.deepEqual(await refusalOf(cancel(installation, installation.invoice.id)), [
            409,
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_ALREADY_CANCELLED,
        ]);
        assert.deepEqual(await refusalOf(cancel(installation, first.cancellationInvoice.id)), [
            422,
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_IS_CANCELLATION,
        ]);
        assert.deepEqual(heldBy(installation), before);
        // Its replacement is cancelled instead, once archived, numbered next.
        mailed(installation, first.replacement.id);
        const second = await cancel(installation, first.replacement.id);
        assert.equal(second.cancellationInvoice.number, 'AHP-2026-000004');
    });

    test('while the invoice’s document is not archived', async () => {
        const installation = await anInvoiceToCollect();
        installation.store.documents.get(installation.invoice.id).archivedAt = null;

        assert.deepEqual(await refusalOf(cancel(installation, installation.invoice.id)), [
            409,
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_YET_ARCHIVED,
        ]);
    });

    test('where the subscriber can be reached at no address, until one is given', async () => {
        const installation = await anInvoiceToCollect();
        await installation.subscribers.changeContact(
            installation.subscriber.id,
            { invoiceEmail: null },
            'operator:anna',
        );

        assert.deepEqual(await refusalOf(cancel(installation, installation.invoice.id)), [
            422,
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NO_DELIVERY_ADDRESS,
        ]);
        const given = await cancel(installation, installation.invoice.id, {
            ...REQUEST,
            deliverTo: 'accounts@t1.example',
        });
        assert.equal(given.cancellation.deliverTo, 'accounts@t1.example');
    });

    test('for an invoice that states a credit', async () => {
        const installation = await anInvoiceToCollect();
        const [credit] = installation.store.invoices;
        Object.assign(credit, { totalNet: -10, totalTax: -1.9, totalGross: -11.9 });

        assert.deepEqual(await refusalOf(cancel(installation, credit.id)), [
            422,
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_STATES_A_CREDIT,
        ]);
    });

    test('where the direct debit in use names no mandate the replacement could announce', async () => {
        const installation = await anInvoiceToCollect();
        await installation.paymentMethods.recordConfirmed(
            paymentMethodOf(installation.subscriber.id, 'sepa_debit', { mandateReference: null }),
        );
        const before = heldBy(installation);

        assert.deepEqual(await refusalOf(cancel(installation, installation.invoice.id)), [
            422,
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_MANDATE_MISSING,
        ]);
        assert.deepEqual(heldBy(installation), before);
    });

    test('at every start without the transaction it is written on', () => {
        const service = new InvoiceCancellationService(null, null, null, null, null, {}, null);

        assert.throws(() => service.onModuleInit(), /contractFreeze\.transactionRunner/);
    });
});

// @requirement SC-PRIC-036 — What an invoice owes and how it is paid changes one step at a time
// @requirement SC-PRIC-085 — A reversal is told, and the payment method it reversed collects nothing again
describe('the collections of a cancelled invoice’s chain', () => {
    clockFrom(FIRST_RUN);

    test('a failure of the cancelled invoice’s attempt is recorded and told to nobody, and the replacement is collected once it is resolved', async () => {
        quietLog();
        const installation = await anInvoiceToCollect('sepa_debit');
        const { cancellation, invoice, gateway, collections, mail } = installation;
        gateway.answers.push({ status: 'pending', paymentRef: 'pi_debit' });
        await runAt(installation, new Date('2026-02-15T05:00:00.000Z'));
        const [attempt] = collections.attempts;
        const { replacement } = await cancellation.cancel(
            't1',
            invoice.id,
            REQUEST,
            'operator:anna',
            CANCELLED_AT,
        );
        mailed(installation, replacement.id, new Date('2026-03-20T09:00:00.000Z'));

        await runAt(installation, new Date('2026-04-03T05:00:00.000Z'));
        assert.equal(gateway.collections.length, 1, 'collected beside the debit on its way');

        await delivering(installation)(
            collectionReported('evt_f1', attempt.attemptKey, {
                status: 'failed',
                paymentRef: 'pi_debit',
                reason: 'insufficient-funds',
                gatewayCode: 'insufficient_funds',
            }),
        );
        await runAt(installation, new Date('2026-04-03T05:15:00.000Z'));
        await runAt(installation, new Date('2026-04-03T05:30:00.000Z'));

        assert.deepEqual(
            mail.told.filter((each) => each.notice.kind === 'collection-failed'),
            [],
            'the failure of an invoice that no longer stands was told',
        );
        assert.deepEqual(
            collections.attempts
                .filter((each) => each.invoiceId === invoice.id)
                .map((each) => each.status),
            ['FAILED'],
            'the cancelled invoice was planned again',
        );
        assert.deepEqual(
            gateway.collections.map((each) => each.invoiceNumber),
            [invoice.number, replacement.number],
        );
    });

    test('a reversal of a payment that moved tells the subscriber the replacement is open again', async () => {
        quietLog();
        const installation = await anInvoiceToCollect();
        const { cancellation, invoice, collections, mail } = installation;
        await installation.collect(FIRST_RUN);
        const [attempt] = collections.attempts;
        const { replacement } = await cancellation.cancel(
            't1',
            invoice.id,
            REQUEST,
            'operator:anna',
            CANCELLED_AT,
        );

        await delivering(installation)(
            reversalReported('evt_r1', attempt.attemptKey, {
                reversalRef: 'du_1',
                paymentRef: 'pi_1',
                withdrawnCents: toCents(invoice.totalGross),
            }),
        );
        await runAt(installation, after(CANCELLED_AT, { days: 1 }));

        const told = mail.told.filter((each) => each.notice.kind === 'collection-reversed');
        assert.equal(told.length, 1);
        assert.deepEqual(
            [told[0].notice.invoiceNumber, told[0].notice.owed],
            [replacement.number, invoice.totalGross],
        );
        assert.equal(await installation.payments.owedBy(replacement.id), invoice.totalGross);
    });
});
