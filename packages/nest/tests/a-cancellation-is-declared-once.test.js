import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TenantBillingController, computeNextPeriod } from '../dist/billing/index.js';

// Two things a cancellation must survive: being repeated, and being older than
// the fields that describe it.
//
// Repeating it used to move it. With a notice period configured, running the
// decision again against a later `now` lands it a whole period further out — an
// on-time declaration landing January 2027, retried after the deadline, becomes
// January 2028. The customer pressed the same button twice and bought a year.
//
// And a row written before `canceledAt` and `canceledEffectiveAt` separated
// carries the effective date in the first and null in the second. A renewal
// reading only the second rolls that subscription into another paid term, and
// the next one, forever — a defect nobody notices from the inside, because
// nothing looks broken except the invoice.

const CANCELLED = {
    plan: 'STARTER',
    billingCycle: 'YEARLY',
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: new Date('2026-01-01'),
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2027-01-01'),
    minimumTermUntil: new Date('2027-01-01'),
    canceledAt: new Date('2026-03-01'),
    canceledEffectiveAt: new Date('2027-01-01'),
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    planVersion: null,
    pendingPlanVersion: null,
    pendingPlanVersionEffectiveAt: null,
    pendingPlanVersionAccepted: false,
    pendingPlanVersionAcceptedAt: null,
};

function buildController(subscription, writePort) {
    return new TenantBillingController(
        {
            computeLimits: async () => ({ plan: 'STARTER', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        {
            async preview() {
                return { isImmediate: false, effectiveAt: null, blockers: [] };
            },
        },
        { findForTenant: async () => subscription },
        { snapshot: async () => ({}) },
        writePort,
        () => 't1',
        () => 'u1',
    );
}

function writePort() {
    return {
        calls: [],
        async cancelSubscription(tenantId, input) {
            this.calls.push(input);
            return {
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.effectiveAt,
                status: 'ACTIVE',
            };
        },
    };
}

const request = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };

describe('cancelling twice does not move the date', () => {
    test('the second request writes nothing and returns the first answer', async () => {
        const port = writePort();
        const controller = buildController(CANCELLED, port);

        const result = await controller.cancelSubscription(request, {});

        assert.equal(port.calls.length, 0, 'a second cancellation reached the store');
        assert.deepEqual(result.canceledEffectiveAt, new Date('2027-01-01'));
        assert.equal(result.alreadyCanceled, true);
    });

    test('a first cancellation still writes', async () => {
        // The premise: if the guard fired for everything, the case above would
        // pass against a route that never cancels anything at all.
        const port = writePort();
        const controller = buildController(
            { ...CANCELLED, canceledAt: null, canceledEffectiveAt: null },
            port,
        );

        const result = await controller.cancelSubscription(request, {});

        assert.equal(port.calls.length, 1);
        assert.equal(result.alreadyCanceled, false);
    });
});

describe('what a repeat may say about the first cancellation', () => {
    // The date is stored, so the repeat reports it. The three fields that
    // EXPLAIN that date are not: the decision was taken once, against a `now`
    // that has passed. Deriving them from the effective date tells the wrong
    // story exactly where it matters — a declaration that landed a period late
    // has an earlier term end and `afterNoticeDeadline: true`, and the repeat
    // would report it as on time with the later date as its term end.
    test('the date, and nothing it cannot know', async () => {
        const controller = buildController(CANCELLED, writePort());

        const result = await controller.cancelSubscription(request, {});

        assert.deepEqual(result.canceledEffectiveAt, new Date('2027-01-01'));
        assert.equal(result.termEndsAt, null);
        assert.equal(result.noticeDeadline, null);
        assert.equal(result.afterNoticeDeadline, null);
    });

    test('while a first cancellation explains itself in full', async () => {
        // The premise: null means "not recomputed", not "this route stopped
        // saying it".
        const controller = buildController(
            { ...CANCELLED, canceledAt: null, canceledEffectiveAt: null },
            writePort(),
        );

        const result = await controller.cancelSubscription(request, {});

        assert.notEqual(result.termEndsAt, null);
        assert.equal(result.afterNoticeDeadline, false);
    });
});

describe('a cancellation older than the fields that describe it', () => {
    const legacy = {
        currentPeriodEnd: new Date('2026-04-01'),
        billingCycle: 'MONTHLY',
        // What the old adapter wrote: the effective date, in the only field
        // there was.
        canceledAt: new Date('2026-04-01'),
        canceledEffectiveAt: null,
    };

    test('stops the renewal', () => {
        assert.equal(computeNextPeriod(legacy, new Date('2026-04-02')), null);
    });

    test('and a repeat of it is recognised as one', async () => {
        const port = writePort();
        const controller = buildController(
            { ...CANCELLED, canceledAt: new Date('2027-01-01'), canceledEffectiveAt: null },
            port,
        );

        const result = await controller.cancelSubscription(request, {});

        assert.equal(port.calls.length, 0);
        assert.equal(result.alreadyCanceled, true);
    });
});
