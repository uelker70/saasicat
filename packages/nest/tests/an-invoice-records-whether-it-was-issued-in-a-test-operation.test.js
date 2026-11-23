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

import { SubscriptionInvoiceService } from '../dist/billing/index.js';
import { FakeInstallationMarkRepository } from '../dist/testing/index.js';
import { FIRST_RUN, anInvoiceToCollect, clockFrom } from './helpers/invoice-collection.js';
import { INVOICING_SETTINGS, anInvoicingInstallation, berlin } from './helpers/invoice-run.js';

const MARKED_AT = new Date('2026-01-15T09:00:00.000Z');

/** 10:00 in Berlin on 20 March, when the operator cancels the invoice of February. */
const CANCELLED_AT = new Date('2026-03-20T09:00:00.000Z');

/** Where the mark is kept, marked as `INT` in a test operation or a live one; unmarked with `null`. */
async function marked(testOperation) {
    const marks = new FakeInstallationMarkRepository();
    if (testOperation !== null) {
        await marks.markIfUnmarked({
            identifier: 'INT',
            testOperation,
            markedAt: MARKED_AT,
            markedBy: 'cli:ops@example.com:host',
        });
    }
    return marks;
}

/** Changes the operation the mark says, as `installation mark --replace` writes it. */
async function changeTo(marks, testOperation) {
    const current = await marks.find();
    const changed = await marks.replace(current, { ...current, testOperation });
    assert.ok(changed, 'the mark was not changed');
}

/** The invoice of February, issued to one subscriber of an installation marked by `marks`, with its contract. */
async function issuedUnder(marks) {
    const installation = anInvoicingInstallation({ marks });
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
