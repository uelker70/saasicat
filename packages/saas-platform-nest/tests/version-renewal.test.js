import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    clearPendingPlanVersionFields,
    computeNextPeriod,
    decideRenewal,
} from '../dist/billing/index.js';

const NOW = new Date('2026-05-08T12:00:00Z');

describe('decideRenewal', () => {
    test('SKIP when no pending version', () => {
        assert.equal(
            decideRenewal(
                {
                    pendingPlanVersionId: null,
                    pendingPlanVersionEffectiveAt: null,
                    pendingPlanVersionAccepted: false,
                    pendingPlanVersionNonRegressive: true,
                },
                NOW,
            ),
            'SKIP',
        );
    });

    test('SKIP when EffectiveAt is in the future', () => {
        assert.equal(
            decideRenewal(
                {
                    pendingPlanVersionId: 'pv-2',
                    pendingPlanVersionEffectiveAt: new Date('2026-06-01'),
                    pendingPlanVersionAccepted: false,
                    pendingPlanVersionNonRegressive: true,
                },
                NOW,
            ),
            'SKIP',
        );
    });

    test('ROLL_FORWARD when nonRegressive=true', () => {
        assert.equal(
            decideRenewal(
                {
                    pendingPlanVersionId: 'pv-2',
                    pendingPlanVersionEffectiveAt: new Date('2026-04-01'),
                    pendingPlanVersionAccepted: false,
                    pendingPlanVersionNonRegressive: true,
                },
                NOW,
            ),
            'ROLL_FORWARD',
        );
    });

    test('ROLL_FORWARD when accepted=true (even if regressive)', () => {
        assert.equal(
            decideRenewal(
                {
                    pendingPlanVersionId: 'pv-2',
                    pendingPlanVersionEffectiveAt: new Date('2026-04-01'),
                    pendingPlanVersionAccepted: true,
                    pendingPlanVersionNonRegressive: false,
                },
                NOW,
            ),
            'ROLL_FORWARD',
        );
    });

    test('CLEAR_PENDING when regressive + not accepted (variant B)', () => {
        assert.equal(
            decideRenewal(
                {
                    pendingPlanVersionId: 'pv-2',
                    pendingPlanVersionEffectiveAt: new Date('2026-04-01'),
                    pendingPlanVersionAccepted: false,
                    pendingPlanVersionNonRegressive: false,
                },
                NOW,
            ),
            'CLEAR_PENDING',
        );
    });
});

describe('clearPendingPlanVersionFields', () => {
    test('returns all pending fields as null/false', () => {
        const fields = clearPendingPlanVersionFields();
        assert.equal(fields.pendingPlanVersionId, null);
        assert.equal(fields.pendingPlanVersionEffectiveAt, null);
        assert.equal(fields.pendingPlanVersionAccepted, false);
        assert.equal(fields.pendingPlanVersionAcceptedAt, null);
        assert.equal(fields.pendingPlanVersionAcceptedByUserId, null);
        assert.equal(fields.pendingPlanVersionNotifiedAt, null);
        assert.equal(fields.pendingPlanVersionReminderSentAt, null);
    });
});

describe('computeNextPeriod', () => {
    test('null when canceledAt set', () => {
        assert.equal(
            computeNextPeriod(
                {
                    currentPeriodEnd: new Date('2026-04-01'),
                    billingCycle: 'MONTHLY',
                    canceledAt: new Date('2026-04-15'),
                },
                NOW,
            ),
            null,
        );
    });

    test('null when currentPeriodEnd null (Trial)', () => {
        assert.equal(
            computeNextPeriod(
                { currentPeriodEnd: null, billingCycle: 'YEARLY', canceledAt: null },
                NOW,
            ),
            null,
        );
    });

    test('null when currentPeriodEnd is in the future', () => {
        assert.equal(
            computeNextPeriod(
                {
                    currentPeriodEnd: new Date('2026-06-01'),
                    billingCycle: 'MONTHLY',
                    canceledAt: null,
                },
                NOW,
            ),
            null,
        );
    });

    test('rolls MONTHLY period +1 month (daily cron, periodEnd 1 day before now)', () => {
        // periodEndAfter iterates until the result is > `now`. With a
        // daily cron, periodEnd is typically 1 day before now → next
        // period = oldEnd + 1 cycle.
        const result = computeNextPeriod(
            {
                currentPeriodEnd: new Date('2026-05-07T12:00:00Z'),
                billingCycle: 'MONTHLY',
                canceledAt: null,
            },
            NOW,
        );
        assert.notEqual(result, null);
        assert.equal(result.currentPeriodStart.toISOString(), '2026-05-07T12:00:00.000Z');
        assert.equal(result.currentPeriodEnd.toISOString(), '2026-06-07T12:00:00.000Z');
    });

    test('rolls YEARLY period +1 year', () => {
        const result = computeNextPeriod(
            {
                currentPeriodEnd: new Date('2026-05-07T12:00:00Z'),
                billingCycle: 'YEARLY',
                canceledAt: null,
            },
            NOW,
        );
        assert.notEqual(result, null);
        assert.equal(result.currentPeriodEnd.toISOString(), '2027-05-07T12:00:00.000Z');
    });

    test('cron lag: with several missed periods, jumps to the next future period', () => {
        // If the cron was down for a while and periodEnd is already 2
        // months old, the function should jump directly to the period
        // after next (>= now). Otherwise the next cron run on the
        // following day would roll again.
        const result = computeNextPeriod(
            {
                currentPeriodEnd: new Date('2026-03-01T00:00:00Z'),
                billingCycle: 'MONTHLY',
                canceledAt: null,
            },
            NOW,
        );
        assert.notEqual(result, null);
        assert.ok(result.currentPeriodEnd > NOW);
    });
});
