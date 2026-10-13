// The invoice mapping both adapters share.
//
// An invoice is a document kept for years and read by releases that did not
// write it. Three things are pinned: a row reads back the same whichever
// adapter's shape it comes in — a Prisma row carries `Date`s and `Decimal`s, a
// Drizzle row text — a row of the wrong shape fails loudly rather than reaching
// an invoice as a blank or a zero, and an amount goes out as the two-place
// decimal it was rounded to, never rounded a second time on the way.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    subscriptionInvoiceColumns,
    subscriptionInvoiceLineColumns,
    toSubscriptionInvoiceRecord,
    utcMidnightOf,
} from '../dist/index.js';

const ISSUED_AT = new Date('2026-02-01T05:15:00.000Z');

const PARTY = {
    legalName: 'Müller & Söhne GmbH',
    vatId: null,
    taxNumber: '12/345/67890',
    addressLine1: 'Am Ufer 3',
    addressLine2: null,
    postalCode: '20095',
    city: 'Hamburg',
    country: 'DE',
};

/** An invoice as the run drafts it. */
const INVOICE = {
    numberPrefix: 'AHP',
    numberYear: 2026,
    tenantId: 'tenant-1',
    subscriberId: 'subscriber-1',
    subscriptionId: 'sub-1',
    contractId: 'contract-1',
    issuedAt: ISSUED_AT,
    issueDate: '2026-02-01',
    dueDate: '2026-02-15',
    servicePeriodFrom: '2026-02-01',
    servicePeriodUntil: '2026-02-28',
    payment: null,
    collectionDate: null,
    currency: 'EUR',
    issuer: { ...PARTY, legalName: 'Issuer GmbH', vatId: 'DE123456789' },
    subscriber: { ...PARTY, customerNumber: 'K-10001' },
    footer: ['Amtsgericht München HRB 123456 · Geschäftsführer: Erika Muster'],
    taxTreatment: {
        kind: 'standard',
        rate: 19,
        note: null,
        adapter: { name: '@saasicat/tax-de', version: '1.0.0' },
    },
    taxes: [{ rate: 19, net: 45.1, tax: 8.57 }],
    totalNet: 45.1,
    totalTax: 8.57,
    totalGross: 53.67,
    lines: [
        {
            position: 1,
            chargeId: 'charge-1',
            contractLineItemId: 'line-plan',
            title: 'Standard',
            origin: 'renewal',
            source: 'plan',
            periodFrom: '2026-02-01',
            periodUntil: '2026-02-28',
            amountNet: 49,
            taxRate: 19,
        },
        {
            position: 2,
            chargeId: 'charge-2',
            contractLineItemId: 'line-discount',
            title: 'Welcome discount',
            origin: 'renewal',
            source: 'discount',
            periodFrom: '2026-02-01',
            periodUntil: '2026-02-28',
            amountNet: -3.9,
            taxRate: 19,
        },
    ],
};

/** A card, as an invoice collected by it records it. */
const CARD = {
    paymentMethodId: 'payment-method-1',
    gatewayAccount: 'stripe-main',
    type: 'card',
    brand: 'visa',
    last4: '4242',
    mandateReference: null,
};

/** A direct debit, as an invoice collected by it records it. */
const DEBIT = {
    paymentMethodId: 'payment-method-2',
    gatewayAccount: 'stripe-main',
    type: 'sepa_debit',
    brand: null,
    last4: '3000',
    mandateReference: 'MANDAT-0001',
};

/** The invoice collected by direct debit, on the day it announces and falls due on. */
const BY_DEBIT = { ...INVOICE, payment: DEBIT, collectionDate: '2026-02-15' };

/** A Prisma `Decimal`: an object that is read through its text. */
const decimal = (text) => ({ toString: () => text });

/** The invoice as Drizzle writes and reads it: the columns as they are, days and amounts as text. */
function drizzleRows(invoice = INVOICE) {
    const columns = subscriptionInvoiceColumns(invoice, {
        number: 'AHP-2026-000001',
        numberSequence: 1,
    });
    const row = { id: 'invoice-1', ...columns, createdAt: ISSUED_AT };
    const lines = invoice.lines.map((line, index) => ({
        id: `line-${index + 1}`,
        ...subscriptionInvoiceLineColumns(line, 'invoice-1'),
    }));
    return { row, lines };
}

/** The same invoice as Prisma reads it: days as `Date`s at midnight UTC, amounts as `Decimal`s. */
function prismaRows(invoice = INVOICE) {
    const { row, lines } = drizzleRows(invoice);
    return {
        row: {
            ...row,
            issueDate: utcMidnightOf(row.issueDate),
            dueDate: utcMidnightOf(row.dueDate),
            servicePeriodFrom: utcMidnightOf(row.servicePeriodFrom),
            servicePeriodUntil: utcMidnightOf(row.servicePeriodUntil),
            collectionDate: row.collectionDate === null ? null : utcMidnightOf(row.collectionDate),
            totalNet: decimal(row.totalNet),
            totalTax: decimal(row.totalTax),
            totalGross: decimal(row.totalGross),
        },
        lines: lines.map((line) => ({
            ...line,
            periodFrom: utcMidnightOf(line.periodFrom),
            periodUntil: utcMidnightOf(line.periodUntil),
            amountNet: decimal(line.amountNet),
            taxRate: decimal(line.taxRate),
        })),
    };
}

function withoutStoreFields(record) {
    const {
        id: _id,
        number: _number,
        numberSequence: _numberSequence,
        createdAt: _createdAt,
        lines,
        ...rest
    } = record;
    return {
        ...rest,
        lines: lines.map(({ id: _lineId, invoiceId: _invoiceId, ...line }) => line),
    };
}

describe('an invoice row becomes a record', () => {
    test('that says what the invoice drafted said, from either adapter’s row', () => {
        for (const { row, lines } of [drizzleRows(), prismaRows()]) {
            const record = toSubscriptionInvoiceRecord(row, lines);

            assert.deepEqual(withoutStoreFields(record), INVOICE);
            assert.deepEqual(
                [record.id, record.number, record.numberSequence],
                ['invoice-1', 'AHP-2026-000001', 1],
            );
            assert.ok(record.lines.every((line) => line.invoiceId === 'invoice-1'));
        }
    });

    // @requirement SC-PRIC-028 — A direct debit is announced before it is collected
    test('that says how the invoice is paid, from either adapter’s row', () => {
        for (const invoice of [BY_DEBIT, { ...INVOICE, payment: CARD }]) {
            for (const { row, lines } of [drizzleRows(invoice), prismaRows(invoice)]) {
                const record = toSubscriptionInvoiceRecord(row, lines);

                assert.deepEqual(
                    [record.payment, record.collectionDate],
                    [invoice.payment, invoice.collectionDate],
                );
            }
        }
    });

    test('with its lines in their order, whatever order they were read in', () => {
        const { row, lines } = drizzleRows();

        const record = toSubscriptionInvoiceRecord(row, [...lines].reverse());

        assert.deepEqual(
            record.lines.map((line) => line.position),
            [1, 2],
        );
    });

    const broken = [
        [
            'a day that is not one',
            { issueDate: '2026-02-30T00' },
            /issueDate of invoice-1 is not a day/,
        ],
        [
            'an amount that is not one',
            { totalNet: 'n/a' },
            /totalNet of invoice-1 is not an amount/,
        ],
        [
            'an amount that is missing',
            { totalGross: null },
            /totalGross of invoice-1 is not an amount/,
        ],
        [
            'a party that is not one',
            { issuerParty: 'Issuer GmbH' },
            /issuerParty of invoice-1 is not a party/,
        ],
        [
            'a party without a legal name',
            { issuerParty: { ...PARTY, legalName: null } },
            /issuerParty of invoice-1 names no legal name/,
        ],
        [
            'a subscriber without a customer number',
            { subscriberParty: { ...PARTY } },
            /subscriberParty of invoice-1 names no customer number/,
        ],
        [
            'a party field that is not text',
            { subscriberParty: { ...PARTY, customerNumber: 'K-1', city: 42 } },
            /subscriberParty.city of invoice-1 is not text/,
        ],
        [
            'a footer that is not a list',
            { footer: 'Amtsgericht München' },
            /footer of invoice-1 is not a list of lines/,
        ],
        [
            'a footer line that is not text',
            { footer: ['Amtsgericht München', 42] },
            /footer of invoice-1 is not a list of lines/,
        ],
        [
            'a treatment that is not one',
            { taxTreatment: { kind: 'magic' } },
            /taxTreatment of invoice-1 is not a tax treatment/,
        ],
        [
            'taxes that are not a list',
            { taxes: { rate: 19 } },
            /taxes of invoice-1 is not a list of rates/,
        ],
        [
            'a rate without its tax',
            { taxes: [{ rate: 19, net: 1 }] },
            /taxes of invoice-1 is not an amount/,
        ],
        [
            'a payment that is not a payment method',
            { payment: 'card' },
            /payment of invoice-1 is not a payment method/,
        ],
        [
            'a payment of a type nothing collects',
            { payment: { ...CARD, type: 'cash' } },
            /holds payment.type 'cash'/,
        ],
        [
            'a payment without the last four digits it tells apart by',
            { payment: { ...CARD, last4: null } },
            /payment of invoice-1 names no last4/,
        ],
        [
            'a direct debit without the mandate reference it announced',
            { payment: { ...DEBIT, mandateReference: null }, collectionDate: '2026-02-15' },
            /payment of invoice-1 names no mandateReference/,
        ],
        [
            'a direct debit without the day it is collected',
            { payment: DEBIT, collectionDate: null },
            /collectionDate of invoice-1 is not a day/,
        ],
        [
            'a card with a collection date',
            { payment: CARD, collectionDate: '2026-02-15' },
            /collectionDate of invoice-1 is set on an invoice paid by card/,
        ],
        [
            'a collection date on an invoice that is not collected',
            { payment: null, collectionDate: '2026-02-15' },
            /collectionDate of invoice-1 is set on an invoice that is not collected/,
        ],
        [
            'a row read without its payment',
            { payment: undefined },
            /invoice-1 was read without its payment or its collection date/,
        ],
        [
            'a row read without its collection date',
            { collectionDate: undefined },
            /invoice-1 was read without its payment or its collection date/,
        ],
    ];
    for (const [what, overrides, message] of broken) {
        test(`refuses ${what}`, () => {
            const { row, lines } = drizzleRows();
            assert.throws(
                () => toSubscriptionInvoiceRecord({ ...row, ...overrides }, lines),
                message,
            );
        });
    }

    test('refuses a line whose origin or source is not one the journal writes', () => {
        const { row, lines } = drizzleRows();
        for (const overrides of [{ origin: 'gift' }, { source: 'tip' }]) {
            assert.throws(() =>
                toSubscriptionInvoiceRecord(row, [{ ...lines[0], ...overrides }, lines[1]]),
            );
        }
    });
});

describe('an invoice is written', () => {
    test('with its amounts as the two-place decimals they were rounded to', () => {
        const { row, lines } = drizzleRows();

        assert.deepEqual([row.totalNet, row.totalTax, row.totalGross], ['45.10', '8.57', '53.67']);
        assert.deepEqual(
            lines.map((line) => [line.amountNet, line.taxRate]),
            [
                ['49.00', '19.00'],
                ['-3.90', '19.00'],
            ],
        );
    });

    test('and refuses an amount that is not a whole number of cents, rather than rounding it again', () => {
        assert.throws(
            () => drizzleRows({ ...INVOICE, totalTax: 8.565 }),
            /totalTax of 8.565 is not a whole number of cents/,
        );
        assert.throws(
            () => drizzleRows({ ...INVOICE, lines: [{ ...INVOICE.lines[0], amountNet: 0.001 }] }),
            /amountNet of 0.001 is not a whole number of cents/,
        );
    });

    test('with the payment method it is collected with as a copy, which a later change leaves alone', () => {
        const payment = { ...DEBIT };
        const { row } = drizzleRows({ ...BY_DEBIT, payment });

        payment.mandateReference = 'CHANGED';

        assert.deepEqual([row.payment, row.collectionDate], [DEBIT, '2026-02-15']);
    });

    test('with its days as the days they are, and as midnight UTC where the column takes a date', () => {
        const { row } = drizzleRows();

        assert.equal(row.issueDate, '2026-02-01');
        assert.equal(utcMidnightOf('2026-12-31').toISOString(), '2026-12-31T00:00:00.000Z');
    });
});
