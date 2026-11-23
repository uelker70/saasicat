// Whether an invoice was issued in a test operation is decided once, when it is
// issued, and recorded on the invoice: every later rendering reads the record,
// never the installation's mark as it stands then. A cancellation and its
// replacement correct the invoice they cancel, so they take its operation, not
// the one the installation has on the day of the correction.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    documentOperationsOf,
    draftCancellationInvoice,
    draftReplacementInvoice,
    draftSubscriptionInvoice,
    subscriptionInvoiceColumns,
    taxPerRate,
    toSubscriptionInvoiceRecord,
} from '../dist/index.js';

const ZONE = 'Europe/Berlin';
const ISSUED_AT = new Date('2026-02-01T05:15:00.000Z');

const PARTY = {
    legalName: 'Customer GmbH',
    vatId: null,
    taxNumber: null,
    addressLine1: 'Main Street 1',
    addressLine2: null,
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
};

const TREATMENT = {
    kind: 'standard',
    rate: 19,
    note: null,
    adapter: { name: '@saasicat/tax-de', version: '1.0.0' },
};

const CHARGE = {
    id: 'charge-1',
    subscriberId: 'subscriber-1',
    tenantId: 'tenant-1',
    subscriptionId: 'sub-1',
    contractId: 'contract-1',
    contractLineItemId: 'line-plan',
    origin: 'renewal',
    source: 'plan',
    sourceRef: 'sub-1',
    periodStart: new Date('2026-02-01T00:00:00.000+01:00'),
    periodEnd: new Date('2026-03-01T00:00:00.000+01:00'),
    currency: 'EUR',
    amountNet: 49,
    bookedAt: new Date('2026-02-01T00:00:00.000+01:00'),
    createdAt: new Date('2026-02-01T00:00:00.000+01:00'),
};

/** The invoice of `CHARGE`, drafted in an installation whose mark says `testOperation`. */
const drafted = (testOperation) =>
    draftSubscriptionInvoice({
        group: { contractId: 'contract-1', bookedAt: CHARGE.bookedAt, charges: [CHARGE] },
        contractLines: [{ id: 'line-plan', titleSnapshot: 'Standard, monthly' }],
        tenantId: 'tenant-1',
        subscriberId: 'subscriber-1',
        subscriber: { ...PARTY, customerNumber: 'K-10001' },
        issuer: { ...PARTY, legalName: 'Issuer GmbH', vatId: 'DE123456789' },
        footer: [],
        testOperation,
        treatment: TREATMENT,
        tax: taxPerRate,
        issuedAt: ISSUED_AT,
        timeZone: ZONE,
        numberPrefix: 'AHP',
        paymentTermDays: 14,
        payment: null,
        directDebitLeadDays: 14,
    });

/** `invoice` as a store writes it and reads it back, the first of its chain. */
function issued(invoice) {
    const columns = subscriptionInvoiceColumns(invoice, {
        id: 'invoice-1',
        number: 'AHP-2026-000001',
        numberSequence: 1,
        chainId: 'invoice-1',
        chainStep: 0,
    });
    return toSubscriptionInvoiceRecord(
        { ...columns, createdAt: ISSUED_AT },
        invoice.lines.map((line, index) => ({
            id: `line-${index + 1}`,
            invoiceId: 'invoice-1',
            chainStep: 0,
            correctedPosition: null,
            correctsPosition: null,
            ...line,
            amountNet: String(line.amountNet),
            taxRate: String(line.taxRate),
        })),
    );
}

const ISSUE = {
    issuedAt: new Date('2026-03-10T08:00:00.000Z'),
    timeZone: ZONE,
    numberPrefix: 'AHP',
};

/** How a replacement is issued: nothing in it says how the installation operates today. */
const replacementIssue = (cancelled) => ({
    ...ISSUE,
    subscriber: cancelled.subscriber,
    issuer: cancelled.issuer,
    footer: [],
    treatment: TREATMENT,
    tax: taxPerRate,
    paymentTermDays: 14,
    directDebitLeadDays: 5,
    payment: null,
    paid: 0,
});

describe('the operation an invoice is issued in', () => {
    test('is the one the installation is in when the invoice is drafted', () => {
        assert.equal(drafted(true).testOperation, true);
        assert.equal(drafted(false).testOperation, false);
    });

    test('is written and read back with the invoice', () => {
        assert.equal(issued(drafted(true)).testOperation, true);
        assert.equal(issued(drafted(false)).testOperation, false);
    });

    for (const testOperation of [true, false]) {
        test(`is the cancelled invoice's on its cancellation and its replacement (${testOperation ? 'test' : 'live'})`, () => {
            const cancelled = issued(drafted(testOperation));

            const cancellation = draftCancellationInvoice(cancelled, ISSUE);
            const replacement = draftReplacementInvoice(cancelled, replacementIssue(cancelled));

            assert.deepEqual(
                [cancellation.testOperation, replacement.testOperation],
                [testOperation, testOperation],
            );
        });
    }
});

describe('the operations the issued documents were issued in', () => {
    test('are none where nothing was issued', () => {
        assert.deepEqual(documentOperationsOf([]), { test: false, live: false });
    });

    test('are the test operation alone where only test documents were issued', () => {
        assert.deepEqual(documentOperationsOf([true]), { test: true, live: false });
    });

    test('are the live operation alone where only live documents were issued', () => {
        assert.deepEqual(documentOperationsOf([false]), { test: false, live: true });
    });

    test('are both where documents of both were issued', () => {
        assert.deepEqual(documentOperationsOf([false, true]), { test: true, live: true });
    });
});
