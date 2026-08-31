// Which of two configured notice periods a cancellation is measured against.
//
// A plan may be sold both ways, and the two numbers are set apart on purpose —
// fourteen days on a monthly contract, ninety on a yearly one. Reading the
// rhythm off the plan rather than off the contract gives every customer of that
// plan the same answer, and half of them the wrong one. The pure function is
// pinned elsewhere; what is decided here is which rhythm it is handed.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TenantBillingController } from '../dist/billing/index.js';

const NOTICE = { monthly: 14, yearly: 90 };

// Forty days of period left: a fourteen-day notice is served by it, a ninety-day
// one is not. Relative to now, because the controller reads the clock — a fixed
// date would decide this test by how long ago it was written.
const DAY = 24 * 60 * 60 * 1000;
const PERIOD_END = new Date(Date.now() + 40 * DAY);
const PERIOD_START = new Date(Date.now() - 10 * DAY);

const subscription = (billingCycle) => ({
    plan: 'STARTER',
    billingCycle,
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: PERIOD_START,
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    minimumTermUntil: null,
    canceledAt: null,
    canceledEffectiveAt: null,
    billingAnchorDay: PERIOD_END.getUTCDate(),
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    planVersion: null,
    pendingPlanVersion: null,
    pendingPlanVersionEffectiveAt: null,
    pendingPlanVersionAccepted: false,
    pendingPlanVersionAcceptedAt: null,
});

const request = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };

function buildController(billingCycle) {
    const port = {
        calls: [],
        async cancelSubscription(_tenantId, input) {
            this.calls.push(input);
            return {
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.effectiveAt,
                status: 'ACTIVE',
            };
        },
    };
    const controller = new TenantBillingController(
        {
            computeLimits: async () => ({ plan: 'STARTER', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        {
            async preview() {
                return { isImmediate: false, effectiveAt: null, blockers: [] };
            },
        },
        { findForTenant: async () => subscription(billingCycle) },
        { snapshot: async () => ({}) },
        port,
        () => 't1',
        () => 'u1',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        NOTICE,
    );
    return { controller, port };
}

describe('a notice follows the rhythm of the contract', () => {
    // @requirement SC-CANC-007 — The rhythm that decides the notice is the subscription's, not the plan's
    test('one plan, two contracts, two deadlines', async () => {
        const monthly = buildController('MONTHLY');
        const yearly = buildController('YEARLY');

        const onMonthly = await monthly.controller.cancelSubscription(request, {});
        const onYearly = await yearly.controller.cancelSubscription(request, {});

        // Same plan, same period end, same day of asking. Only the rhythm of
        // the contract differs: fourteen days of notice fit inside the forty
        // that are left, ninety do not.
        assert.notDeepEqual(
            onMonthly.canceledEffectiveAt,
            onYearly.canceledEffectiveAt,
            'both contracts on the same plan were owed the same notice',
        );
    });

    // @requirement SC-CANC-007 — The rhythm that decides the notice is the subscription's, not the plan's
    test('the yearly contract is owed the longer of the two', async () => {
        // Which way round matters: swapping the two numbers at the call site
        // would still give two different dates.
        const monthly = buildController('MONTHLY');
        const yearly = buildController('YEARLY');

        const onMonthly = await monthly.controller.cancelSubscription(request, {});
        const onYearly = await yearly.controller.cancelSubscription(request, {});

        assert.ok(
            onYearly.canceledEffectiveAt > onMonthly.canceledEffectiveAt,
            'the ninety-day notice landed no later than the fourteen-day one',
        );
    });
});
