// The pure parts of a reversal: how what the gateway withdrew divides across
// what its payment brought — the credit first, then the invoices, and what
// meets nothing —, how what it gives back returns it part for part, and the
// rows of reversals, their entries and the cases to reconcile read back by
// either adapter — strictly, since every one of them is money.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    casesCovered,
    netByInvoice,
    openOfCredit,
    paidOutByCredit,
    reconciliationCaseColumns,
    reinstatementParts,
    reversalEntryColumns,
    subscriberReversalColumns,
    toCollectionReversedNotice,
    toSubscriberCreditEntryRecord,
    toSubscriberReconciliationCaseRecord,
    toSubscriberReversalRecord,
    withdrawalParts,
} from '../dist/index.js';

const AT = new Date('2026-04-20T08:15:00.000Z');

const credit = (left, open) => ({ creditId: 'c-1', left, open });
const invoice = (invoiceId, left) => ({ invoiceId, left });

// @requirement SC-PRIC-084 — A returned debit or a chargeback is recorded, and what the payment settled opens again
describe('what a reversal takes back of what its payment brought', () => {
    test('without a credit, the invoices it settles, the oldest first', () => {
        assert.deepEqual(withdrawalParts(99, null, [invoice('i-1', 60), invoice('i-2', 39)]), {
            fromCredit: 0,
            credit: null,
            covering: [],
            invoices: [
                { invoiceId: 'i-1', amount: 60 },
                { invoiceId: 'i-2', amount: 39 },
            ],
            unmatched: 0,
        });
    });

    test('the credit first: its open part, then the invoice with the rest', () => {
        assert.deepEqual(withdrawalParts(120, credit(20, 20), [invoice('i-1', 100)]), {
            fromCredit: 20,
            credit: { creditId: 'c-1', amount: 20 },
            covering: [],
            invoices: [{ invoiceId: 'i-1', amount: 100 }],
            unmatched: 0,
        });
    });

    test('a partial reversal no larger than the credit shrinks the credit alone', () => {
        const parts = withdrawalParts(15, credit(20, 20), [invoice('i-1', 100)]);
        assert.deepEqual(parts.credit, { creditId: 'c-1', amount: 15 });
        assert.deepEqual(parts.invoices, []);
    });

    for (const [amount, invoiceShare, why] of [
        [20, [], 'exactly the credit leaves the invoice settled'],
        [
            20.01,
            [{ invoiceId: 'i-1', amount: 0.01 }],
            'a cent beyond it opens the invoice by a cent',
        ],
        [19.99, [], 'a cent short of it opens nothing'],
    ]) {
        test(why, () => {
            assert.deepEqual(
                withdrawalParts(amount, credit(20, 20), [invoice('i-1', 100)]).invoices,
                invoiceShare,
            );
        });
    }

    test('the part of the credit already paid out matches nothing', () => {
        assert.deepEqual(withdrawalParts(120, credit(20, 5), [invoice('i-1', 100)]), {
            fromCredit: 20,
            credit: { creditId: 'c-1', amount: 5 },
            covering: [],
            invoices: [{ invoiceId: 'i-1', amount: 100 }],
            unmatched: 15,
        });
        assert.deepEqual(withdrawalParts(120, credit(20, 0), [invoice('i-1', 100)]).credit, null);
    });

    test('takes from what of the credit an earlier reversal left', () => {
        const parts = withdrawalParts(30, credit(10, 10), [invoice('i-1', 100)]);
        assert.deepEqual(
            [parts.fromCredit, parts.invoices],
            [10, [{ invoiceId: 'i-1', amount: 20 }]],
        );
        assert.equal(withdrawalParts(30, credit(-5, 10), [invoice('i-1', 100)]).fromCredit, 0);
    });

    test('what goes beyond everything the payment brought matches nothing', () => {
        const parts = withdrawalParts(150.01, credit(20, 20), [invoice('i-1', 100)]);
        assert.equal(parts.unmatched, 30.01);
        assert.deepEqual(withdrawalParts(100.01, null, [invoice('i-1', 100)]).unmatched, 0.01);
    });

    test('passes over an invoice it already opened in full', () => {
        assert.deepEqual(
            withdrawalParts(10, null, [invoice('i-1', 0), invoice('i-2', 10)]).invoices,
            [{ invoiceId: 'i-2', amount: 10 }],
        );
    });

    test('counts in cents, not in binary fractions', () => {
        const parts = withdrawalParts(0.3, credit(0.1, 0.1), [invoice('i-1', 0.2)]);
        assert.deepEqual(
            [parts.credit?.amount, parts.invoices[0]?.amount, parts.unmatched],
            [0.1, 0.2, 0],
        );
    });
});

// @requirement SC-PRIC-087 — A credit left for the same invoice covers what a reversal would open again
describe('what credits other payments for the same invoice left cover of a reversal', () => {
    const other = (creditId, open) => ({ creditId, open });

    test('they cover what would open the invoice again, the oldest first', () => {
        assert.deepEqual(
            withdrawalParts(50, null, [invoice('i-1', 100)], [other('c-2', 30), other('c-3', 40)]),
            {
                fromCredit: 0,
                credit: null,
                covering: [
                    { creditId: 'c-2', amount: 30 },
                    { creditId: 'c-3', amount: 20 },
                ],
                invoices: [],
                unmatched: 0,
            },
        );
    });

    for (const [open, covered, opened, why] of [
        [29.99, 29.99, [{ invoiceId: 'i-1', amount: 0.01 }], 'a cent short leaves a cent to open'],
        [30, 30, [], 'exactly what would open leaves the invoice settled'],
        [30.01, 30, [], 'a cent beyond it is not taken'],
    ]) {
        test(why, () => {
            const parts = withdrawalParts(30, null, [invoice('i-1', 100)], [other('c-2', open)]);
            assert.deepEqual(
                [parts.covering, parts.invoices],
                [[{ creditId: 'c-2', amount: covered }], opened],
            );
        });
    }

    test('come after the credit the payment itself left', () => {
        const parts = withdrawalParts(
            60,
            credit(20, 20),
            [invoice('i-1', 100)],
            [other('c-2', 50)],
        );
        assert.deepEqual(
            [parts.credit, parts.covering, parts.invoices],
            [{ creditId: 'c-1', amount: 20 }, [{ creditId: 'c-2', amount: 40 }], []],
        );
    });

    test('do not cover the part of that credit already paid out, nor what goes beyond the payment', () => {
        const paidOut = withdrawalParts(
            30,
            credit(20, 5),
            [invoice('i-1', 100)],
            [other('c-2', 50)],
        );
        assert.deepEqual(
            [paidOut.covering, paidOut.invoices, paidOut.unmatched],
            [[{ creditId: 'c-2', amount: 10 }], [], 15],
        );
        const beyond = withdrawalParts(150.01, null, [invoice('i-1', 100)], [other('c-2', 200)]);
        assert.deepEqual(
            [beyond.covering, beyond.unmatched],
            [[{ creditId: 'c-2', amount: 100 }], 50.01],
        );
    });

    test('one with nothing open is passed over', () => {
        assert.deepEqual(
            withdrawalParts(10, null, [invoice('i-1', 100)], [other('c-2', 0), other('c-3', 10)])
                .covering,
            [{ creditId: 'c-3', amount: 10 }],
        );
    });

    test('they cover the invoices in the order given', () => {
        const parts = withdrawalParts(
            99,
            null,
            [invoice('i-1', 60), invoice('i-2', 39)],
            [other('c-2', 70)],
        );
        assert.deepEqual(parts.invoices, [{ invoiceId: 'i-2', amount: 29 }]);
    });
});

// @requirement SC-PRIC-086 — A dispute won takes its reversal back, and what was paid meanwhile becomes a credit
describe('what the gateway gives back of a reversal', () => {
    const took = {
        unmatched: 15,
        credits: [{ creditId: 'c-1', left: 5 }],
        invoices: [{ invoiceId: 'i-1', left: 100, owed: 100 }],
    };

    test('in full: the unmatched part, the credit, and the invoice settled again', () => {
        assert.deepEqual(reinstatementParts(120, took), {
            covered: 15,
            credits: [{ creditId: 'c-1', amount: 5 }],
            invoices: [{ invoiceId: 'i-1', amount: 100 }],
            credited: 0,
            beyond: 0,
        });
    });

    test('in part: the unmatched part first, as Stripe gives back a refunded part', () => {
        assert.deepEqual(reinstatementParts(15, took), {
            covered: 15,
            credits: [],
            invoices: [],
            credited: 0,
            beyond: 0,
        });
        assert.deepEqual(reinstatementParts(14.99, took).covered, 14.99);
        assert.deepEqual(reinstatementParts(15.01, took).credits, [
            { creditId: 'c-1', amount: 0.01 },
        ]);
    });

    test('what an invoice paid meanwhile no longer owes becomes a credit', () => {
        const paid = { ...took, invoices: [{ invoiceId: 'i-1', left: 100, owed: 0 }] };
        assert.deepEqual(reinstatementParts(120, paid).invoices, []);
        assert.equal(reinstatementParts(120, paid).credited, 100);
    });

    test('an invoice paid in part is settled as far as it owes, and the rest is a credit', () => {
        const part = { ...took, invoices: [{ invoiceId: 'i-1', left: 100, owed: 40.01 }] };
        assert.deepEqual(reinstatementParts(120, part).invoices, [
            { invoiceId: 'i-1', amount: 40.01 },
        ]);
        assert.equal(reinstatementParts(120, part).credited, 59.99);
    });

    test('an invoice owing the subscriber is settled by nothing', () => {
        const owing = { ...took, invoices: [{ invoiceId: 'i-1', left: 100, owed: -10 }] };
        assert.equal(reinstatementParts(120, owing).credited, 100);
    });

    test('what goes beyond everything the reversal took is taken by nothing', () => {
        assert.equal(reinstatementParts(120.01, took).beyond, 0.01);
    });
});

describe('which cases of a reversal what was given back covers', () => {
    const cases = [
        { id: 'k-1', amount: 15 },
        { id: 'k-2', amount: 10 },
    ];

    for (const [covered, ids] of [
        [0, []],
        [14.99, []],
        [15, ['k-1']],
        [24.99, ['k-1']],
        [25, ['k-1', 'k-2']],
    ]) {
        test(`${covered} covers ${ids.length ? ids.join(' and ') : 'none'} in full`, () => {
            assert.deepEqual(casesCovered(cases, covered), ids);
        });
    }
});

describe('what entries net', () => {
    test('settlements, by invoice, in the order the invoices first appear', () => {
        assert.deepEqual(
            netByInvoice([
                { invoiceId: 'i-2', amount: 10 },
                { invoiceId: 'i-1', amount: 58.31 },
                { invoiceId: 'i-2', amount: -10.01 },
                { invoiceId: 'i-1', amount: 0.1 },
            ]),
            [
                { invoiceId: 'i-2', amount: -0.01 },
                { invoiceId: 'i-1', amount: 58.41 },
            ],
        );
    });

    test('a reversal taken back gives back what it took of a credit', () => {
        const entries = [
            { creditId: 'c-1', kind: 'REVERSAL', amount: 20 },
            { creditId: 'c-2', kind: 'REVERSAL', amount: 5 },
            { creditId: 'c-1', kind: 'REVERSAL_TAKEN_BACK', amount: 12.5 },
        ];
        assert.deepEqual(paidOutByCredit(entries), [
            { creditId: 'c-1', amount: 7.5 },
            { creditId: 'c-2', amount: 5 },
        ]);
        assert.equal(openOfCredit(40, entries.slice(0, 1)), 20);
        assert.equal(openOfCredit(40, [entries[0], entries[2]]), 32.5);
    });
});

describe('a reversal row', () => {
    const reported = {
        gatewayAccount: 'stripe-main',
        gatewayRef: 'du_1',
        paymentRef: 'pi_1',
        currency: 'EUR',
        withdrawn: 120,
        reinstated: 0,
        at: AT,
    };
    const row = {
        id: 'r-1',
        ...subscriberReversalColumns(reported, {
            id: 'p-1',
            subscriberId: 's-1',
            tenantId: 't-1',
        }),
    };

    test('is first written with nothing withdrawn, which its entries raise', () => {
        assert.deepEqual(
            [Number(row.amount), Number(row.fromCredit), Number(row.reinstated), row.reinstatedAt],
            [0, 0, 0, null],
        );
        const record = toSubscriberReversalRecord({
            ...row,
            amount: '120.00',
            fromCredit: '20.00',
            reinstated: '15.00',
            reinstatedAt: AT,
        });
        assert.deepEqual(
            [record.paymentId, record.amount, record.fromCredit, record.reinstated],
            ['p-1', 120, 20, 15],
        );
    });

    for (const [change, why] of [
        [{ amount: '10.00', fromCredit: '10.01' }, 'takes more from the credit than it withdrew'],
        [
            { amount: '10.00', reinstated: '10.01', reinstatedAt: AT },
            'is given back more than it withdrew',
        ],
        [{ amount: '10.00', fromCredit: '-0.01' }, 'takes a negative part'],
        [{ amount: '10.00', reinstated: '5.00' }, 'is given something back without when'],
        [{ amount: '10.00', reinstatedAt: AT }, 'carries when without being given anything'],
    ]) {
        test(`that ${why} stops the read`, () => {
            assert.throws(
                () => toSubscriberReversalRecord({ ...row, ...change }),
                /subscriber_reversals/,
            );
        });
    }
});

describe('a credit entry of a reversal', () => {
    const entry = (kind, overrides = {}) => ({
        id: 'e-1',
        ...reversalEntryColumns('c-1', { id: 'r-1', gatewayRef: 'du_1' }, kind, 5, AT),
        paidOn: null,
        ...overrides,
    });

    test("reads back naming its reversal, under the reversal's reference", () => {
        const record = toSubscriberCreditEntryRecord(entry('REVERSAL_TAKEN_BACK'));
        assert.deepEqual(
            [record.kind, record.reversalId, record.reference, record.amount],
            ['REVERSAL_TAKEN_BACK', 'r-1', 'du_1', 5],
        );
    });

    test('without its reversal, or with a refund, stops the read', () => {
        assert.throws(
            () => toSubscriberCreditEntryRecord(entry('REVERSAL', { reversalId: null })),
            /without a reversal/,
        );
        assert.throws(
            () => toSubscriberCreditEntryRecord(entry('REVERSAL', { refundId: 'f-1' })),
            /with a refund/,
        );
        assert.throws(
            () => toSubscriberCreditEntryRecord(entry('PAYOUT', { refundId: null })),
            /with a reversal/,
        );
    });
});

// @requirement SC-ADM-033 — The operator reconciles what no credit matched, and closes each case with a note
describe('a case to reconcile', () => {
    const opened = (kind) => ({
        id: 'k-1',
        ...reconciliationCaseColumns({
            kind,
            amount: 30,
            currency: 'EUR',
            payment: { id: 'p-1', subscriberId: 's-1', tenantId: 't-1' },
            about: {
                id: kind === 'REFUND_UNMATCHED' ? 'f-1' : 'r-1',
                gatewayAccount: 'stripe-main',
                gatewayRef: 're_1',
            },
            at: AT,
        }),
    });

    test('is opened about exactly what its kind says, open and without a note', () => {
        const refund = toSubscriberReconciliationCaseRecord(opened('REFUND_UNMATCHED'));
        assert.deepEqual(
            [refund.refundId, refund.reversalId, refund.amount, refund.closedAt, refund.note],
            ['f-1', null, 30, null, null],
        );
        const reversal = toSubscriberReconciliationCaseRecord(opened('REVERSAL_UNMATCHED'));
        assert.deepEqual([reversal.refundId, reversal.reversalId], [null, 'r-1']);
    });

    test('reads back closed with a note, by the operator or by SaaSiCat', () => {
        const closed = {
            ...opened('REFUND_UNMATCHED'),
            closedAt: AT,
            note: 'Recovered by transfer.',
        };
        assert.equal(
            toSubscriberReconciliationCaseRecord({ ...closed, closedBy: 'operator-1' }).closedBy,
            'operator-1',
        );
        assert.equal(toSubscriberReconciliationCaseRecord(closed).closedBy, null);
    });

    for (const [change, pattern, why] of [
        [{ refundId: null }, /naming no refund/, 'about a refund naming none'],
        [{ reversalId: 'r-1' }, /and a reversal/, 'about a refund naming a reversal too'],
        [{ kind: 'PAYOUT_UNMATCHED' }, /kind/, 'of a kind this release does not know'],
        [{ closedAt: AT }, /closed without a note/, 'closed without a note'],
        [{ note: 'Why' }, /open with a note/, 'open with a note'],
        [{ closedBy: 'operator-1' }, /open and names who closed it/, 'open naming who closed it'],
    ]) {
        test(`${why} stops the read`, () => {
            assert.throws(
                () =>
                    toSubscriberReconciliationCaseRecord({
                        ...opened('REFUND_UNMATCHED'),
                        ...change,
                    }),
                pattern,
            );
        });
    }
});

// @requirement SC-PRIC-085 — A reversal is told, and the payment method it reversed collects nothing again
describe('a recorded collection-reversed notice', () => {
    const content = {
        kind: 'collection-reversed',
        tenantId: 't-1',
        subscriptionId: 'sub-1',
        subscriberId: 's-1',
        invoiceId: 'i-1',
        invoiceNumber: 'AHP-2026-000001',
        amount: 99,
        currency: 'EUR',
        paymentMethodType: 'sepa_debit',
        owed: 99,
        next: { action: 'replace-payment-method' },
    };

    test('reads back as it was recorded', () => {
        assert.deepEqual(toCollectionReversedNotice(content, 'n-1'), content);
        const replaced = { ...content, next: { action: 'collected-with-payment-method-in-use' } };
        assert.deepEqual(toCollectionReversedNotice(replaced, 'n-1'), replaced);
    });

    test('with what follows unknown, or without what it owes, stops the read', () => {
        assert.throws(
            () =>
                toCollectionReversedNotice(
                    { ...content, next: { action: 'charged-again' } },
                    'n-1',
                ),
            /action 'charged-again'/,
        );
        assert.throws(() => toCollectionReversedNotice({ ...content, owed: '99' }, 'n-1'), /owed/);
    });
});
