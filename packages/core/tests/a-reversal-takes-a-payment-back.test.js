// The pure parts of a reversal: how what the gateway withdrew divides across
// what its payment brought — its credits first, then the invoices, and what
// meets nothing —, how what it gives back returns it part for part, and the
// rows of reversals, their entries and the cases to reconcile read back by
// either adapter — strictly, since every one of them is money.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    casesCovered,
    coversLifted,
    coversOf,
    inWithdrawalOrder,
    netByInvoice,
    openOfCredit,
    paidOutByCredit,
    reconciliationCaseColumns,
    reinstatementParts,
    reopenedByStanding,
    reversalEntryColumns,
    subscriberReversalColumns,
    toCollectionReversedNotice,
    toSubscriberCreditEntryRecord,
    toSubscriberReconciliationCaseRecord,
    toSubscriberReversalRecord,
    withdrawalParts,
} from '../dist/index.js';

const AT = new Date('2026-04-20T08:15:00.000Z');

const credit = (left, open, creditId = 'c-1') => ({ creditId, left, open });
const invoice = (invoiceId, left) => ({ invoiceId, left });

// @requirement SC-PRIC-084 — A returned debit or a chargeback is recorded, and what the payment settled opens again
describe('what a reversal takes back of what its payment brought', () => {
    test('without a credit, the invoices it settles, the oldest first', () => {
        assert.deepEqual(withdrawalParts(99, [], [invoice('i-1', 60), invoice('i-2', 39)]), {
            fromCredit: 0,
            credits: [],
            beyondOpen: [],
            covering: [],
            invoices: [
                { invoiceId: 'i-1', amount: 60 },
                { invoiceId: 'i-2', amount: 39 },
            ],
            unmatched: 0,
        });
    });

    test('the credit first: its open part, then the invoice with the rest', () => {
        assert.deepEqual(withdrawalParts(120, [credit(20, 20)], [invoice('i-1', 100)]), {
            fromCredit: 20,
            credits: [{ creditId: 'c-1', amount: 20 }],
            beyondOpen: [],
            covering: [],
            invoices: [{ invoiceId: 'i-1', amount: 100 }],
            unmatched: 0,
        });
    });

    test('a partial reversal no larger than the credit shrinks the credit alone', () => {
        const parts = withdrawalParts(15, [credit(20, 20)], [invoice('i-1', 100)]);
        assert.deepEqual(parts.credits, [{ creditId: 'c-1', amount: 15 }]);
        assert.deepEqual(parts.invoices, []);
    });

    // A payment of a cancelled invoice leaves a second credit of its own where
    // the replacement does not take all of its share (`SC-PRIC-091`).
    test('several credits of the payment are taken in the order given, each up to what of it is left', () => {
        const parts = withdrawalParts(
            25,
            [credit(10, 10, 'c-1'), credit(30, 30, 'c-2')],
            [invoice('i-1', 100)],
        );
        assert.deepEqual(
            [parts.fromCredit, parts.credits, parts.invoices],
            [
                25,
                [
                    { creditId: 'c-1', amount: 10 },
                    { creditId: 'c-2', amount: 15 },
                ],
                [],
            ],
        );
    });

    test('what of each of them is paid out is told apart, and matches nothing', () => {
        const parts = withdrawalParts(
            50,
            [credit(10, 0, 'c-1'), credit(30, 25, 'c-2')],
            [invoice('i-1', 100)],
        );
        assert.deepEqual(
            [parts.credits, parts.beyondOpen, parts.invoices, parts.unmatched],
            [
                [{ creditId: 'c-2', amount: 25 }],
                [
                    { creditId: 'c-1', amount: 10 },
                    { creditId: 'c-2', amount: 5 },
                ],
                [{ invoiceId: 'i-1', amount: 10 }],
                15,
            ],
        );
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
                withdrawalParts(amount, [credit(20, 20)], [invoice('i-1', 100)]).invoices,
                invoiceShare,
            );
        });
    }

    test('the part of the credit already paid out matches nothing', () => {
        assert.deepEqual(withdrawalParts(120, [credit(20, 5)], [invoice('i-1', 100)]), {
            fromCredit: 20,
            credits: [{ creditId: 'c-1', amount: 5 }],
            beyondOpen: [{ creditId: 'c-1', amount: 15 }],
            covering: [],
            invoices: [{ invoiceId: 'i-1', amount: 100 }],
            unmatched: 15,
        });
        assert.deepEqual(withdrawalParts(120, [credit(20, 0)], [invoice('i-1', 100)]).credits, []);
    });

    test('takes from what of the credit an earlier reversal left', () => {
        const parts = withdrawalParts(30, [credit(10, 10)], [invoice('i-1', 100)]);
        assert.deepEqual(
            [parts.fromCredit, parts.invoices],
            [10, [{ invoiceId: 'i-1', amount: 20 }]],
        );
        assert.equal(withdrawalParts(30, [credit(-5, 10)], [invoice('i-1', 100)]).fromCredit, 0);
    });

    test('what goes beyond everything the payment brought matches nothing', () => {
        const parts = withdrawalParts(150.01, [credit(20, 20)], [invoice('i-1', 100)]);
        assert.equal(parts.unmatched, 30.01);
        assert.deepEqual(withdrawalParts(100.01, [], [invoice('i-1', 100)]).unmatched, 0.01);
    });

    test('passes over an invoice it already opened in full', () => {
        assert.deepEqual(
            withdrawalParts(10, [], [invoice('i-1', 0), invoice('i-2', 10)]).invoices,
            [{ invoiceId: 'i-2', amount: 10 }],
        );
    });

    test('counts in cents, not in binary fractions', () => {
        const parts = withdrawalParts(0.3, [credit(0.1, 0.1)], [invoice('i-1', 0.2)]);
        assert.deepEqual(
            [parts.credits[0]?.amount, parts.invoices[0]?.amount, parts.unmatched],
            [0.1, 0.2, 0],
        );
    });
});

// @requirement SC-PRIC-087 — A credit left for the same invoice covers what a reversal would open again
describe('what credits other payments for the same invoice left cover of a reversal', () => {
    const other = (creditId, open) => ({ creditId, open });

    test('they cover what would open the invoice again, the oldest first', () => {
        assert.deepEqual(
            withdrawalParts(50, [], [invoice('i-1', 100)], [other('c-2', 30), other('c-3', 40)]),
            {
                fromCredit: 0,
                credits: [],
                beyondOpen: [],
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
            const parts = withdrawalParts(30, [], [invoice('i-1', 100)], [other('c-2', open)]);
            assert.deepEqual(
                [parts.covering, parts.invoices],
                [[{ creditId: 'c-2', amount: covered }], opened],
            );
        });
    }

    test('come after the credit the payment itself left', () => {
        const parts = withdrawalParts(
            60,
            [credit(20, 20)],
            [invoice('i-1', 100)],
            [other('c-2', 50)],
        );
        assert.deepEqual(
            [parts.credits, parts.covering, parts.invoices],
            [[{ creditId: 'c-1', amount: 20 }], [{ creditId: 'c-2', amount: 40 }], []],
        );
    });

    test('do not cover the part of that credit already paid out, nor what goes beyond the payment', () => {
        const paidOut = withdrawalParts(
            30,
            [credit(20, 5)],
            [invoice('i-1', 100)],
            [other('c-2', 50)],
        );
        assert.deepEqual(
            [paidOut.covering, paidOut.invoices, paidOut.unmatched],
            [[{ creditId: 'c-2', amount: 10 }], [], 15],
        );
        const beyond = withdrawalParts(150.01, [], [invoice('i-1', 100)], [other('c-2', 200)]);
        assert.deepEqual(
            [beyond.covering, beyond.unmatched],
            [[{ creditId: 'c-2', amount: 100 }], 50.01],
        );
    });

    test('one with nothing open is passed over', () => {
        assert.deepEqual(
            withdrawalParts(10, [], [invoice('i-1', 100)], [other('c-2', 0), other('c-3', 10)])
                .covering,
            [{ creditId: 'c-3', amount: 10 }],
        );
    });

    test('they cover the invoices in the order given', () => {
        const parts = withdrawalParts(
            99,
            [],
            [invoice('i-1', 60), invoice('i-2', 39)],
            [other('c-2', 70)],
        );
        assert.deepEqual(parts.invoices, [{ invoiceId: 'i-2', amount: 29 }]);
    });
});

// @requirement SC-PRIC-090 — Reversals of an invoice end alike in any order, and it is collected again
describe('the covers a credit gave other reversals', () => {
    const entry = (reversalId, kind, amount) => ({ reversalId, kind, amount });

    test("are what reversals other than its own payment's took of it and still hold, in the order given", () => {
        assert.deepEqual(
            coversOf(
                [
                    entry('r-own', 'REVERSAL', 5),
                    entry('r-a', 'REVERSAL', 30),
                    entry('r-b', 'REVERSAL', 10),
                    entry('r-a', 'REVERSAL_TAKEN_BACK', 12.5),
                    entry('r-c', 'REVERSAL', 4),
                    entry('r-c', 'REVERSAL_TAKEN_BACK', 4),
                    entry(null, 'PAYOUT', 7),
                ],
                new Set(['r-own']),
            ),
            [
                { reversalId: 'r-a', amount: 17.5 },
                { reversalId: 'r-b', amount: 10 },
            ],
        );
    });

    /** A withdrawal that took `beyond` of credit c-1 beyond its open part. */
    const parts = (beyond, unmatched) => ({
        beyondOpen: beyond === 0 ? [] : [{ creditId: 'c-1', amount: beyond }],
        unmatched,
    });
    const cover = (reversalId, amount, creditId = 'c-1') => ({ creditId, reversalId, amount });

    for (const [reach, lifted, unmatched, why] of [
        [29.99, [29.99], 0, 'a cent short of the cover lifts what it reaches'],
        [30, [30], 0, 'exactly the cover lifts it whole'],
        [30.01, [30], 0.01, 'a cent beyond it stays unmatched'],
    ]) {
        test(why, () => {
            const result = coversLifted(parts(reach, reach), [cover('r-a', 30)]);
            assert.deepEqual(
                [result.lifted.map((each) => each.amount), result.unmatched],
                [lifted, unmatched],
            );
        });
    }

    test('are reached only by what the withdrawal takes of the credit beyond its open part, the first first', () => {
        const result = coversLifted(parts(30, 30), [cover('r-a', 25), cover('r-b', 25)]);
        assert.deepEqual(result, {
            lifted: [cover('r-a', 25), cover('r-b', 5)],
            unmatched: 0,
        });
        assert.deepEqual(coversLifted(parts(0, 0), [cover('r-a', 25)]), {
            lifted: [],
            unmatched: 0,
        });
    });

    test('are reached only by what was taken beyond the open part of the credit that gave them', () => {
        const result = coversLifted(
            {
                beyondOpen: [
                    { creditId: 'c-1', amount: 20 },
                    { creditId: 'c-2', amount: 5 },
                ],
                unmatched: 25,
            },
            [cover('r-a', 30, 'c-2'), cover('r-b', 30, 'c-3')],
        );
        assert.deepEqual(result, { lifted: [cover('r-a', 5, 'c-2')], unmatched: 20 });
    });

    test("given back, return to the payment's own credit first, then the others, the oldest first", () => {
        const credit = (id, paymentId, at) => ({
            id,
            origin: { kind: 'payment', paymentId },
            createdAt: new Date(at),
        });
        const credits = [
            credit('c-late', 'p-3', '2026-03-02T00:00:00.000Z'),
            credit('c-own', 'p-1', '2026-03-03T00:00:00.000Z'),
            credit('c-early', 'p-2', '2026-03-01T00:00:00.000Z'),
        ];

        assert.deepEqual(
            inWithdrawalOrder(
                [
                    { creditId: 'c-late', amount: 1 },
                    { creditId: 'c-early', amount: 2 },
                    { creditId: 'c-own', amount: 3 },
                ],
                credits,
                'p-1',
            ).map((part) => part.creditId),
            ['c-own', 'c-early', 'c-late'],
        );
    });
});

// @requirement SC-PRIC-091 — An issued invoice is never edited; a cancellation invoice corrects it
describe('what a reversal opened, gathered on the invoice that stands in its chain', () => {
    test('a give-back settles the replacement of a cancelled invoice the reversal opened', () => {
        assert.deepEqual(
            reopenedByStanding(
                [
                    { invoiceId: 'i-cancelled', amount: -50 },
                    { invoiceId: 'i-replacement', amount: 10 },
                    { invoiceId: 'i-other', amount: -20 },
                ],
                new Map([
                    ['i-cancelled', 'i-replacement'],
                    ['i-replacement', 'i-replacement'],
                    ['i-other', 'i-other'],
                ]),
            ),
            [
                { invoiceId: 'i-replacement', left: 40 },
                { invoiceId: 'i-other', left: 20 },
            ],
        );
    });

    test('keeps the invoice where a cancellation left no replacement, and counts in cents', () => {
        assert.deepEqual(
            reopenedByStanding(
                [
                    { invoiceId: 'i-1', amount: -0.1 },
                    { invoiceId: 'i-1', amount: -0.2 },
                ],
                new Map([['i-1', null]]),
            ),
            [{ invoiceId: 'i-1', left: 0.3 }],
        );
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
            [
                Number(row.amount),
                Number(row.fromCredit),
                Number(row.reinstated),
                Number(row.reinstatedToCases),
                row.reinstatedAt,
            ],
            [0, 0, 0, 0, null],
        );
        const record = toSubscriberReversalRecord({
            ...row,
            amount: '120.00',
            fromCredit: '20.00',
            reinstated: '15.00',
            reinstatedToCases: '15.00',
            reinstatedAt: AT,
        });
        assert.deepEqual(
            [
                record.paymentId,
                record.amount,
                record.fromCredit,
                record.reinstated,
                record.reinstatedToCases,
            ],
            ['p-1', 120, 20, 15, 15],
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
        [
            { amount: '10.00', reinstated: '5.00', reinstatedToCases: '5.01', reinstatedAt: AT },
            'covered its cases with more than was given back',
        ],
        [
            { amount: '10.00', reinstated: '5.00', reinstatedToCases: '-0.01', reinstatedAt: AT },
            'covered its cases with a negative part',
        ],
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
