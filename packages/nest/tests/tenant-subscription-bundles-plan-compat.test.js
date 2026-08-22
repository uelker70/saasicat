// Regression guard for bundle-plan compatibility: the
// TenantSubscriptionBundlesController must pass the plan KEY (`sub.plan`) as
// `currentPlanKey` — NOT the `planVersion.planId` UUID.
// `compatibility.planIds` is key-based (STARTER/STANDARD/…); a UUID never
// matches there and leads to the wrong "bundle not compatible with plan".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantSubscriptionBundlesController } from '../dist/billing/index.js';

const REQ = { user: { tenantId: 't1' } };

// Production-like: planVersion.planId is a UUID and differs from the plan key.
function buildSub() {
    return {
        id: 'sub-1',
        plan: 'STANDARD',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        startedAt: new Date('2026-01-01'),
        currentPeriodStart: new Date('2026-06-01'),
        currentPeriodEnd: new Date('2026-07-01'),
        planVersion: { id: 'pv-1', planId: 'e4350ef9-07e5-4536-88f9-d92a61a8b30b', version: 1 },
    };
}

function buildController() {
    const Ctrl = buildTenantSubscriptionBundlesController();
    const captured = {};
    const service = {
        addBundleToSubscription: async (input) => {
            captured.add = input;
            return { id: 'sb-1', ...input };
        },
        cancelBundleFromSubscription: async (input) => ({ id: input.subscriptionBundleId }),
    };
    const previewService = {
        previewAdd: async (ctx) => {
            captured.previewCtx = ctx;
            return { ok: true };
        },
        previewCancel: async (ctx) => {
            captured.previewCtx = ctx;
            return { ok: true };
        },
    };
    const ctrl = new Ctrl(
        service,
        previewService,
        { findForTenant: async () => buildSub() },
        (req) => req.user?.tenantId ?? null,
        null,
    );
    return { ctrl, captured };
}

test('add passes the plan KEY (sub.plan) as currentPlanKey, not the planVersion UUID', async () => {
    const { ctrl, captured } = buildController();
    await ctrl.add(REQ, { bundleVersionId: 'bv-1' });
    assert.equal(captured.add.currentPlanKey, 'STANDARD');
});

test('preview passes the plan KEY (sub.plan) as currentPlanKey, not the planVersion UUID', async () => {
    const { ctrl, captured } = buildController();
    await ctrl.preview(REQ, { bundleVersionId: 'bv-1' });
    assert.equal(captured.previewCtx.currentPlanKey, 'STANDARD');
});
