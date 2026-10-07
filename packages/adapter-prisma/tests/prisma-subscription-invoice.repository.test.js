// `PrismaSubscriptionInvoiceRepository` — what it asks the client for.
//
// The database semantics — numbers one after the other without a gap however
// many invoices are issued at once, a charge on one invoice, nothing kept of an
// invoice that is refused — are the contract's, and run against PostgreSQL in
// tests/integration/. What this holds is the translation: that the number is
// drawn by raising the year's row and written in the same transaction as the
// invoice, that the days reach their `date` columns as midnight UTC, that the
// lines leave a charge taken already to the unique key and a missing line
// refuses the invoice by code, and that the reads ask for what they hand on.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { INVOICE_ERROR_CODES, isPersistenceRefusal } from '@saasicat/core';

import { PrismaSubscriptionInvoiceRepository } from '../dist/index.js';

const ISSUED_AT = new Date('2026-02-01T05:15:00.000Z');
const PARTY = {
    legalName: 'Customer GmbH',
    vatId: null,
    taxNumber: null,
    addressLine1: 'Hauptstraße 1',
    addressLine2: null,
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
};

const LINE = {
    position: 1,
    chargeId: 'charge-1',
    contractLineItemId: 'line-1',
    title: 'Standard',
    origin: 'renewal',
    source: 'plan',
    periodFrom: '2026-02-01',
    periodUntil: '2026-02-28',
    amountNet: 49,
    taxRate: 19,
};

const INVOICE = {
    numberPrefix: 'AHP',
    numberYear: 2026,
    tenantId: 't1',
    subscriberId: 'subscriber-1',
    subscriptionId: 'sub-1',
    contractId: 'contract-1',
    issuedAt: ISSUED_AT,
    issueDate: '2026-02-01',
    dueDate: '2026-02-15',
    servicePeriodFrom: '2026-02-01',
    servicePeriodUntil: '2026-02-28',
    currency: 'EUR',
    issuer: { ...PARTY, legalName: 'Issuer GmbH' },
    subscriber: { ...PARTY, customerNumber: 'K-10001' },
    taxTreatment: {
        kind: 'standard',
        rate: 19,
        note: null,
        adapter: { name: '@saasicat/tax-de', version: '1.0.0' },
    },
    taxes: [{ rate: 19, net: 49, tax: 9.31 }],
    totalNet: 49,
    totalTax: 9.31,
    totalGross: 58.31,
    lines: [LINE],
};

/** The rows the client hands back, the way Prisma reads them. */
const created = (data) => ({ ...data, createdAt: ISSUED_AT });

/** A client whose calls are recorded; `linesWritten` is how many lines `createManyAndReturn` gives back. */
function fakeClient({ linesWritten = 1, drawn = [{ last: 7 }], rows = [], prefixes = [] } = {}) {
    const calls = [];
    const record =
        (name, answer) =>
        async (...args) => {
            calls.push([name, ...args]);
            return typeof answer === 'function' ? answer(...args) : answer;
        };
    const client = {
        calls,
        $executeRaw: record('$executeRaw', 1),
        $queryRaw: record('$queryRaw', (strings) =>
            strings.join('?').includes('UPDATE') ? drawn : [{ subscriptionId: 'sub-1' }],
        ),
        subscriptionInvoice: {
            create: record('create', ({ data }) => created(data)),
            findUnique: record('findUnique', rows[0] ?? null),
            findMany: record('findMany', ({ select }) =>
                select ? prefixes.map((numberPrefix) => ({ numberPrefix })) : rows,
            ),
        },
        subscriptionInvoiceLine: {
            createManyAndReturn: record('createManyAndReturn', ({ data }) =>
                data.slice(0, linesWritten),
            ),
        },
        subscriberLedgerEntry: { findMany: record('ledger.findMany', []) },
        $transaction: async (fn) => {
            calls.push(['$transaction']);
            return fn(client);
        },
    };
    return client;
}

const callsNamed = (client, name) => client.calls.filter(([called]) => called === name);

describe('PrismaSubscriptionInvoiceRepository', () => {
    test('issuing draws the year’s next number and writes the invoice with it, in one transaction', async () => {
        const client = fakeClient();

        const issued = await new PrismaSubscriptionInvoiceRepository(client).issue(INVOICE);

        assert.equal(client.calls[0][0], '$transaction');
        const [insertYear, raiseYear] = [
            callsNamed(client, '$executeRaw')[0],
            callsNamed(client, '$queryRaw')[0],
        ];
        assert.match(
            insertYear[1].join('?'),
            /INSERT INTO "subscription_invoice_numbers".*ON CONFLICT \("year"\) DO NOTHING/s,
        );
        assert.deepEqual(insertYear.slice(2), [2026]);
        assert.match(
            raiseYear[1].join('?'),
            /UPDATE "subscription_invoice_numbers" SET "last" = "last" \+ 1/,
        );
        assert.deepEqual(raiseYear.slice(2), [2026]);
        assert.deepEqual([issued.number, issued.numberSequence], ['AHP-2026-000007', 7]);
    });

    test('days reach their date columns as midnight UTC, amounts as two-place text', async () => {
        const client = fakeClient();

        await new PrismaSubscriptionInvoiceRepository(client).issue(INVOICE);

        const [[, { data: invoice }]] = callsNamed(client, 'create');
        assert.equal(invoice.issueDate.toISOString(), '2026-02-01T00:00:00.000Z');
        assert.equal(invoice.dueDate.toISOString(), '2026-02-15T00:00:00.000Z');
        assert.equal(invoice.servicePeriodUntil.toISOString(), '2026-02-28T00:00:00.000Z');
        assert.deepEqual(
            [invoice.totalNet, invoice.totalTax, invoice.totalGross],
            ['49.00', '9.31', '58.31'],
        );
        const [[, lines]] = callsNamed(client, 'createManyAndReturn');
        assert.equal(lines.skipDuplicates, true);
        assert.equal(lines.data[0].invoiceId, invoice.id);
        assert.equal(lines.data[0].periodFrom.toISOString(), '2026-02-01T00:00:00.000Z');
        assert.equal(lines.data[0].amountNet, '49.00');
    });

    test('a line the unique key left unwritten refuses the invoice by code, naming the charge', async () => {
        const client = fakeClient({ linesWritten: 0 });

        await assert.rejects(
            new PrismaSubscriptionInvoiceRepository(client).issue(INVOICE),
            (error) => {
                assert.ok(isPersistenceRefusal(error));
                assert.equal(error.code, INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CHARGE_INVOICED);
                assert.deepEqual(error.params, { chargeId: 'charge-1' });
                return true;
            },
        );
    });

    test('a year whose row cannot be raised is said, rather than numbered from nothing', async () => {
        const client = fakeClient({ drawn: [] });

        await assert.rejects(
            new PrismaSubscriptionInvoiceRepository(client).issue(INVOICE),
            /subscription_invoice_numbers has no row for 2026/,
        );
        assert.equal(callsNamed(client, 'create').length, 0);
    });

    test('on the caller’s transaction it opens none of its own, and writes inside a savepoint', async () => {
        const client = fakeClient();

        await new PrismaSubscriptionInvoiceRepository(client).issue(INVOICE, client);

        assert.equal(callsNamed(client, '$transaction').length, 0);
        const statements = callsNamed(client, '$executeRaw').map(([, strings]) =>
            strings.join('?'),
        );
        assert.match(statements[0], /^SAVEPOINT "subscription_invoice_issue"$/);
        assert.match(statements.at(-1), /^RELEASE SAVEPOINT "subscription_invoice_issue"$/);
        assert.equal(callsNamed(client, 'create').length, 1);
    });

    test('a refusal on the caller’s transaction rolls back to the savepoint before it is thrown', async () => {
        const client = fakeClient({ linesWritten: 0 });

        await assert.rejects(
            new PrismaSubscriptionInvoiceRepository(client).issue(INVOICE, client),
            (error) => error.code === INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CHARGE_INVOICED,
        );

        const statements = callsNamed(client, '$executeRaw').map(([, strings]) =>
            strings.join('?'),
        );
        assert.match(statements.at(-1), /^ROLLBACK TO SAVEPOINT "subscription_invoice_issue"$/);
        assert.ok(!statements.some((statement) => statement.startsWith('RELEASE')));
    });

    test('the due subscriptions are asked for after the page given, or from the start', async () => {
        const client = fakeClient();
        const repository = new PrismaSubscriptionInvoiceRepository(client);

        assert.deepEqual(await repository.listSubscriptionsWithUninvoicedCharges({ limit: 5 }), [
            'sub-1',
        ]);
        await repository.listSubscriptionsWithUninvoicedCharges({ limit: 5, after: 'sub-0' });

        const [first, second] = callsNamed(client, '$queryRaw');
        assert.match(first[1].join('?'), /HAVING bool_or\(e."amountNet" <> 0\)/);
        assert.deepEqual(first.slice(2), ['', 5]);
        assert.deepEqual(second.slice(2), ['sub-0', 5]);
    });

    test('the charges left to invoice are those with no invoice line, in the journal’s order', async () => {
        const client = fakeClient();

        await new PrismaSubscriptionInvoiceRepository(client).listUninvoicedCharges('sub-1');

        const [[, query]] = callsNamed(client, 'ledger.findMany');
        assert.deepEqual(query.where, { subscriptionId: 'sub-1', invoiceLine: { is: null } });
        assert.deepEqual(query.orderBy[0], { periodStart: 'asc' });
    });

    test('reads ask for the lines in their order, and the prefixes two at most', async () => {
        const client = fakeClient({ prefixes: ['AHP'] });
        const repository = new PrismaSubscriptionInvoiceRepository(client);

        assert.equal(await repository.findById('invoice-1'), null);
        assert.deepEqual(await repository.listBySubscriber('subscriber-1'), []);
        assert.deepEqual(await repository.listIssuedNumberPrefixes(), ['AHP']);

        const [[, byId]] = callsNamed(client, 'findUnique');
        assert.deepEqual(byId.include, { lines: { orderBy: { position: 'asc' } } });
        const [[, bySubscriber], [, prefixes]] = callsNamed(client, 'findMany');
        assert.deepEqual(bySubscriber.orderBy, [
            { numberYear: 'desc' },
            { numberSequence: 'desc' },
        ]);
        assert.deepEqual([prefixes.distinct, prefixes.take], [['numberPrefix'], 2]);
    });
});
