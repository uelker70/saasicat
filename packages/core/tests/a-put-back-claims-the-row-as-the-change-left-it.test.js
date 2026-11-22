// A plan change whose contract cannot be written is put back — but only over
// the row as that change left it. What the change left is derived here from
// what was read before it and what it was written with, by the rules every
// adapter writes by; the persistence contract proves the adapters claim it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    NO_SCHEDULED_CHANGE,
    columnsClaimedByPutBack,
    subscriptionAsChanged,
} from '../dist/index.js';

const SCHEDULED = {
    pendingPlan: 'STARTER',
    pendingBillingCycle: 'YEARLY',
    pendingEffectiveAt: new Date('2026-07-31T00:00:00.000Z'),
    pendingChangeVersionId: null,
    pendingTermsVersion: '2026-04',
    pendingCancellationNoticeDays: 30,
    pendingAgreedAt: new Date('2026-04-02T08:00:00.000Z'),
};

/** STARTER, monthly, past due, billed on the 31st, with a change of rhythm scheduled. */
const BEFORE = {
    plan: 'STARTER',
    billingCycle: 'MONTHLY',
    status: 'PAST_DUE',
    currentPeriodStart: new Date('2026-06-30T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-07-31T00:00:00.000Z'),
    billingAnchorDay: 31,
    scheduledChange: SCHEDULED,
};

/** A change to STANDARD that opens no window and leaves the status. */
const STANDARD = {
    planId: 'STANDARD',
    cycle: 'MONTHLY',
    nextStatus: null,
    periodStart: null,
    periodEnd: null,
};

// @requirement SC-CHG-011 — A decision taken against one state is not written into another
describe('the subscription as a plan change leaves it', () => {
    test('names the plan and rhythm the change wrote', () => {
        const after = subscriptionAsChanged(BEFORE, { ...STANDARD, cycle: 'YEARLY' });

        assert.deepEqual([after.plan, after.billingCycle], ['STANDARD', 'YEARLY']);
    });

    test('holds the status the change set, or the one it found', () => {
        assert.equal(subscriptionAsChanged(BEFORE, STANDARD).status, 'PAST_DUE');
        assert.equal(
            subscriptionAsChanged(BEFORE, { ...STANDARD, nextStatus: 'ACTIVE' }).status,
            'ACTIVE',
        );
    });

    test('holds the window the change opened, billed on the day it opened', () => {
        const after = subscriptionAsChanged(BEFORE, {
            ...STANDARD,
            periodStart: new Date('2026-07-10T00:00:00.000Z'),
            periodEnd: new Date('2026-08-10T00:00:00.000Z'),
        });

        assert.deepEqual(
            [
                after.currentPeriodStart.toISOString(),
                after.currentPeriodEnd.toISOString(),
                after.billingAnchorDay,
            ],
            ['2026-07-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z', 10],
        );
    });

    test('holds the window and the billing day it found where it opened none', () => {
        const after = subscriptionAsChanged(BEFORE, STANDARD);

        assert.deepEqual(
            [after.currentPeriodStart, after.currentPeriodEnd, after.billingAnchorDay],
            [BEFORE.currentPeriodStart, BEFORE.currentPeriodEnd, 31],
        );
    });

    test('has no change scheduled, unless it kept the one it found', () => {
        assert.deepEqual(
            subscriptionAsChanged(BEFORE, STANDARD).scheduledChange,
            NO_SCHEDULED_CHANGE,
        );
        assert.deepEqual(
            subscriptionAsChanged(BEFORE, { ...STANDARD, keepsPendingChange: true })
                .scheduledChange,
            // A change of rhythm on the plan left follows the subscription.
            { ...SCHEDULED, pendingPlan: 'STANDARD' },
        );
    });
});

// @requirement SC-CHG-011 — A decision taken against one state is not written into another
describe('the columns a put-back claims the row by', () => {
    const putBack = (asChanged) => ({
        status: BEFORE.status,
        currentPeriodStart: BEFORE.currentPeriodStart,
        currentPeriodEnd: BEFORE.currentPeriodEnd,
        billingAnchorDay: BEFORE.billingAnchorDay,
        scheduledChange: BEFORE.scheduledChange,
        asChanged,
    });

    test('are every column it writes, each as the change left it', () => {
        const asChanged = subscriptionAsChanged(BEFORE, { ...STANDARD, nextStatus: 'ACTIVE' });

        assert.deepEqual(columnsClaimedByPutBack(putBack(asChanged)), {
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
            status: 'ACTIVE',
            currentPeriodStart: BEFORE.currentPeriodStart,
            currentPeriodEnd: BEFORE.currentPeriodEnd,
            billingAnchorDay: 31,
            ...NO_SCHEDULED_CHANGE,
        });
    });

    test('leave out a billing day nothing says, where the read did not carry it', () => {
        const { billingAnchorDay, ...unread } = BEFORE;
        assert.equal(billingAnchorDay, 31);

        const claimed = columnsClaimedByPutBack(putBack(subscriptionAsChanged(unread, STANDARD)));

        assert.equal(claimed.billingAnchorDay, undefined);
    });
});
