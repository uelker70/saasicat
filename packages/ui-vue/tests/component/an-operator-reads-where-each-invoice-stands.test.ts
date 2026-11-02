// The subscriber's record says of each invoice what replaced it and where its
// payment stands, as the server decided it. Mounted through a router, the way
// an app mounts the page, against a stubbed registry; the day and the amounts
// are compared with the record's own columns, which write them the same way.

// @requirement SC-ADM-051 — An invoice in the record names its replacement and says where its payment stands

import { afterEach, describe, expect, test } from 'vitest';
import type { AdminSubscriberInvoice } from '@saasicat/core';

import { mountRecord, type MountedRecord } from './support/subscriber-record.js';

const of = (number: string) => ({
    invoiceId: `invoice-${number.slice(-3)}`,
    number,
    issueDate: '2026-06-01',
});

const reference = (number: string) => ({ invoiceId: `invoice-${number.slice(-3)}`, number });

const invoice = (
    number: string,
    overrides: Partial<AdminSubscriberInvoice> = {},
): AdminSubscriberInvoice => ({
    id: `invoice-${number.slice(-3)}`,
    number,
    issuedAt: '2026-06-01T05:15:00.000Z',
    dueDate: '2026-07-01',
    totalGross: 49,
    currency: 'EUR',
    owed: 0,
    correction: null,
    cancelledBy: null,
    replacedBy: null,
    payment: null,
    documentArchived: false,
    ...overrides,
});

/** A replacement still owing part, its cancellation invoice, the one cancelled, and one paid. */
const PAYMENTS = {
    invoices: [
        invoice('AHP-2026-000003', {
            totalGross: 39,
            owed: 20,
            correction: { kind: 'replacement', of: of('AHP-2026-000001') },
            payment: { kind: 'open', owed: 20, overdue: true },
        }),
        invoice('AHP-2026-000002', {
            totalGross: -49,
            correction: { kind: 'cancellation', of: of('AHP-2026-000001') },
        }),
        invoice('AHP-2026-000001', {
            cancelledBy: reference('AHP-2026-000002'),
            replacedBy: reference('AHP-2026-000003'),
        }),
        invoice('AHP-2026-000000', { payment: { kind: 'paid', on: '2026-07-01' } }),
    ],
    openCases: [],
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
});

/** Each row of the invoice table by its number, its cells by column. */
function rowsOf(wrapper: MountedRecord): Map<string, Record<string, string>> {
    const section = wrapper
        .findAll('section')
        .find((element) => element.find('h2').exists() && element.find('h2').text() === 'Payments');
    const table = section?.findAll('.sa-table')[0];
    expect(table, 'no invoice table').toBeTruthy();
    const names = ['number', 'standing', 'issued', 'due', 'total', 'owed', 'payment'];
    return new Map(
        (table?.findAll('tbody tr') ?? []).map((row) => {
            const cells = row.findAll('td').map((cell) => cell.text());
            const named = Object.fromEntries(
                names.map((name, index) => [name, cells[index] ?? '']),
            );
            return [named.number ?? '', named];
        }),
    );
}

async function rows(): Promise<Map<string, Record<string, string>>> {
    const { wrapper } = await mountRecord({
        capabilities: { 'payments.read': true },
        subscribers: { payments: async () => PAYMENTS },
    });
    mounted.push(wrapper);
    return rowsOf(wrapper);
}

describe('the invoices in a subscriber’s record', () => {
    test('an invoice cancelled names what cancelled it and what replaced it, and no payment', async () => {
        const cancelled = (await rows()).get('AHP-2026-000001');
        expect(cancelled?.standing).toBe(
            'Cancelled by AHP-2026-000002 · Replaced by AHP-2026-000003',
        );
        expect(cancelled?.payment).toBe('');
    });

    test('an invoice paid says on which day, written as the record writes days', async () => {
        const paid = (await rows()).get('AHP-2026-000000');
        expect(paid?.due).not.toBe('');
        expect(paid?.payment).toBe(`Paid on ${paid?.due}`);
    });

    test('an invoice paid in part past its due date says what it still owes of its total', async () => {
        const replacement = (await rows()).get('AHP-2026-000003');
        expect(replacement?.payment).toBe(`Overdue: ${replacement?.owed} of ${replacement?.total}`);
    });
});
