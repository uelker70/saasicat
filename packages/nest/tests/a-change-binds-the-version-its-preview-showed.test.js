import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TenantBillingController } from '../dist/billing/index.js';

// A plan change binds the version its preview showed, or nothing.
//
// The preview is shown at one moment and the change submitted at another.
// When a successor's start passes in between, the version on sale is no longer
// the one the customer saw — and binding it would charge a price nobody showed
// them. The change names the version from its preview; the server reads the
// preview again and changes only while that is still the version on sale.

const SUBSCRIPTION = {
    plan: 'STARTER',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: new Date('2026-01-01'),
    currentPeriodStart: new Date('2026-05-01'),
    currentPeriodEnd: new Date('2026-06-01'),
    minimumTermUntil: null,
    canceledAt: null,
    canceledEffectiveAt: null,
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    planVersion: null,
};

/** The preview as the server reads it at the moment the change is submitted. */
function previewNaming(planVersionId, { isImmediate = true } = {}) {
    const decision = {
        isImmediate,
        effectiveAt: isImmediate ? null : new Date('2026-06-01'),
        blockers: [],
        target: { planVersionId },
    };
    return {
        decision,
        async preview() {
            return decision;
        },
        async assertChangeAllowed() {
            return [];
        },
    };
}

function writePort({ claimed = true, bindsPlanVersion } = {}) {
    return {
        bindsPlanVersion,
        immediate: [],
        scheduled: [],
        async changePlanImmediate(_tenantId, input) {
            this.immediate.push(input);
            return { plan: input.planId, billingCycle: input.cycle, claimed };
        },
        async schedulePlanChange(_tenantId, input) {
            this.scheduled.push(input);
            return { claimed };
        },
    };
}

function controllerOver(planPreview, port, subscription = SUBSCRIPTION) {
    return new TenantBillingController(
        {
            computeLimits: async () => ({ plan: 'STARTER', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        planPreview,
        { findForTenant: async () => subscription },
        { snapshot: async () => ({}) },
        port,
        () => 't1',
        () => 'u1',
    );
}

const request = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };
const toPro = (planVersionId) =>
    planVersionId === undefined
        ? { plan: 'PRO', billingCycle: 'MONTHLY' }
        : { plan: 'PRO', billingCycle: 'MONTHLY', planVersionId };

/** Refused with `status` and `code`, and nothing else. */
const refusedWith = (status, code) => (error) => {
    assert.equal(error.getStatus?.(), status);
    assert.equal(error.getResponse?.().code, code);
    return true;
};

// @requirement SC-CHG-023 — A plan change binds the version its preview showed, or nothing
describe('a change to another plan', () => {
    test('naming the version on sale is made, at that version and no other', async () => {
        const port = writePort();
        await controllerOver(previewNaming('pv-pro-1'), port).changePlan(
            request,
            toPro('pv-pro-1'),
        );

        assert.equal(port.immediate.length, 1);
        assert.equal(port.immediate[0].keepsBoundVersion, false, 'another plan is a sale');
        assert.equal(port.immediate[0].quotedPlanVersionId, 'pv-pro-1');
        assert.equal(port.immediate[0].quotedVersionOnly, true);
    });

    test('naming a version no longer on sale is refused, and shown the preview as it stands', async () => {
        const port = writePort();
        const preview = previewNaming('pv-pro-2');

        await assert.rejects(
            () => controllerOver(preview, port).changePlan(request, toPro('pv-pro-1')),
            (error) => {
                refusedWith(409, 'PLAN_CHANGE_QUOTE_CHANGED')(error);
                const body = error.getResponse();
                assert.deepEqual(body.params, { planVersionId: 'pv-pro-1' });
                assert.equal(body.preview, preview.decision, 'the current preview travels with it');
                return true;
            },
        );
        assert.equal(port.immediate.length, 0, 'nothing was changed');
    });

    test('naming no version is refused where the preview names one', async () => {
        const port = writePort();
        await assert.rejects(
            () => controllerOver(previewNaming('pv-pro-1'), port).changePlan(request, toPro()),
            refusedWith(400, 'PLAN_CHANGE_VERSION_NOT_NAMED'),
        );
        assert.equal(port.immediate.length, 0);
    });

    test('scheduled for the term end is refused the same way, and recorded at the version named', async () => {
        const stale = writePort();
        await assert.rejects(
            () =>
                controllerOver(previewNaming('pv-pro-2', { isImmediate: false }), stale).changePlan(
                    request,
                    toPro('pv-pro-1'),
                ),
            refusedWith(409, 'PLAN_CHANGE_QUOTE_CHANGED'),
        );
        assert.equal(stale.scheduled.length, 0);

        const current = writePort();
        await controllerOver(previewNaming('pv-pro-2', { isImmediate: false }), current).changePlan(
            request,
            toPro('pv-pro-2'),
        );
        assert.equal(current.scheduled[0].pendingChangeVersionId, 'pv-pro-2');
    });

    test('whose version stops selling between the check and the write changes nothing', async () => {
        // The write binds only the version named; one that ended a moment ago
        // leaves the row unclaimed rather than binding its successor.
        await assert.rejects(
            () =>
                controllerOver(previewNaming('pv-pro-1'), writePort({ claimed: false })).changePlan(
                    request,
                    toPro('pv-pro-1'),
                ),
            refusedWith(409, 'SUBSCRIPTION_CHANGED'),
        );
    });
});

describe('a change that has no version to name', () => {
    test('keeping the plan and moving the rhythm names none, and keeps the version bound', async () => {
        // Bound to STARTER v1 while v2 is on sale. The preview prices the
        // rhythm change at v1; the write keeps v1 (`SC-SUB-024`) rather than
        // binding the version on sale at a price nobody showed.
        const bound = { ...SUBSCRIPTION, planVersion: { id: 'pv-starter-1', planId: 'STARTER' } };
        const port = writePort();
        await controllerOver(previewNaming('pv-starter-1'), port, bound).changePlan(request, {
            plan: 'STARTER',
            billingCycle: 'YEARLY',
        });
        assert.equal(port.immediate[0].keepsBoundVersion, true);
        assert.equal(port.immediate[0].quotedPlanVersionId, null);
        assert.equal(port.immediate[0].quotedVersionOnly, false);
    });

    test('where nothing reads versions, a change to another plan names none', async () => {
        const port = writePort();
        await controllerOver(previewNaming(null), port).changePlan(request, toPro());
        assert.equal(port.immediate.length, 1);
        assert.equal(port.immediate[0].quotedPlanVersionId, null);
    });

    test('a store that binds no version is not asked to bind the one named', async () => {
        // The comparison still holds the change to what was shown; the store
        // keeps no version to bind, and asking it to would fail the write.
        const port = writePort({ bindsPlanVersion: false });
        await controllerOver(previewNaming('pv-pro-1'), port).changePlan(
            request,
            toPro('pv-pro-1'),
        );
        assert.equal(port.immediate[0].quotedVersionOnly, false);
    });
});
