// The rules that decide what follows a failed collection, read without a run:
// whether the payment method is charged once more, on which day, and the day a
// direct debit announced again is collected.

// @requirement SC-PRIC-080 — A failed collection is tried once more, and the subscriber is told of every failure
// @requirement SC-PRIC-028 — A direct debit is announced before it is collected

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    COLLECTION_RETRY_AFTER_DAYS,
    announcedCollectionDay,
    chargedAgainOn,
    isChargedAgain,
} from '../dist/index.js';

/** An attempt of one invoice, failed for `reason` with `paymentMethodId` unless `status` says otherwise. */
const attempt = (
    id,
    { status = 'FAILED', reason = 'insufficient-funds', paymentMethodId = 'pm-a' } = {},
) => ({
    id,
    status,
    failureReason: status === 'FAILED' ? reason : null,
    paymentMethodId,
});

describe('a payment method that failed', () => {
    test('is charged once more where funds were short or a refusal named no cause', () => {
        for (const reason of ['insufficient-funds', 'declined']) {
            const failed = attempt('a1', { reason });
            assert.equal(isChargedAgain(failed, [failed]), true, reason);
        }
    });

    test('is not charged again for a reason that cannot pass', () => {
        for (const reason of [
            'authentication-required',
            'payment-method-unusable',
            'mandate-invalid',
            'other',
        ]) {
            const failed = attempt('a1', { reason });
            assert.equal(isChargedAgain(failed, [failed]), false, reason);
        }
    });

    test('is not charged a third time: one earlier failure with it ends its tries', () => {
        const first = attempt('a1');
        const second = attempt('a2');

        assert.equal(isChargedAgain(second, [first, second]), false);
    });

    test('that replaced one which failed gets its own second try', () => {
        const first = attempt('a1', { paymentMethodId: 'pm-a' });
        const replacement = attempt('a2', { paymentMethodId: 'pm-b' });

        assert.equal(isChargedAgain(replacement, [first, replacement]), true);
    });

    test('a withdrawn plan with it does not count as a try', () => {
        const withdrawn = attempt('a1', { status: 'WITHDRAWN' });
        const failed = attempt('a2');

        assert.equal(isChargedAgain(failed, [withdrawn, failed]), true);
    });

    test('an attempt that did not fail is not followed by another', () => {
        const succeeded = attempt('a1', { status: 'SUCCEEDED' });

        assert.equal(isChargedAgain(succeeded, [succeeded]), false);
    });
});

describe('the day a card is charged again', () => {
    for (const [failedOn, expected] of [
        ['2026-02-01', '2026-02-08'],
        ['2026-02-25', '2026-03-04'],
        ['2026-12-28', '2027-01-04'],
    ]) {
        test(`is ${COLLECTION_RETRY_AFTER_DAYS} days after a failure on ${failedOn}: ${expected}`, () => {
            assert.equal(chargedAgainOn(failedOn), expected);
        });
    }
});

describe('the day a direct debit announced again is collected', () => {
    test('is the lead time after its announcement where that is later than the day planned', () => {
        assert.equal(announcedCollectionDay('2026-02-22', '2026-02-15', 14), '2026-03-01');
    });

    test('is the day planned where the lead time ends before it', () => {
        assert.equal(announcedCollectionDay('2026-03-10', '2026-02-15', 14), '2026-03-10');
    });

    test('is the day planned where the lead time ends on it', () => {
        assert.equal(announcedCollectionDay('2026-03-01', '2026-02-15', 14), '2026-03-01');
    });

    test('counts the lead time across a month and a year', () => {
        assert.equal(announcedCollectionDay('2026-12-20', '2026-12-25', 14), '2027-01-08');
    });
});
