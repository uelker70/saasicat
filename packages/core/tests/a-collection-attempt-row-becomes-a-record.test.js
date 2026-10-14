// The pure parts of collecting an invoice: the key an attempt carries, the
// reasons a second try can pass on, and an attempt row read back by either
// adapter — strictly, since an attempt is what money moved under.

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
    amount: 58.31,
    currency: 'EUR',
    at: AT,
};

/** The row either adapter reads back for `ATTEMPT`, numbered 1. */
const row = (overrides = {}) => ({
    id: 'attempt-1',
    ...invoiceCollectionColumns(ATTEMPT, 1),
    paymentRef: null,
    failureReason: null,
    failureCode: null,
    resolvedAt: null,
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
        const columns = invoiceCollectionColumns(ATTEMPT, 2);

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
        });
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
    ]) {
        test(`refuses ${what}`, () => {
            assert.throws(() => toInvoiceCollectionRecord(row(overrides)), message);
        });
    }
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
