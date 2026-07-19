// Regressionsschutz für die Bundle-Plan-Kompatibilität: der
// TenantSubscriptionBundlesController muss den Plan-KEY (`sub.plan`) als
// `currentPlanKey` weiterreichen — NICHT die `planVersion.planId`-UUID.
// `compatibility.planIds` ist key-basiert (STARTER/STANDARD/…); eine UUID
// matcht dort nie und führt zum falschen „Bundle nicht mit Plan kompatibel".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantSubscriptionBundlesController } from '../dist/billing/index.js';

const REQ = { user: { tenantId: 't1' } };

// Prod-nah: planVersion.planId ist eine UUID und unterscheidet sich vom Plan-Key.
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

test('add reicht den Plan-KEY (sub.plan) als currentPlanKey weiter, nicht die planVersion-UUID', async () => {
    const { ctrl, captured } = buildController();
    await ctrl.add(REQ, { bundleVersionId: 'bv-1' });
    assert.equal(captured.add.currentPlanKey, 'STANDARD');
});

test('preview reicht den Plan-KEY (sub.plan) als currentPlanKey weiter, nicht die planVersion-UUID', async () => {
    const { ctrl, captured } = buildController();
    await ctrl.preview(REQ, { bundleVersionId: 'bv-1' });
    assert.equal(captured.previewCtx.currentPlanKey, 'STANDARD');
});
