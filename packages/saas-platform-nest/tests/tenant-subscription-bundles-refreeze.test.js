// Tests für den Contract-Re-Freeze nach Bundle-Add/-Cancel (#61) im
// generierten TenantSubscriptionBundlesController: Konsumenten mit
// `CONTRACT_FREEZE_PORT_TOKEN` bekommen nach erfolgreicher Mutation ein
// Amendment mit unverändertem Plan; ohne Port bleibt alles wie bisher;
// Freeze-Fehler sind non-fatal (Mutation ist bereits persistiert).

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

test('add re-freezed den Contract mit unverändertem Plan', async () => {
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

test('cancel re-freezed den Contract', async () => {
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

test('ohne ContractFreezePort funktioniert add unverändert', async () => {
    const { ctrl, serviceCalls } = buildController();
    const result = await ctrl.add(REQ, { bundleVersionId: 'bv-1' });
    assert.equal(result.bundleVersionId, 'bv-1');
    assert.equal(serviceCalls.length, 1);
});

test('Freeze-Fehler ist non-fatal — Mutation-Ergebnis kommt trotzdem zurück', async () => {
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

test('fehlgeschlagene Mutation triggert keinen Freeze', async () => {
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
