// Tests for PendingPlanMaterializationService (#19) — materializes due
// scheduled plan changes via changePlanImmediate, invalidates the
// entitlement cache per tenant, and is non-fatal per tenant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PendingPlanMaterializationService } from '../dist/billing/index.js';

function makeDeps(due) {
    const calls = { changePlan: [], invalidated: [] };
    const query = {
        async findDuePendingPlanChanges() {
            return due;
        },
    };
    const subscriptionWrite = {
        async changePlanImmediate(tenantId, input) {
            calls.changePlan.push({ tenantId, input });
            return { plan: input.planId, billingCycle: input.cycle };
        },
    };
    const entitlements = {
        invalidateTenant(tenantId) {
            calls.invalidated.push(tenantId);
        },
    };
    return { calls, service: new PendingPlanMaterializationService(query, subscriptionWrite, entitlements) };
}

test('materializes all due pending plan changes and invalidates each tenant', async () => {
    const now = new Date('2026-06-09T00:00:00.000Z');
    const { calls, service } = makeDeps([
        { tenantId: 't1', pendingPlan: 'STANDARD', pendingBillingCycle: 'YEARLY' },
        { tenantId: 't2', pendingPlan: 'STARTER', pendingBillingCycle: 'MONTHLY' },
    ]);

    const result = await service.materializeDuePlanChanges(now);

    assert.equal(result.applied, 2);
    assert.equal(calls.changePlan.length, 2);
    assert.deepEqual(calls.invalidated, ['t1', 't2']);

    const t1 = calls.changePlan[0].input;
    assert.equal(t1.planId, 'STANDARD');
    assert.equal(t1.cycle, 'YEARLY');
    // Status is preserved — only the plan is materialized.
    assert.equal(t1.nextStatus, null);
    // Period window is reset to now (+1 cycle).
    assert.equal(t1.periodStart.getTime(), now.getTime());
    assert.equal(t1.periodEnd.getUTCFullYear(), 2027);
});

test('defaults to MONTHLY cycle when pendingBillingCycle is null', async () => {
    const now = new Date('2026-06-09T00:00:00.000Z');
    const { calls, service } = makeDeps([
        { tenantId: 't1', pendingPlan: 'STANDARD', pendingBillingCycle: null },
    ]);

    await service.materializeDuePlanChanges(now);

    assert.equal(calls.changePlan[0].input.cycle, 'MONTHLY');
    assert.equal(calls.changePlan[0].input.periodEnd.getUTCMonth(), 6); // June → July
});

test('is non-fatal per tenant — one failure does not abort the run', async () => {
    const now = new Date('2026-06-09T00:00:00.000Z');
    const calls = { changePlan: [], invalidated: [] };
    const query = {
        async findDuePendingPlanChanges() {
            return [
                { tenantId: 'boom', pendingPlan: 'STANDARD', pendingBillingCycle: 'MONTHLY' },
                { tenantId: 'ok', pendingPlan: 'STARTER', pendingBillingCycle: 'MONTHLY' },
            ];
        },
    };
    const subscriptionWrite = {
        async changePlanImmediate(tenantId, input) {
            if (tenantId === 'boom') throw new Error('db down');
            calls.changePlan.push({ tenantId, input });
            return { plan: input.planId, billingCycle: input.cycle };
        },
    };
    const entitlements = { invalidateTenant: (t) => calls.invalidated.push(t) };
    const service = new PendingPlanMaterializationService(query, subscriptionWrite, entitlements);

    const result = await service.materializeDuePlanChanges(now);

    assert.equal(result.applied, 1);
    assert.deepEqual(calls.invalidated, ['ok']);
    assert.equal(calls.changePlan.length, 1);
});

test('no-op when nothing is due', async () => {
    const { calls, service } = makeDeps([]);
    const result = await service.materializeDuePlanChanges(new Date('2026-06-09T00:00:00.000Z'));
    assert.equal(result.applied, 0);
    assert.equal(calls.changePlan.length, 0);
    assert.equal(calls.invalidated.length, 0);
});
