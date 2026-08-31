import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TenantBillingController } from '../dist/billing/index.js';

// The caller says what to change to. The server says when.
//
// `POST /billing/plan` used to take `effectiveImmediately` from the body and
// branch on it, under a comment promising that the server-side pre-check
// "prevents bypass via a direct API call". It checked the blockers and handed
// the one decision that carries money to whoever was calling: a direct POST
// with the flag set entered the immediate branch, reset the period from today,
// and ended a yearly commitment the customer was still inside.
//
// The wizard is not the guard. These call the controller the way a script does.

const SUBSCRIPTION = {
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

/** A preview that answers what the rules say, whatever the caller asked for. */
function previewSaying({ isImmediate, effectiveAt = new Date('2027-01-01') }) {
    return {
        async preview() {
            return { isImmediate, effectiveAt: isImmediate ? null : effectiveAt, blockers: [] };
        },
        async assertChangeAllowed() {
            return [];
        },
    };
}

function buildWritePort() {
    return {
        immediateCalls: [],
        scheduledCalls: [],
        async changePlanImmediate(tenantId, input) {
            this.immediateCalls.push({ tenantId, input });
            return { plan: input.planId, billingCycle: input.cycle, claimed: true };
        },
        async schedulePlanChange(tenantId, input) {
            this.scheduledCalls.push({ tenantId, input });
            return { claimed: true };
        },
        async acceptPendingPlanVersion() {},
        async cancelSubscription() {
            return { canceledAt: null, canceledEffectiveAt: null, status: 'ACTIVE' };
        },
    };
}

function buildController(planPreview, writePort) {
    return new TenantBillingController(
        {
            computeLimits: async () => ({ plan: 'STARTER', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        planPreview,
        { findForTenant: async () => SUBSCRIPTION },
        { snapshot: async () => ({}) },
        writePort,
        () => 't1',
        () => 'u1',
    );
}

const request = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };

// @requirement SC-CHG-001 — The tenant says what to change to; the platform says when
// @requirement SC-CHG-010 — Every refusal the preview shows is also enforced where the change is made
describe('a plan change is timed by the rules, not by the request', () => {
    test('a caller asking for "immediately" on a deferred change is scheduled anyway', async () => {
        // The exact bypass: yearly STARTER, monthly PRO, `effectiveImmediately`
        // set by hand. The rules say term end; the route must too.
        const writePort = buildWritePort();
        const controller = buildController(previewSaying({ isImmediate: false }), writePort);

        await controller.changePlan(request, {
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
            effectiveImmediately: true,
        });

        assert.equal(writePort.immediateCalls.length, 0, 'the immediate branch was taken');
        assert.equal(writePort.scheduledCalls.length, 1);
        assert.deepEqual(
            writePort.scheduledCalls[0].input.pendingEffectiveAt,
            new Date('2027-01-01'),
        );
    });

    test('a caller asking for nothing on an immediate change still gets it today', async () => {
        // The other direction, and the one that shows the route reads the
        // preview rather than simply always scheduling.
        const writePort = buildWritePort();
        const controller = buildController(previewSaying({ isImmediate: true }), writePort);

        await controller.changePlan(request, { plan: 'STANDARD', billingCycle: 'YEARLY' });

        assert.equal(writePort.immediateCalls.length, 1);
        assert.equal(writePort.scheduledCalls.length, 0);
    });

    test("the scheduled date is the preview's, not a second computation", async () => {
        // The route used to recompute it from the trial and the period. Two
        // answers to one question drift; this one is the preview's.
        const writePort = buildWritePort();
        const controller = buildController(
            previewSaying({ isImmediate: false, effectiveAt: new Date('2028-06-30') }),
            writePort,
        );

        await controller.changePlan(request, { plan: 'STANDARD', billingCycle: 'MONTHLY' });

        assert.deepEqual(
            writePort.scheduledCalls[0].input.pendingEffectiveAt,
            new Date('2028-06-30'),
        );
    });
});
