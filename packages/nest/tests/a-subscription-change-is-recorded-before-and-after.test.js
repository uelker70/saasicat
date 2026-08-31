// What the audit trail has to say about a plan change.
//
// An entry saying "the plan changed" answers nothing a month later. The
// question somebody asks is what it changed *from*, because that is what
// decides whether an invoice was right — and a trail that cannot answer it is
// a trail nobody consults twice.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TenantBillingController } from '../dist/billing/index.js';

const ACTIVE = {
    plan: 'STARTER',
    billingCycle: 'YEARLY',
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: new Date('2026-01-01'),
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2027-01-01'),
    minimumTermUntil: null,
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

const request = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };

function auditService() {
    return {
        entries: [],
        async log(entry) {
            this.entries.push(entry);
        },
    };
}

function buildController(audit, subscription = ACTIVE) {
    return new TenantBillingController(
        {
            computeLimits: async () => ({ plan: 'STARTER', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        {
            async preview() {
                return { isImmediate: true, effectiveAt: null, blockers: [] };
            },
        },
        { findForTenant: async () => subscription },
        { snapshot: async () => ({}) },
        {
            async changePlanImmediate(_tenantId, input) {
                return { claimed: true, plan: input.planId, billingCycle: input.cycle };
            },
        },
        () => 't1',
        () => 'u1',
        null,
        null,
        audit,
    );
}

describe('a plan change is recorded with what it was before and after', () => {
    // @requirement SC-AUD-003 — Every change to a subscription is recorded with what it was before and after
    test('the entry names the plan and cycle on both sides of the change', async () => {
        const audit = auditService();
        const controller = buildController(audit);

        await controller.changePlan(request, { plan: 'PRO', billingCycle: 'MONTHLY' });

        const [entry] = audit.entries.filter((one) => one.action === 'CHANGE_PLAN');
        assert.ok(entry, 'a plan change went unrecorded');
        assert.equal(entry.entity, 'Subscription');
        assert.equal(entry.entityId, 't1');
        assert.equal(entry.changes.fromPlan, 'STARTER');
        assert.equal(entry.changes.fromCycle, 'YEARLY');
        assert.equal(entry.changes.toPlan, 'PRO');
        assert.equal(entry.changes.toCycle, 'MONTHLY');
    });

    // @requirement SC-AUD-003 — Every change to a subscription is recorded with what it was before and after
    test('the before is read from the subscription, not echoed from the request', async () => {
        // The counter-check that matters. An entry that copied the requested
        // plan into both halves would satisfy "records what it was before"
        // while recording nothing of the sort, and would pass the case above
        // if the fixture happened to start on the target plan.
        const audit = auditService();
        const controller = buildController(audit, {
            ...ACTIVE,
            plan: 'ENTERPRISE',
            billingCycle: 'MONTHLY',
        });

        await controller.changePlan(request, { plan: 'PRO', billingCycle: 'MONTHLY' });

        const [entry] = audit.entries.filter((one) => one.action === 'CHANGE_PLAN');
        assert.equal(entry.changes.fromPlan, 'ENTERPRISE');
        assert.notEqual(entry.changes.fromPlan, entry.changes.toPlan);
    });

    test('an installation without an audit adapter still changes the plan', async () => {
        // The trail is optional by construction, and a missing adapter must not
        // turn a working plan change into a 500.
        const controller = buildController(null);
        const result = await controller.changePlan(request, {
            plan: 'PRO',
            billingCycle: 'MONTHLY',
        });
        assert.equal(result.plan, 'PRO');
    });
});
