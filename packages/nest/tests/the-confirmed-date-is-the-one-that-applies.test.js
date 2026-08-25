import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TenantBillingController } from '../dist/billing/index.js';

// The date the page showed is the date the customer agreed to.
//
// The dialog renders a projection that came with the last `/usage`. A notice
// deadline that passes between the two moves the effective date by a whole
// period, so a button promising January 2027 would deliver January 2028 — and
// the customer would learn that afterwards, from a receipt.
//
// So the page sends back what it showed, and the route checks it. Refused
// rather than silently applied: a wrong date here is a year of somebody's
// money, and the page can ask again in a second.

const SUB = {
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

function build() {
    const port = {
        calls: [],
        async cancelSubscription(_t, input) {
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
        { findForTenant: async () => SUB },
        { snapshot: async () => ({}) },
        port,
        () => 't1',
        () => 'u1',
    );
    return { controller, port };
}

const request = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };

describe('the confirmed date is the one that applies', () => {
    test('a matching expectation goes through', async () => {
        const { controller, port } = build();
        await controller.cancelSubscription(request, {
            expectedEffectiveAt: '2027-01-01T00:00:00.000Z',
        });
        assert.equal(port.calls.length, 1);
    });

    test('a stale one is refused, and the answer carries the new date', async () => {
        const { controller, port } = build();
        await assert.rejects(
            () =>
                controller.cancelSubscription(request, {
                    expectedEffectiveAt: '2026-07-01T00:00:00.000Z',
                }),
            (error) => {
                const body = error.getResponse();
                assert.equal(body.code, 'CANCELLATION_TERMS_CHANGED');
                assert.deepEqual(body.effectiveAt, new Date('2027-01-01'));
                return true;
            },
        );
        assert.equal(port.calls.length, 0, 'a cancellation was written on a stale date');
    });

    test('no expectation still works', async () => {
        // A consumer's own client need not send it; the field is a declaration,
        // not a requirement.
        const { controller, port } = build();
        await controller.cancelSubscription(request, {});
        assert.equal(port.calls.length, 1);
    });
});
