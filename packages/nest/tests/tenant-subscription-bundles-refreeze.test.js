// Tests for the contract re-freeze after bundle add/cancel (#61) in the
// generated TenantSubscriptionBundlesController: consumers with
// `CONTRACT_FREEZE_PORT_TOKEN` get an amendment with an unchanged plan after a
// successful mutation; without the port everything stays as before;
// freeze errors are non-fatal (the mutation is already persisted).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantSubscriptionBundlesController } from '../dist/billing/index.js';

const REQ = { user: { tenantId: 't1' } };

function buildSub() {
    return {
        id: 'sub-1',
        plan: 'STANDARD',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: new Date('2026-01-01'),
        currentPeriodStart: new Date('2026-06-01'),
        currentPeriodEnd: new Date('2026-07-01'),
        pendingPlan: null,
        planVersion: {
            id: 'pv-1',
            planId: 'STANDARD',
            version: 1,
            publishedAt: new Date('2026-01-01'),
            supersededAt: null,
            changeNote: null,
        },
    };
}

function buildController({ contractFreeze = null } = {}) {
    const Ctrl = buildTenantSubscriptionBundlesController();
    const serviceCalls = [];
    const service = {
        addBundleToSubscription: async (input) => {
            serviceCalls.push(['add', input]);
            return { id: 'sb-1', ...input };
        },
        cancelBundleFromSubscription: async (input) => {
            serviceCalls.push(['cancel', input]);
            return { id: input.subscriptionBundleId, canceledAt: new Date() };
        },
    };
    const ctrl = new Ctrl(
        service,
        {},
        { findForTenant: async () => buildSub() },
        (req) => req.user?.tenantId ?? null,
        contractFreeze,
    );
    return { ctrl, serviceCalls };
}

test('add re-freezes the contract with an unchanged plan', async () => {
    const freezeCalls = [];
    const { ctrl } = buildController({
        contractFreeze: {
            freezeOnPlanChange: async (...args) => freezeCalls.push(args),
        },
    });
    await ctrl.add(REQ, { bundleVersionId: 'bv-1' });
    assert.equal(freezeCalls.length, 1);
    const [tenantId, plan, cycle] = freezeCalls[0];
    assert.equal(tenantId, 't1');
    assert.equal(plan, 'STANDARD');
    assert.equal(cycle, 'MONTHLY');
});

test('cancel re-freezes the contract', async () => {
    const freezeCalls = [];
    const { ctrl } = buildController({
        contractFreeze: {
            freezeOnPlanChange: async (...args) => freezeCalls.push(args),
        },
    });
    await ctrl.cancel(REQ, 'sb-1', {});
    assert.equal(freezeCalls.length, 1);
    assert.equal(freezeCalls[0][0], 't1');
});

test('without a ContractFreezePort, add works unchanged', async () => {
    const { ctrl, serviceCalls } = buildController();
    const result = await ctrl.add(REQ, { bundleVersionId: 'bv-1' });
    assert.equal(result.bundleVersionId, 'bv-1');
    assert.equal(serviceCalls.length, 1);
});

test('freeze error is non-fatal — the mutation result still comes back', async () => {
    const { ctrl } = buildController({
        contractFreeze: {
            freezeOnPlanChange: async () => {
                throw new Error('freeze kaputt');
            },
        },
    });
    const result = await ctrl.add(REQ, { bundleVersionId: 'bv-1' });
    assert.equal(result.bundleVersionId, 'bv-1');
});

test('a failed mutation triggers no freeze', async () => {
    const freezeCalls = [];
    const Ctrl = buildTenantSubscriptionBundlesController();
    const ctrl = new Ctrl(
        {
            addBundleToSubscription: async () => {
                throw new Error('422 BUNDLE_INCOMPATIBLE_WITH_PLAN');
            },
        },
        {},
        { findForTenant: async () => buildSub() },
        (req) => req.user?.tenantId ?? null,
        { freezeOnPlanChange: async (...args) => freezeCalls.push(args) },
    );
    await assert.rejects(() => ctrl.add(REQ, { bundleVersionId: 'bv-1' }));
    assert.equal(freezeCalls.length, 0);
});
