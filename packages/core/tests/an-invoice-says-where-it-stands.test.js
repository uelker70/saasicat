// Where an invoice stands, as the operator's record and the tenant's list read
// it: which invoices it is linked to by a cancellation, and where its payment
// stands. Every day is a day of the installation, Berlin here, so a payment at
// half past midnight is on the day it is there.

// @requirement SC-ADM-051 — An invoice in the record names its replacement and says where its payment stands

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { invoiceStandingsOf } from '../dist/index.js';

const BERLIN = { today: '2026-07-10', timeZone: 'Europe/Berlin' };

function invoice(id, totalGross, { dueDate = '2026-07-15', correction = null } = {}) {
    return { id, number: `R-${id}`, totalGross, dueDate, correction };
}

function correcting(kind, of) {
    return { kind, of: { invoiceId: of, number: `R-${of}`, issueDate: '2026-07-01' }, reason: 'x' };
}

function settlement(invoiceId, kind, amount, at, paymentId = 'pay-1') {
    return { invoiceId, kind, amount, recordedAt: new Date(at), payment: { id: paymentId } };
}

function credit(invoiceId, amount, open, entries = []) {
    return {
        credit: { id: `credit-${invoiceId}`, origin: { kind: 'invoice', invoiceId }, amount },
        entries: entries.map((entry, index) => ({
            id: `entry-${index}`,
            paidOn: null,
            ...entry,
            recordedAt: new Date(entry.recordedAt),
        })),
        open,
    };
}

/** The standing of `id` among `invoices`, read with the settlements and credits given. */
function standingOf(id, invoices, { settlements = [], credits = [] } = {}, clock = BERLIN) {
    const read = invoiceStandingsOf({ invoices, settlements, credits }, clock);
    return read.find((each) => each.invoice.id === id).standing;
}

function paymentOf(...args) {
    return standingOf(...args).payment;
}

describe('an invoice nothing has settled', () => {
    for (const [dueDate, overdue] of [
        ['2026-07-11', false],
        ['2026-07-10', false],
        ['2026-07-09', true],
    ]) {
        test(`due ${dueDate} and read on 2026-07-10 is ${overdue ? '' : 'not '}overdue`, () => {
            assert.deepEqual(paymentOf('1', [invoice('1', 49, { dueDate })]), {
                kind: 'open',
                owed: 49,
                overdue,
            });
        });
    }
});

describe('an invoice settled in part', () => {
    test('is open with what it still owes', () => {
        const settlements = [settlement('1', 'PAYMENT', 29, '2026-07-02T08:00:00Z')];
        assert.deepEqual(paymentOf('1', [invoice('1', 49)], { settlements }), {
            kind: 'open',
            owed: 20,
            overdue: false,
        });
    });

    test('is overdue in part once its due date has passed', () => {
        const settlements = [settlement('1', 'PAYMENT', 29, '2026-07-02T08:00:00Z')];
        const due = invoice('1', 49, { dueDate: '2026-07-09' });
        assert.deepEqual(paymentOf('1', [due], { settlements }), {
            kind: 'open',
            owed: 20,
            overdue: true,
        });
    });

    test('by a cent is still open, in cents', () => {
        const settlements = [settlement('1', 'PAYMENT', 49.99, '2026-07-02T08:00:00Z')];
        assert.deepEqual(paymentOf('1', [invoice('1', 50)], { settlements }), {
            kind: 'open',
            owed: 0.01,
            overdue: false,
        });
    });
});

describe('an invoice paid', () => {
    test('is paid on the day its payment arrived, the installation’s day', () => {
        // Half past midnight on 1 July in Berlin: still 30 June in UTC.
        const settlements = [settlement('1', 'PAYMENT', 49, '2026-06-30T22:30:00Z')];
        assert.deepEqual(paymentOf('1', [invoice('1', 49)], { settlements }), {
            kind: 'paid',
            on: '2026-07-01',
        });
    });

    test('in UTC on the UTC day of the same moment', () => {
        const settlements = [settlement('1', 'PAYMENT', 49, '2026-06-30T22:30:00Z')];
        const utc = { today: '2026-07-10', timeZone: 'UTC' };
        assert.deepEqual(paymentOf('1', [invoice('1', 49)], { settlements }, utc), {
            kind: 'paid',
            on: '2026-06-30',
        });
    });

    test('in two parts, on the day the second arrived, whatever order the store read them in', () => {
        const settlements = [
            settlement('1', 'PAYMENT', 20, '2026-07-05T08:00:00Z', 'pay-2'),
            settlement('1', 'PAYMENT', 29, '2026-07-02T08:00:00Z', 'pay-1'),
        ];
        assert.deepEqual(paymentOf('1', [invoice('1', 49)], { settlements }), {
            kind: 'paid',
            on: '2026-07-05',
        });
    });

    test('more than in full, on the day of the payment that brought it there', () => {
        const settlements = [settlement('1', 'PAYMENT', 60, '2026-07-03T08:00:00Z')];
        assert.deepEqual(paymentOf('1', [invoice('1', 49)], { settlements }), {
            kind: 'paid',
            on: '2026-07-03',
        });
    });
});

describe('an invoice whose payment was reversed', () => {
    const paid = settlement('1', 'PAYMENT', 49, '2026-07-02T08:00:00Z');
    const reversed = settlement('1', 'REVERSAL', 49, '2026-07-08T08:00:00Z');

    test('is open again, reversed on the day the reversal was recorded', () => {
        assert.deepEqual(paymentOf('1', [invoice('1', 49)], { settlements: [paid, reversed] }), {
            kind: 'reversed',
            on: '2026-07-08',
            owed: 49,
            overdue: false,
        });
    });

    test('and is overdue once its due date has passed', () => {
        const due = invoice('1', 49, { dueDate: '2026-07-09' });
        assert.deepEqual(paymentOf('1', [due], { settlements: [paid, reversed] }), {
            kind: 'reversed',
            on: '2026-07-08',
            owed: 49,
            overdue: true,
        });
    });

    test('is paid again on the day the gateway gave the reversal back', () => {
        const reinstated = settlement('1', 'REINSTATEMENT', 49, '2026-07-09T08:00:00Z');
        assert.deepEqual(
            paymentOf('1', [invoice('1', 49)], { settlements: [paid, reversed, reinstated] }),
            { kind: 'paid', on: '2026-07-09' },
        );
    });

    test('is paid again on the day another payment arrived', () => {
        const again = settlement('1', 'PAYMENT', 49, '2026-07-09T09:00:00Z', 'pay-2');
        assert.deepEqual(
            paymentOf('1', [invoice('1', 49)], { settlements: [paid, reversed, again] }),
            { kind: 'paid', on: '2026-07-09' },
        );
    });
});

describe('an invoice cancelled and replaced', () => {
    const cancelled = invoice('1', 49);
    const cancellation = invoice('2', -49, { correction: correcting('cancellation', '1') });
    const replacement = invoice('3', 39, { correction: correcting('replacement', '1') });
    const invoices = [replacement, cancellation, cancelled];

    test('names the cancellation invoice and the replacement, and says nothing of a payment', () => {
        assert.deepEqual(standingOf('1', invoices), {
            cancelledBy: { invoiceId: '2', number: 'R-2' },
            replacedBy: { invoiceId: '3', number: 'R-3' },
            payment: null,
        });
    });

    test('cancelled without a replacement names none', () => {
        assert.deepEqual(standingOf('1', [cancellation, cancelled]), {
            cancelledBy: { invoiceId: '2', number: 'R-2' },
            replacedBy: null,
            payment: null,
        });
    });

    test('the cancellation invoice says nothing of a payment, though its total is negative', () => {
        assert.deepEqual(standingOf('2', invoices), {
            cancelledBy: null,
            replacedBy: null,
            payment: null,
        });
    });

    test('the replacement is paid on the day the payment moved into it arrived', () => {
        const settlements = [
            settlement('1', 'PAYMENT', 39, '2026-07-02T08:00:00Z'),
            settlement('1', 'MOVED_OUT', 39, '2026-07-06T08:00:00Z'),
            settlement('3', 'MOVED_IN', 39, '2026-07-06T08:00:00Z'),
        ];
        assert.deepEqual(paymentOf('3', invoices, { settlements }), {
            kind: 'paid',
            on: '2026-07-02',
        });
    });

    test('the replacement owes what the moved payment did not cover', () => {
        const settlements = [
            settlement('1', 'PAYMENT', 30, '2026-07-02T08:00:00Z'),
            settlement('1', 'MOVED_OUT', 30, '2026-07-06T08:00:00Z'),
            settlement('3', 'MOVED_IN', 30, '2026-07-06T08:00:00Z'),
        ];
        assert.deepEqual(paymentOf('3', invoices, { settlements }), {
            kind: 'open',
            owed: 9,
            overdue: false,
        });
    });

    test('a replacement cancelled in turn names both of its own', () => {
        const second = invoice('4', -39, { correction: correcting('cancellation', '3') });
        const third = invoice('5', 29, { correction: correcting('replacement', '3') });
        assert.deepEqual(standingOf('3', [third, second, ...invoices]), {
            cancelledBy: { invoiceId: '4', number: 'R-4' },
            replacedBy: { invoiceId: '5', number: 'R-5' },
            payment: null,
        });
    });
});

describe('an invoice whose total is negative', () => {
    const refund = invoice('1', -20);

    test('is to be refunded in full while no credit of it is read', () => {
        assert.deepEqual(paymentOf('1', [refund]), { kind: 'to-be-refunded', open: 20 });
    });

    test('is to be refunded with what its credit still holds', () => {
        const credits = [
            credit('1', 20, 5, [
                { kind: 'PAYOUT', amount: 15, recordedAt: '2026-07-04T08:00:00Z' },
            ]),
        ];
        assert.deepEqual(paymentOf('1', [refund], { credits }), {
            kind: 'to-be-refunded',
            open: 5,
        });
    });

    test('is refunded on the day the operator recorded the payout for, not the day it was entered', () => {
        const credits = [
            credit('1', 20, 0, [
                {
                    kind: 'PAYOUT',
                    amount: 20,
                    paidOn: '2026-07-03',
                    recordedAt: '2026-07-04T08:00:00Z',
                },
            ]),
        ];
        assert.deepEqual(paymentOf('1', [refund], { credits }), {
            kind: 'refunded',
            on: '2026-07-03',
        });
    });

    test('is refunded on the installation’s day of a refund the gateway reported', () => {
        const credits = [
            credit('1', 20, 0, [
                { kind: 'REFUND', amount: 20, recordedAt: '2026-06-30T22:30:00Z' },
            ]),
        ];
        assert.deepEqual(paymentOf('1', [refund], { credits }), {
            kind: 'refunded',
            on: '2026-07-01',
        });
    });

    test('is to be refunded again where the refund failed', () => {
        const credits = [
            credit('1', 20, 20, [
                { kind: 'REFUND', amount: 20, recordedAt: '2026-07-02T08:00:00Z' },
                { kind: 'REFUND_FAILED', amount: 20, recordedAt: '2026-07-03T08:00:00Z' },
            ]),
        ];
        assert.deepEqual(paymentOf('1', [refund], { credits }), {
            kind: 'to-be-refunded',
            open: 20,
        });
    });

    test('is refunded on the day of the payout that followed a failed refund', () => {
        const credits = [
            credit('1', 20, 0, [
                { kind: 'REFUND', amount: 20, recordedAt: '2026-07-02T08:00:00Z' },
                { kind: 'REFUND_FAILED', amount: 20, recordedAt: '2026-07-03T08:00:00Z' },
                {
                    kind: 'PAYOUT',
                    amount: 20,
                    paidOn: '2026-07-06',
                    recordedAt: '2026-07-07T08:00:00Z',
                },
            ]),
        ];
        assert.deepEqual(paymentOf('1', [refund], { credits }), {
            kind: 'refunded',
            on: '2026-07-06',
        });
    });

    test('takes no credit of another origin for its own', () => {
        const other = {
            ...credit('1', 20, 0),
            credit: { id: 'credit-x', origin: { kind: 'payment', paymentId: '1' }, amount: 20 },
        };
        assert.deepEqual(paymentOf('1', [refund], { credits: [other] }), {
            kind: 'to-be-refunded',
            open: 20,
        });
    });
});

describe('the invoices of a subscriber', () => {
    test('an invoice of nothing says nothing of a payment', () => {
        assert.equal(paymentOf('1', [invoice('1', 0)]), null);
    });

    test('are returned in the order given, each with its own settlements only', () => {
        const settlements = [settlement('2', 'PAYMENT', 49, '2026-07-02T08:00:00Z')];
        const read = invoiceStandingsOf(
            { invoices: [invoice('2', 49), invoice('1', 49)], settlements, credits: [] },
            BERLIN,
        );
        assert.deepEqual(
            read.map(({ invoice: { id }, standing: { payment } }) => [id, payment.kind]),
            [
                ['2', 'paid'],
                ['1', 'open'],
            ],
        );
    });
});
