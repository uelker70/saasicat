// The bundle booking mapping both adapters share.
//
// `billingCycle` is the column worth pinning: it is text in the canonical
// schema, and a price is chosen by asking whether it is `YEARLY`, so a value
// outside the two would be billed monthly unless the read stops it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toSubscriptionBundleRecord } from '../dist/index.js';

const STARTED = new Date('2026-02-21T00:00:00.000Z');
const PERIOD_END = new Date('2026-02-28T00:00:00.000Z');

function row(overrides = {}) {
    return {
        id: 'booking-1',
        subscriptionId: 'subscription-1',
        bundleVersionId: 'bundle-version-1',
        startedAt: STARTED,
        minimumTermEndsAt: null,
        billingCycle: 'MONTHLY',
        currentPeriodStart: STARTED,
        currentPeriodEnd: PERIOD_END,
        pendingBundleVersionId: null,
        pendingVersionEffectiveAt: null,
        canceledAt: null,
        canceledEffectiveAt: null,
        createdAt: STARTED,
        updatedAt: STARTED,
        ...overrides,
    };
}

/** What `row()` reads as: the same, with no agreement recorded for it. */
const recordOf = (fields) => ({ ...fields, agreement: null, pendingAgreement: null });

// @requirement SC-BUN-005 — A tenant on a yearly plan chooses the rhythm each add-on is billed in
describe('a bundle booking row becomes a record', () => {
    test('every column is carried over as it is', () => {
        assert.deepEqual(toSubscriptionBundleRecord(row()), recordOf(row()));
    });

    test('both rhythms are read', () => {
        assert.equal(
            toSubscriptionBundleRecord(row({ billingCycle: 'YEARLY' })).billingCycle,
            'YEARLY',
        );
        assert.equal(
            toSubscriptionBundleRecord(row({ billingCycle: 'MONTHLY' })).billingCycle,
            'MONTHLY',
        );
    });

    test('a booking made before the billing columns existed reads as null throughout', () => {
        const record = toSubscriptionBundleRecord(
            row({ billingCycle: null, currentPeriodStart: null, currentPeriodEnd: null }),
        );
        assert.equal(record.billingCycle, null);
        assert.equal(record.currentPeriodStart, null);
        assert.equal(record.currentPeriodEnd, null);
    });

    test('a schema without the billing columns reads the same as one holding nulls', () => {
        const {
            billingCycle: _cycle,
            currentPeriodStart: _start,
            currentPeriodEnd: _end,
            ...withoutColumns
        } = row();
        const record = toSubscriptionBundleRecord(withoutColumns);
        assert.equal(record.billingCycle, null);
        assert.equal(record.currentPeriodStart, null);
        assert.equal(record.currentPeriodEnd, null);
    });

    // @requirement SC-BUN-058 — A newer add-on version is taken by naming it, the way its kind says
    test('a switch scheduled for the end of the term is carried over, version and moment', () => {
        const scheduled = row({
            pendingBundleVersionId: 'bundle-version-2',
            pendingVersionEffectiveAt: PERIOD_END,
        });

        assert.deepEqual(toSubscriptionBundleRecord(scheduled), recordOf(scheduled));
    });

    // @requirement SC-CANC-026 — A cancellation is judged by the notice period the subscriber agreed to
    test('what was agreed by the booking and by the switch it scheduled is read from their columns', () => {
        const record = toSubscriptionBundleRecord(
            row({
                agreedTermsVersion: '2026-10',
                agreedCancellationNoticeDays: 14,
                agreedAt: STARTED,
                pendingTermsVersion: '2026-11',
                pendingCancellationNoticeDays: 30,
                pendingAgreedAt: PERIOD_END,
            }),
        );

        assert.deepEqual(record.agreement, {
            termsVersion: '2026-10',
            cancellationNoticeDays: 14,
            agreedAt: STARTED,
        });
        assert.deepEqual(record.pendingAgreement, {
            termsVersion: '2026-11',
            cancellationNoticeDays: 30,
            agreedAt: PERIOD_END,
        });
    });

    // @requirement SC-BUN-058 — A newer add-on version is taken by naming it, the way its kind says
    test('a schema without the columns of a scheduled switch reads as none scheduled', () => {
        const {
            pendingBundleVersionId: _version,
            pendingVersionEffectiveAt: _moment,
            ...withoutColumns
        } = row();
        const record = toSubscriptionBundleRecord(withoutColumns);
        assert.equal(record.pendingBundleVersionId, null);
        assert.equal(record.pendingVersionEffectiveAt, null);
    });

    for (const value of ['yearly', 'monthly', 'WEEKLY', '']) {
        test(`a rhythm of '${value}' stops the read, naming the row`, () => {
            assert.throws(
                () => toSubscriptionBundleRecord(row({ billingCycle: value })),
                (error) =>
                    error.message.includes(
                        `subscription_bundles row 'booking-1' holds billingCycle '${value}'`,
                    ),
            );
        });
    }
});
