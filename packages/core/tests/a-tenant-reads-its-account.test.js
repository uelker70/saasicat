// What a subscriber's account adds up to, read from the standings its
// invoice list shows and from its credits: per currency, what is owed and of
// that what is overdue, and beside it — never set off against it — what the
// subscriber is owed.

// @requirement SC-PRIC-049 — A subscriber's account is shown to the tenant's users holding the billing permission

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { tenantAccountOf } from '../dist/index.js';

/** An invoice in `currency` whose payment stands as `payment`; `null` for one cancelled. */
const invoice = (id, payment, currency = 'EUR') => ({
    invoice: { id, currency },
    standing: { cancelledBy: null, replacedBy: null, payment },
});
const open = (owed, overdue = false) => ({ kind: 'open', owed, overdue });

/** A credit of `currency` with `open` still to be paid out, arisen from `origin`. */
const credit = (id, open, origin, currency = 'EUR') => ({
    credit: { id, currency, amount: open, origin },
    entries: [],
    open,
});

describe("a subscriber's account", () => {
    test('of nothing open is no balance at all', () => {
        assert.deepEqual(tenantAccountOf([], []).balances, []);
        assert.deepEqual(
            tenantAccountOf(
                [invoice('i-1', { kind: 'paid', on: '2026-10-01' }), invoice('i-2', null)],
                [credit('c-1', 0, { kind: 'payment', paymentId: 'p-1' })],
            ).balances,
            [],
        );
    });

    test('owes what its open invoices still owe, and of that what is overdue', () => {
        const { balances } = tenantAccountOf(
            [
                invoice('i-1', open(49)),
                invoice('i-2', open(20, true)),
                invoice('i-3', { kind: 'reversed', on: '2026-10-05', owed: 9.5, overdue: true }),
            ],
            [],
        );

        assert.deepEqual(balances, [{ currency: 'EUR', owed: 78.5, overdue: 29.5, credit: 0 }]);
    });

    test('adds to the cent, as the amounts were written', () => {
        // Each of the two would come out a hair off in binary arithmetic: a
        // sum of the amounts as written, and a sum of a hundred times each.
        const owed = (...amounts) =>
            tenantAccountOf(
                amounts.map((amount, at) => invoice(`i-${at}`, open(amount))),
                [],
            ).balances[0].owed;

        assert.equal(owed(0.1, 0.2), 0.3);
        assert.equal(owed(19.99, 19.99, 19.99), 59.97);
    });

    test('leaves out what a cancelled invoice, a cancellation and a paid one would say', () => {
        const { balances } = tenantAccountOf(
            [
                invoice('cancelled', null),
                invoice('cancellation', null),
                invoice('paid', { kind: 'paid', on: '2026-10-01' }),
                invoice('replacement', open(30)),
            ],
            [],
        );

        assert.deepEqual(balances, [{ currency: 'EUR', owed: 30, overdue: 0, credit: 0 }]);
    });

    test('shows the credit beside what is owed, and sets neither off against the other', () => {
        const { balances } = tenantAccountOf(
            [invoice('i-1', open(69, false)), invoice('i-2', open(20, true))],
            [credit('c-1', 12, { kind: 'payment', paymentId: 'p-1' })],
        );

        assert.deepEqual(balances, [{ currency: 'EUR', owed: 89, overdue: 20, credit: 12 }]);
    });

    test('counts every credit still to be paid out, whatever it arose from', () => {
        const { balances } = tenantAccountOf(
            [],
            [
                credit('c-1', 5, { kind: 'payment', paymentId: 'p-1' }),
                credit('c-2', 7, { kind: 'reversal', reversalId: 'r-1' }),
                credit('c-3', 0, { kind: 'payment', paymentId: 'p-2' }),
            ],
        );

        assert.deepEqual(balances, [{ currency: 'EUR', owed: 0, overdue: 0, credit: 12 }]);
    });

    test('counts an invoice to be refunded before its credit is recorded, as the list says', () => {
        const { balances } = tenantAccountOf(
            [invoice('credit-note', { kind: 'to-be-refunded', open: 15 })],
            [],
        );

        assert.deepEqual(balances, [{ currency: 'EUR', owed: 0, overdue: 0, credit: 15 }]);
    });

    test('counts it by its credit once that is recorded, and not twice', () => {
        const { balances } = tenantAccountOf(
            [invoice('credit-note', { kind: 'to-be-refunded', open: 10 })],
            [credit('c-1', 10, { kind: 'invoice', invoiceId: 'credit-note' })],
        );

        assert.deepEqual(balances, [{ currency: 'EUR', owed: 0, overdue: 0, credit: 10 }]);
    });

    test('keeps each currency apart, the codes in order', () => {
        const { balances } = tenantAccountOf(
            [invoice('i-1', open(10), 'USD'), invoice('i-2', open(20, true), 'EUR')],
            [credit('c-1', 3, { kind: 'payment', paymentId: 'p-1' }, 'CHF')],
        );

        assert.deepEqual(balances, [
            { currency: 'CHF', owed: 0, overdue: 0, credit: 3 },
            { currency: 'EUR', owed: 20, overdue: 20, credit: 0 },
            { currency: 'USD', owed: 10, overdue: 0, credit: 0 },
        ]);
    });
});
