// What the open items' raw queries select is checked row by row: an amount
// that is missing or not an amount fails the read naming the invoice, the
// credit or the currency of its row, as the Drizzle adapter names them, and
// never leaves the amounts after it on the wrong rows.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaSubscriberPaymentRepository } from '../dist/index.js';
import { memoryPrisma } from './support/memory-prisma.js';

/** The repository over a client whose every raw query answers `rows`. */
const answering = (rows) =>
    new PrismaSubscriberPaymentRepository(memoryPrisma({ raw: () => rows }));

describe('an open amount that is not one', () => {
    test('fails a page of open invoices naming the invoice', async () => {
        const repo = answering([
            { id: 'invoice-1', owed: '10.00' },
            { id: 'invoice-2', owed: 'twelve' },
        ]);

        await assert.rejects(repo.listOpenInvoices({ limit: 50 }), {
            message: 'subscription_invoices.owed of invoice-2 is not an amount.',
        });
    });

    test('fails a page of open invoices where one is missing, rather than move the next one up', async () => {
        const repo = answering([
            { id: 'invoice-1', owed: null },
            { id: 'invoice-2', owed: '12.00' },
        ]);

        await assert.rejects(repo.listOpenInvoices({ limit: 50 }), {
            message: 'subscription_invoices.owed of invoice-1 is not an amount.',
        });
    });

    test('fails the totals naming the currency', async () => {
        const repo = answering([{ currency: 'EUR', owed: '10.00', overdue: 'n/a', open: '1.00' }]);

        await assert.rejects(repo.openItemTotals('2026-02-17'), {
            message: 'subscription_invoices.overdue of EUR is not an amount.',
        });
    });
});
