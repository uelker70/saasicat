// Whether an invoice was issued in a test operation: the run reads the
// installation's mark and records on each invoice what it says, so the
// invoice says it for good, whatever the mark says later. A cancellation and
// its replacement correct the invoice they cancel and take its operation, not
// the one the mark says on the day the operator corrects it.
//
// Through `SubscriptionInvoiceService.issueDue` and
// `InvoiceCancellationService.cancel`, over an installation in memory whose
// mark is kept as the persistence contract holds both adapters to keep it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { INVOICE_ERROR_CODES } from '@saasicat/core';

import { SubscriptionInvoiceService } from '../dist/billing/index.js';
import { changeTo, marked } from './helpers/installation-marks.js';
import {
    FIRST_RUN,
    anInvoiceToCollect,
    clockFrom,
    quietLog,
} from './helpers/invoice-collection.js';
import {
    INVOICING_SETTINGS,
    anInvoicingInstallation,
    berlin,
    invoicingAdapter,
} from './helpers/invoice-run.js';

/** 10:00 in Berlin on 20 March, when the operator cancels the invoice of February. */
const CANCELLED_AT = new Date('2026-03-20T09:00:00.000Z');

/** When the archiving run reads the clock. */
const ARCHIVED_AT = new Date('2026-02-01T05:30:00.000Z');

/**
 * The invoice of February, issued to one subscriber of an installation marked
 * by `marks`, with its contract; `options` as `anInvoicingInstallation` takes them.
 */
async function issuedUnder(marks, options = {}) {
    const installation = anInvoicingInstallation({ ...options, marks });
    const subscriber = await installation.aSubscriber('t1');
    const contract = await installation.aContract(subscriber);
    installation.charge(contract, 'plan');
    assert.deepEqual(await installation.run(), { issued: 1, held: 0, failed: 0 });
    return { ...installation, contract };
}

describe('an invoice the run issues records the operation of the installation', () => {
    for (const [mark, testOperation] of [
        ['a test operation', true],
        ['a live operation', false],
        ['nobody', null],
    ]) {
        test(`marked as ${mark}: ${testOperation === true ? 'a test' : 'live'}`, async () => {
            const { store } = await issuedUnder(await marked(testOperation));

            assert.equal(store.invoices[0].testOperation, testOperation === true);
        });
    }

    test('as the mark said when it was issued, whatever the mark says by the next run', async () => {
        const marks = await marked(true);
        const installation = await issuedUnder(marks);
        await changeTo(marks, false);
        installation.charge(installation.contract, 'plan', {
            origin: 'planChange',
            periodStart: berlin('2026-02-14'),
            amountNet: 12.5,
        });

        assert.deepEqual(await installation.run(), { issued: 1, held: 0, failed: 0 });

        const [first, second] = await Promise.all(
            installation.store.invoices.map((each) => installation.store.findById(each.id)),
        );
        assert.deepEqual([first.testOperation, second.testOperation], [true, false]);
    });

    test('is refused a start where the mark cannot be read', () => {
        const service = new SubscriptionInvoiceService(
            null,
            null,
            null,
            null,
            INVOICING_SETTINGS,
            {},
            null,
            null,
            null,
            null,
        );

        assert.throws(
            () => service.onModuleInit(),
            (error) =>
                error.message.includes('whether they are issued in a test operation') &&
                error.message.includes('InstallationMarkPort'),
        );
    });
});

describe('a cancellation and its replacement take the operation of the invoice they correct', () => {
    clockFrom(FIRST_RUN);

    for (const [issuedIn, changedTo] of [
        [true, false],
        [false, true],
    ]) {
        test(`issued ${issuedIn ? 'as a test' : 'live'}, cancelled after the mark changed`, async () => {
            const marks = await marked(issuedIn);
            const { cancellation, invoice } = await anInvoiceToCollect('card', { marks });
            assert.equal(invoice.testOperation, issuedIn);
            await changeTo(marks, changedTo);

            const { cancellationInvoice, replacement } = await cancellation.cancel(
                invoice.id,
                { reason: 'The billing address was wrong.' },
                'operator:anna',
                CANCELLED_AT,
            );

            assert.deepEqual(
                [cancellationInvoice.testOperation, replacement.testOperation],
                [issuedIn, issuedIn],
            );
        });
    }
});

// @requirement SC-AUD-024 — Every document issued in a test operation says it is one
describe('the file of an invoice, checked by the tax adapter', () => {
    /**
     * An adapter refusing the file of every invoice issued in a test operation,
     * as `@saasicat/tax-de` refuses one whose XML does not state the notice:
     * the file of a renderer that does not mark it.
     */
    const unmarkedFileRefused = () =>
        invoicingAdapter({
            documentGaps: (document, invoice) =>
                invoice.testOperation ? ['xml.testOperation'] : [],
        });

    test('of one issued in a test operation reaches the check as one, and is held where the adapter refuses it', async () => {
        quietLog();
        const { documents, audits, store } = await issuedUnder(await marked(true), {
            adapter: unmarkedFileRefused(),
        });

        assert.deepEqual(await documents.archiveDue(ARCHIVED_AT), {
            archived: 0,
            held: 1,
            failed: 0,
        });
        const held = audits.filter(
            (entry) => entry.action === 'SUBSCRIPTION_INVOICE_DOCUMENT_HELD',
        );
        assert.deepEqual(
            held.map((entry) => [entry.entityId, entry.changes.code, entry.changes.params]),
            [
                [
                    store.invoices[0].id,
                    INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_REFUSED,
                    { adapter: 'test-tax', missing: ['xml.testOperation'] },
                ],
            ],
        );
    });

    test('of one issued live reaches the check as live, and is archived', async () => {
        const { documents } = await issuedUnder(await marked(false), {
            adapter: unmarkedFileRefused(),
        });

        assert.deepEqual(await documents.archiveDue(ARCHIVED_AT), {
            archived: 1,
            held: 0,
            failed: 0,
        });
    });
});
