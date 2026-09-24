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
        canceledAt: null,
        canceledEffectiveAt: null,
        createdAt: STARTED,
        updatedAt: STARTED,
        ...overrides,
    };
}

// @requirement SC-BUN-005 — A tenant on a yearly plan chooses the rhythm each add-on is billed in
describe('a bundle booking row becomes a record', () => {
    test('every column is carried over as it is', () => {
        assert.deepEqual(toSubscriptionBundleRecord(row()), row());
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
