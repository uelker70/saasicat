// Tests for PendingPlanMaterializationService (#19) — materializes due
// scheduled plan changes via changePlanImmediate, invalidates the
// entitlement cache per tenant, and is non-fatal per tenant.

// @requirement SC-SUB-015 — A scheduled change that comes due after the customer has left is declined and recorded
// @requirement SC-CHG-006 — A deferred change lands at the later of the period end and the commitment

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PendingPlanMaterializationService } from '../dist/billing/index.js';

function makeDeps(due, { rlsBypass = null, frame = null } = {}) {
    const calls = { changePlan: [], invalidated: [], framesSeen: [] };
    const query = {
        async findDuePendingPlanChanges() {
            calls.framesSeen.push(frame?.getStore() ?? 'none');
            return due;
        },
    };
    const subscriptionWrite = {
        async changePlanImmediate(tenantId, input) {
            calls.framesSeen.push(frame?.getStore() ?? 'none');
            calls.changePlan.push({ tenantId, input });
            return { plan: input.planId, billingCycle: input.cycle, claimed: true };
        },
    };
    const entitlements = {
        invalidateTenant(tenantId) {
            calls.invalidated.push(tenantId);
        },
    };
    return {
        calls,
        service: new PendingPlanMaterializationService(
            query,
            subscriptionWrite,
            entitlements,
            null,
            rlsBypass,
        ),
    };
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
            return { plan: input.planId, billingCycle: input.cycle, claimed: true };
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

// @requirement SC-SUB-024 — A subscription keeps its plan version until the subscriber takes another
test('a scheduled change keeps the version the subscriber is bound to where it leaves the plan as it is', async () => {
    // The store keeps the binding only where the plan does not change; a
    // scheduled change of plan is bound to the version it was quoted at.
    const { calls, service } = makeDeps([
        { tenantId: 't1', pendingPlan: 'STANDARD', pendingBillingCycle: 'YEARLY' },
    ]);

    await service.materializeDuePlanChanges(new Date('2026-06-09T00:00:00.000Z'));

    assert.equal(calls.changePlan[0].input.keepsBoundVersion, true);
});

// @requirement SC-CHG-022 — A scheduled change to another plan binds the version it was quoted at
test('a scheduled change to another plan binds the version it was quoted at', async () => {
    const { calls, service } = makeDeps([
        {
            tenantId: 't1',
            pendingPlan: 'STANDARD',
            pendingBillingCycle: 'YEARLY',
            pendingChangeVersionId: 'pv-quoted',
        },
    ]);

    await service.materializeDuePlanChanges(new Date('2026-06-09T00:00:00.000Z'));

    assert.equal(calls.changePlan[0].input.quotedPlanVersionId, 'pv-quoted');
});

// @requirement SC-SUB-021 — A newer version is taken by naming it, the way its kind says
test('a scheduled switch to a newer version of the same plan binds that version', async () => {
    // The subscription is on STANDARD and stays there; what the change names is
    // the version it takes, and keeping the version bound would drop it.
    const { calls, service } = makeDeps([
        {
            tenantId: 't1',
            pendingPlan: 'STANDARD',
            pendingBillingCycle: 'MONTHLY',
            pendingChangeVersionId: 'pv-2',
        },
    ]);

    await service.materializeDuePlanChanges(new Date('2026-06-09T00:00:00.000Z'));

    const [{ input }] = calls.changePlan;
    assert.equal(input.keepsBoundVersion, false);
    assert.equal(input.quotedPlanVersionId, 'pv-2');
});

// @requirement SC-SEC-003 — Reads that legitimately cross tenants are named as the exceptions they are
test("the run reads and writes every tenant's change inside the bypass", async () => {
    // A forced policy with no frame leaves the run nothing to find and nothing
    // to write, and it reports that as a quiet night.
    const frame = new AsyncLocalStorage();
    const { calls, service } = makeDeps(
        [{ tenantId: 't1', pendingPlan: 'STANDARD', pendingBillingCycle: 'YEARLY' }],
        { frame, rlsBypass: { runWithBypass: (work) => frame.run('bypass', work) } },
    );

    await service.materializeDuePlanChanges(new Date('2026-06-09T00:00:00.000Z'));

    assert.deepEqual(calls.framesSeen, ['bypass', 'bypass']);
});
