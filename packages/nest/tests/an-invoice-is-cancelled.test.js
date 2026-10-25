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

import { InvoiceCancellationService, invoiceCancellationAudit } from '../dist/billing/index.js';
import {
    FIRST_RUN,
    ISSUED,
    aCollectingInstallation,
    after,
    anInvoiceToCollect,
    clockAt,
    clockFrom,
    paymentMethodOf,
    quietLog,
} from './helpers/invoice-collection.js';
import { collectionReported, reversalReported, succeeded } from './helpers/money-events.js';
import { line } from './helpers/invoice-run.js';
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
const mailed = (installation, invoiceId, at = CANCELLED_AT) => installation.mailed(invoiceId, at);

/** Delivers what the gateway reports about money to the callback route. */
const delivering = (installation) => (event) =>
    installation.callbacks.handle(MAIN_ACCOUNT, signedCallback(event));

/** Runs the quarter-hourly run at `at`, with the clock there. */
async function runAt(installation, at) {
    clockAt(at);
    return installation.collect(at);
}

// @requirement SC-PRIC-095 — An issued invoice is never edited; its cancellation corrects what was not owed
describe('an invoice cancelled by the operator', () => {
    clockFrom(FIRST_RUN);

    test('is written as its preview showed it, and the preview writes nothing', async () => {
        const installation = await anInvoiceToCollect();
        const { cancellation, invoice } = installation;
        const before = heldBy(installation);

        const preview = await cancellation.preview(invoice.id, REQUEST, CANCELLED_AT);

        assert.deepEqual(heldBy(installation), before, 'the preview wrote something');
        const cancelled = await cancellation.cancel(
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

    test('states as paid on the replacement what moves onto it, and no share below nothing', async () => {
        const installation = await anInvoiceToCollect();
        const { cancellation, invoice, gateway, payments } = installation;
        gateway.answers.push(succeeded(invoice, 'pi_part', 20));
        await installation.collect(FIRST_RUN);
        // A share below nothing beside the one that paid, as a store could hand it over.
        const sharesOf = payments.sharesOf.bind(payments);
        payments.sharesOf = async (invoiceId, tx) => [
            ...(await sharesOf(invoiceId, tx)),
            { paymentId: 'payment-taken-back', recordedAt: FIRST_RUN, amount: -5 },
        ];

        const preview = await cancellation.preview(invoice.id, REQUEST, CANCELLED_AT);

        assert.deepEqual([preview.replacement.paidOnIssue, preview.movedIn], [20, 20]);
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

// @requirement SC-PRIC-095 — An issued invoice is never edited; its cancellation corrects what was not owed
// @requirement SC-PRIC-036 — What an invoice owes and how it is paid changes one step at a time
describe('a cancellation refused', () => {
    clockFrom(FIRST_RUN);

    const cancel = (installation, invoiceId, request = REQUEST) =>
        installation.cancellation.cancel(invoiceId, request, 'operator:anna', CANCELLED_AT);

    test('for an invoice that does not exist', async () => {
        const installation = await anInvoiceToCollect();

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

/** What the installation's journal holds of corrections: the charge each corrects, and by how much. */
const correctionsIn = ({ journal }) =>
    journal
        .filter((entry) => entry.origin === 'correction')
        .map((entry) => [entry.correction.chargeId, entry.correction.invoiceId, entry.amountNet]);

// @requirement SC-PRIC-095 — An issued invoice is never edited; its cancellation corrects what was not owed
describe('a cancellation that says what was not owed', () => {
    clockFrom(FIRST_RUN);

    const cancel = (installation, lines) =>
        installation.cancellation.cancel(
            installation.invoice.id,
            { ...REQUEST, lines },
            'operator:anna',
            CANCELLED_AT,
        );
    const [planLine, discountLine] = [1, 2];

    test('lowers a line owed in part, its discount in the same share, by counter-entries the replacement carries', async () => {
        const installation = await anInvoiceToCollect();
        const { invoice } = installation;
        const [plan, discount] = invoice.lines;

        const { replacement, counterEntries, lines } = await cancel(installation, [
            { position: planLine, owed: 24.5 },
        ]);

        assert.deepEqual(
            replacement.lines.map((line) => [
                line.position,
                line.origin,
                line.amountNet,
                line.correctedPosition,
                line.correctsPosition,
            ]),
            [
                [1, plan.origin, 49, 1, null],
                [2, 'correction', -24.5, null, 1],
                [3, discount.origin, -4.9, 2, null],
                [4, 'correction', 2.45, null, 3],
            ],
        );
        assert.deepEqual(
            [replacement.totalNet, replacement.totalTax, replacement.totalGross],
            [22.05, 4.19, 26.24],
        );
        assert.deepEqual(correctionsIn(installation), [
            [plan.chargeId, invoice.id, -24.5],
            [discount.chargeId, invoice.id, 2.45],
        ]);
        assert.deepEqual(
            replacement.lines
                .filter((line) => line.origin === 'correction')
                .map((line) => line.chargeId),
            counterEntries.map((entry) => entry.id),
        );
        assert.deepEqual(
            lines.map((line) => [line.position, line.standsAt, line.becomes]),
            [
                [1, 49, 24.5],
                [2, -4.9, -2.45],
            ],
        );
    });

    test('owed no more, leaves no replacement, its charges and their counter-entries on no invoice that stands', async () => {
        const installation = await anInvoiceToCollect();
        const { invoice } = installation;
        const [plan, discount] = invoice.lines;

        const cancelled = await cancel(installation, [{ position: planLine, owed: 0 }]);

        assert.equal(cancelled.replacement, null);
        assert.equal(cancelled.cancellation.replacementInvoiceId, null);
        assert.deepEqual(correctionsIn(installation), [
            [plan.chargeId, invoice.id, -49],
            [discount.chargeId, invoice.id, 4.9],
        ]);
        assert.deepEqual(installation.store.invoices.length, 2, 'a replacement was issued');
        assert.equal(invoiceCancellationAudit(cancelled).changes.replacementNumber, null);
    });

    test('owed no more and paid, credits everything that was paid', async () => {
        const installation = await anInvoiceToCollect();
        const { invoice } = installation;
        await installation.collect(FIRST_RUN);

        const { replacement, credits } = await cancel(installation, [
            { position: planLine, owed: 0 },
        ]);

        assert.equal(replacement, null);
        assert.deepEqual(
            credits.map((credit) => credit.amount),
            [invoice.totalGross],
        );
    });

    test('owed in part and paid, credits what the replacement no longer asks for', async () => {
        const installation = await anInvoiceToCollect();
        const { invoice } = installation;
        await installation.collect(FIRST_RUN);

        const { replacement, credits } = await cancel(installation, [
            { position: planLine, owed: 24.5 },
        ]);

        assert.deepEqual(
            [replacement.paidOnIssue, credits.map((credit) => credit.amount)],
            [26.24, [toCents(invoice.totalGross - 26.24) / 100]],
        );
    });

    test('is written as its preview showed it, held to the digest of that preview', async () => {
        const installation = await anInvoiceToCollect();
        const request = { ...REQUEST, lines: [{ position: planLine, owed: 24.5 }] };
        const preview = await installation.cancellation.preview(
            installation.invoice.id,
            request,
            after(CANCELLED_AT, { minutes: -5 }),
        );

        const cancelled = await installation.cancellation.cancel(
            installation.invoice.id,
            { ...request, previewDigest: preview.digest },
            'operator:anna',
            CANCELLED_AT,
        );

        assert.equal(cancelled.replacement.totalGross, preview.replacement.totalGross);
        assert.equal(preview.counterEntries.length, 2);
    });

    for (const [what, lines, code, params] of [
        [
            'names a line the invoice does not have',
            [{ position: 9, owed: 1 }],
            'SUBSCRIPTION_INVOICE_LINE_UNKNOWN',
            { position: 9 },
        ],
        [
            'names a line twice',
            [
                { position: planLine, owed: 1 },
                { position: planLine, owed: 2 },
            ],
            'SUBSCRIPTION_INVOICE_LINE_NAMED_TWICE',
            { position: planLine },
        ],
        [
            'names a discount, which follows what it reduced',
            [{ position: discountLine, owed: 0 }],
            'SUBSCRIPTION_INVOICE_LINE_NOT_CORRECTABLE',
            { position: discountLine },
        ],
        [
            'says all of a line is owed, which leaving it out says',
            [{ position: planLine, owed: 49 }],
            'SUBSCRIPTION_INVOICE_LINE_OWED_INVALID',
            { position: planLine, owed: 49, standsAt: 49 },
        ],
        [
            'says less than nothing is owed',
            [{ position: planLine, owed: -0.01 }],
            'SUBSCRIPTION_INVOICE_LINE_OWED_INVALID',
            { position: planLine, owed: -0.01, standsAt: 49 },
        ],
        [
            'says a part of a cent is owed',
            [{ position: planLine, owed: 0.005 }],
            'SUBSCRIPTION_INVOICE_LINE_OWED_INVALID',
            { position: planLine, owed: 0.005, standsAt: 49 },
        ],
        [
            'names a line by the text of its position',
            [{ position: String(planLine), owed: 1 }],
            'SUBSCRIPTION_INVOICE_LINE_UNKNOWN',
            { position: `"${planLine}"` },
        ],
        [
            'names a line by a position no line can have',
            [{ position: planLine + 0.5, owed: 1 }],
            'SUBSCRIPTION_INVOICE_LINE_UNKNOWN',
            { position: planLine + 0.5 },
        ],
        ...[
            [null, 'null'],
            ['', '""'],
            [false, 'false'],
            [true, 'true'],
            ['24.5', '"24.5"'],
        ].map(([owed, named]) => [
            `says ${named} is owed, which is no amount`,
            [{ position: planLine, owed }],
            'SUBSCRIPTION_INVOICE_LINE_OWED_INVALID',
            { position: planLine, owed: named, standsAt: 49 },
        ]),
        [
            'says nothing of what is owed',
            [{ position: planLine }],
            'SUBSCRIPTION_INVOICE_LINE_OWED_INVALID',
            { position: planLine, owed: 'undefined', standsAt: 49 },
        ],
    ]) {
        test(`is refused where it ${what}, and nothing is written`, async () => {
            const installation = await anInvoiceToCollect();
            const before = [heldBy(installation), installation.journal.length];

            const refused = await refusalOf(cancel(installation, lines));

            assert.deepEqual(refused, [422, INVOICE_ERROR_CODES[code]]);
            assert.deepEqual([heldBy(installation), installation.journal.length], before);
        });

        test(`names the line where it ${what}`, async () => {
            const installation = await anInvoiceToCollect();

            await assert.rejects(cancel(installation, lines), (error) => {
                const { params: given, message } = error.getResponse();
                return (
                    Object.entries(params).every(([key, value]) => given[key] === value) &&
                    !message.includes('{')
                );
            });
        });
    }

    test('lowers a held add-on price with its booking, read off its contract line, and leaves the plan’s discount', async () => {
        const installation = aCollectingInstallation();
        const subscriber = await installation.aSubscriber('t1', {
            invoiceEmail: 'billing@t1.example',
        });
        const held = {
            ...line('discount', 'HOLD', -2, 'Held price'),
            metadata: {
                generated: true,
                priceHold: {
                    subscriptionBundleId: 'booking-1',
                    bundleVersionId: 'bv-1',
                    until: '2027-01-01T00:00:00.000Z',
                    resolvedAmountNet: 2,
                },
            },
        };
        const contract = await installation.aContract(subscriber, {
            lineItems: [
                line('plan', 'STANDARD', 49),
                line('discount', 'WELCOME', -4.9),
                line('bundle', 'ARCHIVE', 10),
                held,
            ],
        });
        const heldLine = contract.lineItems.find((item) => item.sourceKey === 'HOLD');
        installation.charge(contract, 'plan');
        installation.charge(contract, 'discount');
        const addOn = installation.charge(contract, 'bundle', { sourceRef: 'booking-1' });
        const heldCharge = installation.charge(contract, 'discount', {
            contractLineItemId: heldLine.id,
            amountNet: -2,
        });
        const invoice = await installation.anInvoiceMailed(subscriber.id, ISSUED);
        const position = (charge) =>
            invoice.lines.find((each) => each.chargeId === charge.id).position;

        await installation.cancellation.cancel(
            invoice.id,
            { ...REQUEST, lines: [{ position: position(addOn), owed: 0 }] },
            'operator:anna',
            CANCELLED_AT,
        );

        assert.deepEqual(correctionsIn(installation), [
            [addOn.id, invoice.id, -10],
            [heldCharge.id, invoice.id, 2],
        ]);
    });

    test('owed for a cent less than all of it, is written', async () => {
        const installation = await anInvoiceToCollect();

        const { counterEntries } = await cancel(installation, [
            { position: planLine, owed: 48.99 },
        ]);

        assert.equal(counterEntries[0].amountNet, -0.01);
    });

    test('is refused where what is left asks for less than nothing, and nothing is written', async () => {
        const installation = await anInvoiceToCollect();
        const { invoice } = installation;
        // A credit of an earlier period beside the plan, which stays.
        invoice.lines.push({
            ...invoice.lines[0],
            id: 'line-credit',
            position: 3,
            chargeId: 'charge-credit',
            origin: 'credit',
            amountNet: -30,
        });
        installation.journal.push({
            ...installation.journal.find((entry) => entry.id === invoice.lines[0].chargeId),
            id: 'charge-credit',
            origin: 'credit',
            sourceRef: 'credit-1',
            amountNet: -30,
        });
        const before = [heldBy(installation), installation.journal.length];

        const refused = await refusalOf(cancel(installation, [{ position: planLine, owed: 5 }]));

        assert.deepEqual(refused, [
            422,
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CORRECTION_LEAVES_A_CREDIT,
        ]);
        assert.deepEqual([heldBy(installation), installation.journal.length], before);
    });
});

// @requirement SC-PRIC-094 — Every invoice reaches the subscriber by email, with its file attached
describe('the documents of a cancellation', () => {
    clockFrom(FIRST_RUN);

    /** Cancels the installation's invoice with `request`, then archives and mails what is due. */
    async function cancelledAndMailed(installation, request) {
        const cancelled = await installation.cancellation.cancel(
            installation.invoice.id,
            request,
            'operator:anna',
            CANCELLED_AT,
        );
        await installation.documents.archiveDue(after(CANCELLED_AT, { minutes: 15 }));
        await installation.documents.deliverDue();
        return cancelled;
    }

    /** Where each invoice of the cancellation was sent, by number. */
    const sentOf = ({ mail }, cancelled) =>
        [cancelled.cancellationInvoice, cancelled.replacement].map((invoice) => [
            invoice.number,
            mail.sent.find((each) => each.invoice.id === invoice.id)?.to ?? null,
        ]);

    test('go to the address given with the cancellation, and the record keeps its own', async () => {
        const installation = await anInvoiceToCollect();
        const { subscriber, subscribers } = installation;
        const recorded = (await subscribers.getById(subscriber.id)).invoiceEmail;

        const cancelled = await cancelledAndMailed(installation, {
            ...REQUEST,
            deliverTo: 'accounts@t1.example',
        });

        assert.deepEqual(sentOf(installation, cancelled), [
            [cancelled.cancellationInvoice.number, 'accounts@t1.example'],
            [cancelled.replacement.number, 'accounts@t1.example'],
        ]);
        assert.equal((await subscribers.getById(subscriber.id)).invoiceEmail, recorded);
    });

    test('go to the invoice email on the record where no address was given', async () => {
        const installation = await anInvoiceToCollect();
        const recorded = (await installation.subscribers.getById(installation.subscriber.id))
            .invoiceEmail;

        const cancelled = await cancelledAndMailed(installation, REQUEST);

        assert.deepEqual(sentOf(installation, cancelled), [
            [cancelled.cancellationInvoice.number, recorded],
            [cancelled.replacement.number, recorded],
        ]);
    });

    test('of a replacement cancelled in turn before it was sent go where each cancellation said', async () => {
        const installation = await anInvoiceToCollect();
        const { cancellation, invoice, documents, mail } = installation;
        const first = await cancellation.cancel(
            invoice.id,
            { ...REQUEST, deliverTo: 'first@t1.example' },
            'operator:anna',
            CANCELLED_AT,
        );
        // Archived, so that it can be cancelled, and not sent yet.
        await documents.archiveDue(after(CANCELLED_AT, { minutes: 15 }));
        const second = await cancellation.cancel(
            first.replacement.id,
            { ...REQUEST, deliverTo: 'second@t1.example' },
            'operator:anna',
            after(CANCELLED_AT, { minutes: 20 }),
        );

        await documents.archiveDue(after(CANCELLED_AT, { minutes: 30 }));
        await documents.deliverDue();

        const sentTo = (id) => mail.sent.find((each) => each.invoice.id === id)?.to ?? null;
        assert.deepEqual(
            [
                sentTo(first.cancellationInvoice.id),
                sentTo(first.replacement.id),
                sentTo(second.cancellationInvoice.id),
                sentTo(second.replacement.id),
            ],
            ['first@t1.example', 'first@t1.example', 'second@t1.example', 'second@t1.example'],
        );
    });

    test('send the replacement’s notices where they sent the replacement, the record’s email beside it', async () => {
        quietLog();
        const installation = await anInvoiceToCollect();
        const { invoice, collections, mail, subscriber, subscribers } = installation;
        await installation.collect(FIRST_RUN);
        const [attempt] = collections.attempts;
        assert.ok(
            (await subscribers.getById(subscriber.id)).invoiceEmail,
            'the premise: the record holds an invoice email',
        );

        const cancelled = await cancelledAndMailed(installation, {
            ...REQUEST,
            deliverTo: 'accounts@t1.example',
        });
        await delivering(installation)(
            reversalReported('evt_r1', attempt.attemptKey, {
                reversalRef: 'du_1',
                paymentRef: 'pi_1',
                withdrawnCents: toCents(invoice.totalGross),
            }),
        );
        await runAt(installation, after(CANCELLED_AT, { days: 1 }));

        const told = mail.told.filter((each) => each.notice.kind === 'collection-reversed');
        assert.deepEqual(
            told.map((each) => [each.notice.invoiceNumber, each.to]),
            [[cancelled.replacement.number, 'accounts@t1.example']],
        );
    });

    test('reach a subscriber whose record holds no invoice email, the replacement’s notices too', async () => {
        quietLog();
        const installation = await anInvoiceToCollect();
        const { invoice, collections, mail, subscriber, subscribers } = installation;
        await installation.collect(FIRST_RUN);
        const [attempt] = collections.attempts;
        await subscribers.changeContact(subscriber.id, { invoiceEmail: null }, 'operator:anna');

        const cancelled = await cancelledAndMailed(installation, {
            ...REQUEST,
            deliverTo: 'accounts@t1.example',
        });
        await delivering(installation)(
            reversalReported('evt_r1', attempt.attemptKey, {
                reversalRef: 'du_1',
                paymentRef: 'pi_1',
                withdrawnCents: toCents(invoice.totalGross),
            }),
        );
        await runAt(installation, after(CANCELLED_AT, { days: 1 }));

        assert.deepEqual(sentOf(installation, cancelled), [
            [cancelled.cancellationInvoice.number, 'accounts@t1.example'],
            [cancelled.replacement.number, 'accounts@t1.example'],
        ]);
        const told = mail.told.filter((each) => each.notice.kind === 'collection-reversed');
        assert.deepEqual(
            told.map((each) => [each.notice.invoiceNumber, each.to]),
            [[cancelled.replacement.number, 'accounts@t1.example']],
        );
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

    test('a reversal is told only once no attempt of any invoice of the chain is on its way, about the invoice that stands', async () => {
        quietLog();
        const installation = await anInvoiceToCollect();
        const { cancellation, invoice, gateway, collections, mail } = installation;
        // pi_1 pays 20 of it; the rest stands on each replacement in turn.
        gateway.answers.push(succeeded(invoice, 'pi_1', 20));
        await installation.collect(FIRST_RUN);
        const [paid] = collections.attempts;
        const first = await cancellation.cancel(invoice.id, REQUEST, 'operator:anna', CANCELLED_AT);
        mailed(installation, first.replacement.id);
        gateway.answers.push({ status: 'pending', paymentRef: 'pi_r1' });
        await runAt(installation, after(CANCELLED_AT, { minutes: 15 }));
        const onItsWay = collections.attempts.find(
            (each) => each.invoiceId === first.replacement.id,
        );
        assert.equal(
            onItsWay?.status,
            'PENDING',
            'the premise: the first replacement is collected',
        );
        const second = await cancellation.cancel(
            first.replacement.id,
            REQUEST,
            'operator:anna',
            after(CANCELLED_AT, { days: 1 }),
        );

        await delivering(installation)(
            reversalReported('evt_r1', paid.attemptKey, {
                reversalRef: 'du_1',
                paymentRef: 'pi_1',
                withdrawnCents: 2000,
            }),
        );
        await runAt(installation, after(CANCELLED_AT, { days: 2 }));
        const toldOfTheReversal = () =>
            mail.told.filter((each) => each.notice.kind === 'collection-reversed');
        assert.deepEqual(
            toldOfTheReversal(),
            [],
            'told while an attempt of the chain could still pay the invoice that stands',
        );

        await delivering(installation)(
            collectionReported('evt_f1', onItsWay.attemptKey, {
                status: 'failed',
                paymentRef: 'pi_r1',
                reason: 'insufficient-funds',
                gatewayCode: 'insufficient_funds',
            }),
        );
        await runAt(installation, after(CANCELLED_AT, { days: 2, minutes: 15 }));

        const told = toldOfTheReversal();
        assert.equal(told.length, 1);
        assert.equal(told[0].notice.invoiceNumber, second.replacement.number);
    });

    test('a reversal of a payment that moved tells the subscriber the replacement is open again', async () => {
        quietLog();
        const installation = await anInvoiceToCollect();
        const { cancellation, invoice, collections, mail } = installation;
        await installation.collect(FIRST_RUN);
        const [attempt] = collections.attempts;
        const { replacement } = await cancellation.cancel(
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

    test('a reversal is followed up in its chain’s turn: read, told and marked on the transaction that holds the chain', async () => {
        quietLog();
        const installation = await anInvoiceToCollect();
        const { cancellation, invoice, collections, notices, store } = installation;
        await installation.collect(FIRST_RUN);
        const [attempt] = collections.attempts;
        const { replacement } = await cancellation.cancel(
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
        // The transactions the chain was held on, and those the follow-up read,
        // told and marked on.
        const holding = new Set();
        const holdChain = store.holdChain.bind(store);
        store.holdChain = async (invoiceId, tx) => {
            holding.add(tx);
            return holdChain(invoiceId, tx);
        };
        const readOn = [];
        const listByInvoice = collections.listByInvoice.bind(collections);
        collections.listByInvoice = async (invoiceId, tx) => {
            if (invoiceId === replacement.id) readOn.push(tx);
            return listByInvoice(invoiceId, tx);
        };
        const markedOn = [];
        const markFollowedUp = collections.markFollowedUp.bind(collections);
        collections.markFollowedUp = async (id, at, tx) => {
            if (id === attempt.id) markedOn.push(tx);
            return markFollowedUp(id, at, tx);
        };
        const toldOn = [];
        const record = notices.record.bind(notices);
        notices.record = async (recorded, now, tx) => {
            if (recorded.some((each) => each.kind === 'collection-reversed')) toldOn.push(tx);
            return record(recorded, now, tx);
        };

        await runAt(installation, after(CANCELLED_AT, { days: 1 }));

        assert.equal(toldOn.length, 1, 'the premise: the subscriber is told of the reversal');
        const [turn] = toldOn;
        assert.ok(holding.has(turn), 'told on a transaction that does not hold the chain');
        assert.ok(readOn.includes(turn), 'the replacement’s attempts read outside the turn');
        assert.deepEqual(markedOn, [turn]);
    });
});
