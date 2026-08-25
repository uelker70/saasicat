import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PendingPlanMaterializationService,
    TenantBillingController,
} from '../dist/billing/index.js';

// A cancellation is a boundary, and two writes used to cross it.
//
// A plan change and a cancellation are two decisions about one subscription,
// and neither could see the other: the route read no cancellation date, and the
// record the materialisation service is handed did not carry one. The result
// was not a wrong date but a wrong contract. An upgrade on a subscription that
// had already ended was applied and prorated — charged for — while entitlement
// resolution, which does read the cancellation, granted nothing. And a change
// scheduled before the customer cancelled came due afterwards and restarted the
// billing period on a term that was over.
//
// The rule is one sentence: nothing may start after the end, and nothing may
// sell a period the end cuts short. A cancellation that has NOT landed declines
// nothing — a customer who bought a further period by cancelling late may still
// choose the plan they spend it on.

const DAY = 86_400_000;

const SUBSCRIPTION = {
    plan: 'STARTER',
    billingCycle: 'YEARLY',
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: new Date('2026-01-01'),
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date(Date.now() + 30 * DAY),
    minimumTermUntil: new Date(Date.now() + 30 * DAY),
    canceledAt: null,
    canceledEffectiveAt: null,
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    planVersion: null,
    pendingPlanVersion: null,
    pendingPlanVersionEffectiveAt: null,
    pendingPlanVersionAccepted: false,
    pendingPlanVersionAcceptedAt: null,
};

function writePort() {
    return {
        immediate: [],
        async changePlanImmediate(tenantId, input) {
            this.immediate.push(input);
            return { plan: input.planId, billingCycle: input.cycle };
        },
        async schedulePlanChange(tenantId, input) {
            return { plan: input.planId, billingCycle: input.cycle };
        },
        async cancelSubscription() {
            return { canceledAt: null, canceledEffectiveAt: null, status: 'ACTIVE' };
        },
    };
}

function buildController(subscription, port, preview) {
    return new TenantBillingController(
        {
            computeLimits: async () => ({ plan: 'STARTER', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        {
            async preview() {
                return preview;
            },
        },
        { findForTenant: async () => subscription },
        { snapshot: async () => ({}) },
        port,
        () => 't1',
        () => 'u1',
    );
}

const IMMEDIATE_UPGRADE = { isImmediate: true, effectiveAt: null, blockers: [] };
const request = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };
const changeTo = (controller) =>
    controller.changePlan(request, { plan: 'STANDARD', billingCycle: 'YEARLY' });

describe('a subscription that has ended', () => {
    const ended = {
        ...SUBSCRIPTION,
        canceledAt: new Date(Date.now() - 90 * DAY),
        canceledEffectiveAt: new Date(Date.now() - 60 * DAY),
    };

    test('refuses a plan change instead of charging for one', async () => {
        // The upgrade would have been prorated and billed, while entitlement
        // resolution granted nothing — it reads the same cancellation.
        const port = writePort();

        await assert.rejects(
            changeTo(buildController(ended, port, IMMEDIATE_UPGRADE)),
            (err) => err.getResponse?.().code === 'SUBSCRIPTION_ENDED',
        );
        assert.equal(port.immediate.length, 0, 'the plan was changed anyway');
    });

    test('while a running one still changes plans', async () => {
        // The premise: the refusal is about the end, not about plan changes.
        const port = writePort();

        await changeTo(buildController(SUBSCRIPTION, port, IMMEDIATE_UPGRADE));

        assert.equal(port.immediate.length, 1);
    });
});

describe('a cancellation still to come', () => {
    const ending = {
        ...SUBSCRIPTION,
        canceledAt: new Date(),
        canceledEffectiveAt: new Date(Date.now() + 30 * DAY),
    };

    test('lets the plan change, and does not sell a term it cuts short', async () => {
        // A fresh window is a fresh term. The subscription ends on a date this
        // change does not move, so opening one sells a year the customer loses
        // eleven months into.
        const port = writePort();

        await changeTo(buildController(ending, port, IMMEDIATE_UPGRADE));

        assert.equal(port.immediate.length, 1, 'the change was refused');
        assert.equal(port.immediate[0].periodStart, null);
        assert.equal(port.immediate[0].periodEnd, null);
    });

    test('while an uncancelled subscription does get a fresh term', async () => {
        // The premise: without a cancellation the immediate branch still opens
        // the window it is there to open.
        const port = writePort();

        await changeTo(buildController(SUBSCRIPTION, port, IMMEDIATE_UPGRADE));

        assert.notEqual(port.immediate[0].periodStart, null);
        assert.notEqual(port.immediate[0].periodEnd, null);
    });
});

describe('a change scheduled before the customer cancelled', () => {
    const dueChange = (overrides) => ({
        tenantId: 't1',
        pendingPlan: 'STANDARD',
        pendingBillingCycle: 'YEARLY',
        canceledAt: null,
        canceledEffectiveAt: null,
        ...overrides,
    });

    function materialize(change) {
        const port = writePort();
        const service = new PendingPlanMaterializationService(
            { findDuePendingPlanChanges: async () => [change] },
            port,
            { computeLimits: async () => ({}), invalidateTenant() {} },
        );
        return service.materializeDuePlanChanges(new Date()).then((r) => ({ ...r, port }));
    }

    test('is declined once the cancellation has taken effect', async () => {
        // Applying it restarts the billing period and runs the follow-up hooks
        // — a contract freeze among them — on a term that is over.
        const { applied, port } = await materialize(
            dueChange({
                canceledAt: new Date(Date.now() - 90 * DAY),
                canceledEffectiveAt: new Date(Date.now() - 60 * DAY),
            }),
        );

        assert.equal(applied, 0);
        assert.equal(port.immediate.length, 0, 'a subscription that ended was changed');
    });

    test('but a cancellation still to come declines nothing', async () => {
        // A customer who bought a further period by cancelling late may choose
        // the plan they spend it on.
        const { applied } = await materialize(
            dueChange({
                canceledAt: new Date(),
                canceledEffectiveAt: new Date(Date.now() + 30 * DAY),
            }),
        );

        assert.equal(applied, 1);
    });

    test('and an uncancelled subscription is applied as before', async () => {
        assert.equal((await materialize(dueChange())).applied, 1);
    });
});
