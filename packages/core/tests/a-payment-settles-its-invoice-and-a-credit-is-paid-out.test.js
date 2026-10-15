// The pure parts of what money moved: what a payment settles of its invoice,
// what a credit still owes, how a refund divides across credits, and the rows
// of payments, credits, their entries and refunds read back by either adapter
// — strictly, since every one of them is money.

// @requirement SC-PRIC-083 — A credit is paid out by the operator, and never offset against a later invoice

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    isEndedRefund,
    openOfCredit,
    owedOn,
    paymentSettlement,
    payoutEntryColumns,
    refundEntryColumns,
    refundParts,
    settledAmountOf,
    subscriberPaymentColumns,
    subscriberRefundColumns,
    toSubscriberCreditEntryRecord,
    toSubscriberCreditRecord,
    toSubscriberPaymentRecord,
    toSubscriberRefundRecord,
} from '../dist/index.js';

const AT = new Date('2026-03-04T08:15:00.000Z');
const EARLIER = new Date('2026-02-01T08:15:00.000Z');

describe('what an invoice still owes', () => {
    test('is its total less what is settled against it, to the cent', () => {
        assert.equal(owedOn(58.31, []), 58.31);
        assert.equal(owedOn(58.31, [58.31]), 0);
        assert.equal(owedOn(0.3, [0.1, 0.2]), 0, 'counted in cents, not in binary fractions');
        assert.equal(owedOn(58.31, [58.3]), 0.01);
    });

    test('is negative for an invoice whose total is negative', () => {
        assert.equal(owedOn(-40, []), -40);
    });
});

describe('a payment against what its invoice owes', () => {
    for (const [amount, owed, settles, credits, why] of [
        [58.31, 58.31, 58.31, 0, 'pays it exactly'],
        [58.32, 58.31, 58.31, 0.01, 'one cent beyond it is a credit'],
        [58.3, 58.31, 58.3, 0, 'one cent short settles what it brought'],
        [58.31, 0, 0, 58.31, 'an invoice that owes nothing makes the whole payment a credit'],
        [58.31, -40, 0, 58.31, 'an invoice that owes the subscriber is settled by nothing'],
    ]) {
        test(`${why}`, () => {
            assert.deepEqual(paymentSettlement(amount, owed), { settles, credits });
        });
    }
});

describe('what a credit still owes', () => {
    const refund = (amount) => ({ kind: 'REFUND', amount });

    test('is its amount less what refunds and payouts paid out', () => {
        assert.equal(openOfCredit(40, []), 40);
        assert.equal(openOfCredit(40, [refund(15), { kind: 'PAYOUT', amount: 5 }]), 20);
        assert.equal(openOfCredit(40, [refund(40)]), 0);
    });

    test('takes back what a failed refund gave back', () => {
        assert.equal(openOfCredit(40, [refund(15), { kind: 'REFUND_FAILED', amount: 15 }]), 40);
    });

    test('never goes below nothing', () => {
        assert.equal(openOfCredit(40, [refund(40.01)]), 0);
    });
});

describe('a refund divided across the open credits', () => {
    const credit = (id, origin, createdAt, open) => ({ id, origin, createdAt, open });
    const older = credit('c-older', { kind: 'invoice', invoiceId: 'i-1' }, EARLIER, 10);
    const own = credit('c-own', { kind: 'payment', paymentId: 'p-2' }, AT, 5);
    const newer = credit('c-newer', { kind: 'invoice', invoiceId: 'i-3' }, AT, 20);

    test('takes the credit the refunded payment left first, then the oldest', () => {
        assert.deepEqual(refundParts(12, 'p-2', [newer, older, own]), {
            parts: [
                { creditId: 'c-own', amount: 5 },
                { creditId: 'c-older', amount: 7 },
            ],
            unmatched: 0,
        });
    });

    test('takes the oldest first where the payment left none', () => {
        assert.deepEqual(refundParts(12, 'p-9', [newer, older]), {
            parts: [
                { creditId: 'c-older', amount: 10 },
                { creditId: 'c-newer', amount: 2 },
            ],
            unmatched: 0,
        });
    });

    test('leaves what no credit takes as matching nothing, one cent included', () => {
        assert.deepEqual(refundParts(35.01, 'p-2', [own, older, newer]).unmatched, 0.01);
        assert.deepEqual(refundParts(30, 'p-9', []), { parts: [], unmatched: 30 });
    });

    test('skips a credit that owes nothing', () => {
        const paid = credit('c-paid', { kind: 'payment', paymentId: 'p-2' }, EARLIER, 0);
        assert.deepEqual(refundParts(3, 'p-2', [paid, newer]).parts, [
            { creditId: 'c-newer', amount: 3 },
        ]);
    });

    test('orders credits of one moment by id, so both adapters divide alike', () => {
        const a = credit('c-a', { kind: 'invoice', invoiceId: 'i-a' }, AT, 1);
        const b = credit('c-b', { kind: 'invoice', invoiceId: 'i-b' }, AT, 1);
        assert.deepEqual(refundParts(1, 'p-9', [b, a]).parts, [{ creditId: 'c-a', amount: 1 }]);
    });
});

describe('a payment row', () => {
    const columns = subscriberPaymentColumns(
        {
            invoiceId: 'invoice-1',
            collectionId: 'collection-1',
            gatewayAccount: 'stripe-main',
            provider: 'stripe',
            gatewayRef: 'pi_1',
            amount: 58.31,
            currency: 'EUR',
            at: AT,
        },
        { subscriberId: 'subscriber-1', tenantId: 'tenant-1' },
    );

    test('is written for the subscriber its invoice names, with the amount as written', () => {
        assert.equal(columns.subscriberId, 'subscriber-1');
        assert.equal(columns.tenantId, 'tenant-1');
        assert.equal(columns.amount, '58.31');
        assert.equal(columns.recordedAt, AT);
    });

    test('reads back from either adapter’s amount', () => {
        for (const amount of ['58.31', { toString: () => '58.31' }]) {
            assert.equal(
                toSubscriberPaymentRecord({ ...columns, id: 'p-1', amount }).amount,
                58.31,
            );
        }
    });

    test('refuses an amount that is none', () => {
        assert.throws(
            () => toSubscriberPaymentRecord({ ...columns, id: 'p-1', amount: 'abc' }),
            /subscriber_payments\.amount of p-1 is not an amount/,
        );
    });
});

describe('a settlement row', () => {
    test('takes its amount off what the invoice owes', () => {
        assert.equal(settledAmountOf({ id: 's-1', kind: 'PAYMENT', amount: '58.31' }), 58.31);
    });

    test('of a kind this release does not know stops the read', () => {
        assert.throws(
            () => settledAmountOf({ id: 's-1', kind: 'REVERSAL', amount: '58.31' }),
            /kind 'REVERSAL', which is none of PAYMENT/,
        );
    });
});

describe('a credit row', () => {
    const row = {
        id: 'c-1',
        subscriberId: 'subscriber-1',
        tenantId: 'tenant-1',
        amount: '40.00',
        currency: 'EUR',
        originPaymentId: null,
        originInvoiceId: 'invoice-1',
        createdAt: AT,
    };

    test('reads back with the one place it comes from', () => {
        assert.deepEqual(toSubscriberCreditRecord(row).origin, {
            kind: 'invoice',
            invoiceId: 'invoice-1',
        });
        assert.deepEqual(
            toSubscriberCreditRecord({ ...row, originInvoiceId: null, originPaymentId: 'p-1' })
                .origin,
            { kind: 'payment', paymentId: 'p-1' },
        );
        assert.equal(toSubscriberCreditRecord(row).amount, 40);
    });

    test('naming both places or neither stops the read', () => {
        assert.throws(
            () => toSubscriberCreditRecord({ ...row, originPaymentId: 'p-1' }),
            /names both a payment and an invoice/,
        );
        assert.throws(
            () => toSubscriberCreditRecord({ ...row, originInvoiceId: null }),
            /names neither a payment and an invoice/,
        );
    });
});

describe('a credit entry row', () => {
    const REFUND = { id: 'r-1', gatewayRef: 're_1' };
    const payout = payoutEntryColumns({
        creditId: 'c-1',
        amount: 12.5,
        reference: 'TRF-2026-0042',
        paidOn: '2026-03-03',
        note: 'Account closed at the gateway',
        recordedBy: 'operator-1',
        at: AT,
    });

    test('of a payout carries its reference, its day and who recorded it, and no refund', () => {
        const entry = toSubscriberCreditEntryRecord({ ...payout, id: 'e-1' });
        assert.equal(entry.kind, 'PAYOUT');
        assert.equal(entry.amount, 12.5);
        assert.equal(entry.reference, 'TRF-2026-0042');
        assert.equal(entry.paidOn, '2026-03-03');
        assert.equal(entry.refundId, null);
    });

    test('reads the day back from a Prisma date', () => {
        const entry = toSubscriberCreditEntryRecord({
            ...payout,
            id: 'e-1',
            paidOn: new Date('2026-03-03T00:00:00.000Z'),
        });
        assert.equal(entry.paidOn, '2026-03-03');
    });

    test('of a refund names the refund and its reference at the gateway, and its failure gives the same amount back', () => {
        const taken = refundEntryColumns('c-1', REFUND, 'REFUND', 7, AT);
        const back = refundEntryColumns('c-1', REFUND, 'REFUND_FAILED', 7, AT);
        assert.equal(toSubscriberCreditEntryRecord({ ...taken, id: 'e-2' }).refundId, 'r-1');
        assert.equal(toSubscriberCreditEntryRecord({ ...taken, id: 'e-2' }).reference, 're_1');
        assert.equal(toSubscriberCreditEntryRecord({ ...back, id: 'e-3' }).kind, 'REFUND_FAILED');
    });

    test('a payout naming a refund, or a refund entry naming none, stops the read', () => {
        assert.throws(
            () => toSubscriberCreditEntryRecord({ ...payout, id: 'e-1', refundId: 'r-1' }),
            /is a PAYOUT with a refund/,
        );
        assert.throws(
            () =>
                toSubscriberCreditEntryRecord({
                    ...refundEntryColumns('c-1', REFUND, 'REFUND', 7, AT),
                    id: 'e-2',
                    refundId: null,
                }),
            /is a REFUND without a refund/,
        );
    });

    test('of a kind this release does not know stops the read', () => {
        assert.throws(
            () => toSubscriberCreditEntryRecord({ ...payout, id: 'e-1', kind: 'OFFSET' }),
            /kind 'OFFSET'/,
        );
    });
});

describe('a refund row', () => {
    const reported = {
        gatewayAccount: 'stripe-main',
        gatewayRef: 're_1',
        paymentRef: 'pi_1',
        amount: 7,
        currency: 'EUR',
        status: 'PENDING',
        at: AT,
    };
    const payment = { id: 'p-1', subscriberId: 'subscriber-1' };

    test('is written against the payment it pays back, for that payment’s subscriber', () => {
        const columns = subscriberRefundColumns(reported, payment);
        assert.equal(columns.paymentId, 'p-1');
        assert.equal(columns.subscriberId, 'subscriber-1');
        assert.equal(columns.endedAt, null);
    });

    test('first seen as failed or canceled is written as ended', () => {
        for (const status of ['FAILED', 'CANCELED']) {
            const columns = subscriberRefundColumns({ ...reported, status }, payment);
            assert.equal(columns.endedAt, AT);
            assert.equal(isEndedRefund(status), true);
        }
        assert.equal(isEndedRefund('SUCCEEDED'), false);
        assert.equal(isEndedRefund('PENDING'), false);
    });

    test('reads back, and an end that does not fit its status stops the read', () => {
        const columns = subscriberRefundColumns(reported, payment);
        assert.equal(toSubscriberRefundRecord({ ...columns, id: 'r-1' }).status, 'PENDING');
        assert.throws(
            () => toSubscriberRefundRecord({ ...columns, id: 'r-1', endedAt: AT }),
            /endedAt of r-1 does not fit its status PENDING/,
        );
        assert.throws(
            () => toSubscriberRefundRecord({ ...columns, id: 'r-1', status: 'FAILED' }),
            /endedAt of r-1 does not fit its status FAILED/,
        );
    });
});
