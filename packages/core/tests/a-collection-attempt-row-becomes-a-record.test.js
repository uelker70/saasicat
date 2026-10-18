// The pure parts of collecting an invoice: the key an attempt carries, the
// reasons a second try can pass on, which attempt an invoice's turn writes,
// and an attempt row read back by either adapter — strictly, since an attempt
// is what money moved under.

// @requirement SC-PRIC-034 — A collection retried after an unanswered request never charges twice

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    COLLECTION_FAILURE_REASONS,
    collectionAttemptKey,
    collectionOutcomeColumns,
    collectionStatusOf,
    invoiceCollectionColumns,
    isRetryableCollectionFailure,
    lastCollectionOf,
    plannedCollectionColumns,
    refusesFirstAttempt,
    refusesPlannedAttempt,
    sentCollectionOf,
    toInvoiceCollectionRecord,
} from '../dist/index.js';

const AT = new Date('2026-02-01T05:20:00.000Z');

/** An attempt as a run starts it. */
const ATTEMPT = {
    invoiceId: 'invoice-1',
    gatewayAccount: 'stripe-main',
    paymentMethodId: 'payment-method-1',
    paymentMethodType: 'sepa_debit',
    customerRef: 'cus_1',
    paymentMethodRef: 'pm_1',
    invoiceNumber: 'AHP-2026-000123',
    currency: 'EUR',
    at: AT,
};

/** What the invoice owes as the store reads it in its turn. */
const OWED = 58.31;

/** An attempt as a run plans it, after the invoice's first. */
const PLAN = {
    invoiceId: 'invoice-1',
    after: 1,
    gatewayAccount: 'stripe-main',
    paymentMethodId: 'payment-method-1',
    paymentMethodType: 'sepa_debit',
    customerRef: 'cus_1',
    paymentMethodRef: 'pm_1',
    invoiceNumber: 'AHP-2026-000123',
    currency: 'EUR',
    collectOn: '2026-03-01',
};

/** What a store keeps beside the columns an attempt is written with. */
const UNSETTLED = {
    paymentRef: null,
    failureReason: null,
    failureCode: null,
    resolvedAt: null,
    announcedAt: null,
    followedUpAt: null,
};

/** The row either adapter reads back for `ATTEMPT`, numbered 1. */
const row = (overrides = {}) => ({
    id: 'attempt-1',
    ...invoiceCollectionColumns(ATTEMPT, 1, OWED),
    ...UNSETTLED,
    ...overrides,
});

/** The row either adapter reads back for `PLAN`, numbered 2. */
const plannedRow = (overrides = {}) => ({
    id: 'attempt-2',
    ...plannedCollectionColumns(PLAN, 2, OWED),
    ...UNSETTLED,
    ...overrides,
});

describe('the key of a collection attempt', () => {
    test('names the invoice and the attempt, the same however often it is asked for', () => {
        assert.equal(collectionAttemptKey('invoice-1', 1), 'saasicat:collect:invoice-1:1');
        assert.equal(collectionAttemptKey('invoice-1', 1), collectionAttemptKey('invoice-1', 1));
        assert.notEqual(collectionAttemptKey('invoice-1', 2), collectionAttemptKey('invoice-1', 1));
    });

    for (const attempt of [0, -1, 1.5, Number.NaN]) {
        test(`counts from 1: ${attempt} is refused`, () => {
            assert.throws(() => collectionAttemptKey('invoice-1', attempt), RangeError);
        });
    }
});

describe('a second try', () => {
    test('can pass where funds were short or a refusal named no cause, and nowhere else', () => {
        assert.deepEqual(COLLECTION_FAILURE_REASONS.filter(isRetryableCollectionFailure), [
            'insufficient-funds',
            'declined',
        ]);
    });
});

describe('an attempt row', () => {
    test('is written as submitted, under its key, with the amount as two-place text', () => {
        const columns = invoiceCollectionColumns(ATTEMPT, 2, OWED);

        assert.deepEqual(columns, {
            invoiceId: 'invoice-1',
            attempt: 2,
            attemptKey: 'saasicat:collect:invoice-1:2',
            gatewayAccount: 'stripe-main',
            paymentMethodId: 'payment-method-1',
            paymentMethodType: 'sepa_debit',
            customerRef: 'cus_1',
            paymentMethodRef: 'pm_1',
            invoiceNumber: 'AHP-2026-000123',
            amount: '58.31',
            currency: 'EUR',
            status: 'SUBMITTED',
            submittedAt: AT,
            heldAt: AT,
            collectOn: null,
        });
    });

    test('planned is written for its day, with nothing sent and nothing held', () => {
        const columns = plannedCollectionColumns(PLAN, 2, OWED);

        assert.deepEqual(
            [
                columns.attemptKey,
                columns.status,
                columns.collectOn,
                columns.submittedAt,
                columns.heldAt,
            ],
            ['saasicat:collect:invoice-1:2', 'SCHEDULED', '2026-03-01', null, null],
        );
        assert.ok(!('after' in columns), 'the number it follows was written as a column');
    });

    test('planned reads back with its day, from a Prisma date or a Drizzle text', () => {
        for (const collectOn of ['2026-03-01', new Date('2026-03-01T00:00:00.000Z')]) {
            const record = toInvoiceCollectionRecord(plannedRow({ collectOn }));

            assert.deepEqual(
                [record.status, record.collectOn, record.submittedAt, record.heldAt],
                ['SCHEDULED', '2026-03-01', null, null],
            );
        }
    });

    test('withdrawn before it left reads back without a moment it was sent at', () => {
        const record = toInvoiceCollectionRecord(
            plannedRow({ status: 'WITHDRAWN', resolvedAt: AT }),
        );

        assert.deepEqual(
            [record.status, record.submittedAt, record.resolvedAt],
            ['WITHDRAWN', null, AT],
        );
    });

    test('reads back from either adapter’s shape: a numeric string, or a Prisma decimal', () => {
        for (const amount of ['58.31', { toString: () => '58.31' }]) {
            const record = toInvoiceCollectionRecord(row({ amount }));

            assert.equal(record.amount, 58.31);
            assert.equal(record.status, 'SUBMITTED');
            assert.equal(record.paymentMethodType, 'sepa_debit');
        }
    });

    for (const [what, overrides, message] of [
        ['a status nothing writes', { status: 'DONE' }, /holds status 'DONE'/],
        [
            'a payment method type nothing collects',
            { paymentMethodType: 'cash' },
            /holds paymentMethodType 'cash'/,
        ],
        [
            'a failure reason nothing names',
            { failureReason: 'bad-luck' },
            /holds failureReason 'bad-luck'/,
        ],
        ['an amount that is not one', { amount: 'n/a' }, /amount of attempt-1 is not an amount/],
        ['an amount that is missing', { amount: null }, /amount of attempt-1 is not an amount/],
        [
            'a sent attempt without the moment it was sent',
            { submittedAt: null },
            /submittedAt and heldAt of attempt-1 do not fit its status SUBMITTED/,
        ],
        [
            'a sent attempt without a hold',
            { heldAt: null },
            /submittedAt and heldAt of attempt-1 do not fit its status SUBMITTED/,
        ],
        ['a day that is not one', { collectOn: '1 March' }, /collectOn of attempt-1 is not a day/],
    ]) {
        test(`refuses ${what}`, () => {
            assert.throws(() => toInvoiceCollectionRecord(row(overrides)), message);
        });
    }

    for (const [what, overrides, message] of [
        [
            'a planned attempt without its day',
            { collectOn: null },
            /collectOn of attempt-2 is missing/,
        ],
        [
            'a planned attempt sent at a moment',
            { submittedAt: AT, heldAt: AT },
            /do not fit its status SCHEDULED/,
        ],
    ]) {
        test(`refuses ${what}`, () => {
            assert.throws(() => toInvoiceCollectionRecord(plannedRow(overrides)), message);
        });
    }

    test('one that left is read as sent, and a planned one is refused as such', () => {
        const sent = sentCollectionOf(toInvoiceCollectionRecord(row()));

        assert.deepEqual([sent.submittedAt, sent.heldAt], [AT, AT]);
        assert.throws(
            () => sentCollectionOf(toInvoiceCollectionRecord(plannedRow())),
            /saasicat:collect:invoice-1:2 has not been sent/,
        );
    });
});

describe('the attempt an invoice’s turn writes', () => {
    const attempts = (...statuses) =>
        statuses.map((status, index) => ({ attempt: index + 1, status }));

    test('is numbered after the last, from 1', () => {
        assert.equal(lastCollectionOf([]), 0);
        assert.equal(
            lastCollectionOf([
                { attempt: 2, status: 'FAILED' },
                { attempt: 1, status: 'FAILED' },
            ]),
            2,
        );
    });

    test('is the first only where the invoice has none, whatever became of an earlier one', () => {
        assert.equal(refusesFirstAttempt([]), false);
        for (const status of [
            'SCHEDULED',
            'SUBMITTED',
            'PENDING',
            'SUCCEEDED',
            'FAILED',
            'WITHDRAWN',
        ]) {
            assert.equal(refusesFirstAttempt(attempts(status)), true, status);
        }
    });

    test('is planned after the attempt it follows, where none is open or succeeded', () => {
        assert.equal(refusesPlannedAttempt([], 0), false);
        assert.equal(refusesPlannedAttempt(attempts('FAILED'), 1), false);
        assert.equal(refusesPlannedAttempt(attempts('FAILED', 'WITHDRAWN'), 2), false);
        for (const status of ['SCHEDULED', 'SUBMITTED', 'PENDING', 'SUCCEEDED']) {
            assert.equal(refusesPlannedAttempt(attempts('FAILED', status), 2), true, status);
        }
    });

    test('is not planned from attempts read before another came', () => {
        assert.equal(refusesPlannedAttempt(attempts('FAILED', 'FAILED'), 1), true);
        assert.equal(refusesPlannedAttempt(attempts('FAILED'), 0), true);
    });
});

describe('an outcome', () => {
    test('collected settles the attempt at its moment, with the gateway’s reference', () => {
        assert.deepEqual(
            collectionOutcomeColumns({ status: 'succeeded', paymentRef: 'pi_1' }, AT),
            {
                status: 'SUCCEEDED',
                paymentRef: 'pi_1',
                failureReason: null,
                failureCode: null,
                resolvedAt: AT,
            },
        );
    });

    test('on its way leaves it open', () => {
        assert.deepEqual(collectionOutcomeColumns({ status: 'pending', paymentRef: 'pi_1' }, AT), {
            status: 'PENDING',
            paymentRef: 'pi_1',
            failureReason: null,
            failureCode: null,
            resolvedAt: null,
        });
    });

    test('failed settles it with the reason and the gateway’s code', () => {
        const failed = {
            status: 'failed',
            paymentRef: null,
            reason: 'mandate-invalid',
            gatewayCode: 'debit_not_authorized',
        };

        assert.deepEqual(collectionOutcomeColumns(failed, AT), {
            status: 'FAILED',
            paymentRef: null,
            failureReason: 'mandate-invalid',
            failureCode: 'debit_not_authorized',
            resolvedAt: AT,
        });
        assert.equal(collectionStatusOf(failed), 'FAILED');
    });
});
