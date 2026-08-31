// Smoke tests for TenantBillingController + ComposedTenantAuthGuard.
// Direct instantiation without NestJS bootstrap — mocks for EntitlementService,
// SubscriptionUsagePort, UsageSnapshotPort. Auth guard is tested in isolation.

// @requirement SC-ADM-013 — A tenant-facing action that costs money requires the tenant's own administrator
// @requirement SC-PRIC-019 — A tenant can see their own account

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComposedTenantAuthGuard, TenantBillingController } from '../dist/billing/index.js';

function buildEntitlement(stub) {
    return {
        computeLimits: async () => stub,
        invalidateTenant: () => {},
    };
}

function buildSub({ plan = 'STANDARD', status = 'ACTIVE', pendingPlanVersion = null } = {}) {
    return {
        plan,
        billingCycle: 'MONTHLY',
        status,
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: {
            id: 'pv-1',
            planId: plan,
            version: 1,
            publishedAt: new Date('2025-01-01'),
            supersededAt: null,
            changeNote: 'initial',
        },
        pendingPlanVersion,
        pendingPlanVersionEffectiveAt: null,
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
    };
}

test('getEntitlement returns EffectiveLimitsSnapshot generically (quotas map)', async () => {
    const limits = {
        plan: 'STANDARD',
        quotas: { users: 8, members: 1000, storageGb: 10, resources: 5 },
        features: new Set(['CORE_IDENTITY', 'WHATSAPP']),
    };
    const ctrl = new TenantBillingController(
        buildEntitlement(limits),
        null,
        { findForTenant: async () => null },
        { snapshot: async () => ({}) },
        null,
        () => 't1',
    );
    const result = await ctrl.getEntitlement({ user: { tenantId: 't1' } });
    assert.equal(result.plan, 'STANDARD');
    assert.deepEqual(result.quotas, { users: 8, members: 1000, storageGb: 10, resources: 5 });
    assert.deepEqual(result.features.sort(), ['CORE_IDENTITY', 'WHATSAPP']);
});

test('getUsage joins Subscription + Limits + Usage and fills missing quotaKeys with 0', async () => {
    const limits = {
        plan: 'STANDARD',
        quotas: { users: 8, members: 1000, storageGb: 10, resources: 5 },
        features: new Set(['CORE_IDENTITY']),
    };
    const ctrl = new TenantBillingController(
        buildEntitlement(limits),
        null,
        { findForTenant: async () => buildSub() },
        { snapshot: async () => ({ users: 4, members: 850 }) }, // storageGb + resources are missing
        null,
        () => 't1',
    );
    const result = await ctrl.getUsage({ user: { tenantId: 't1' } });
    assert.equal(result.plan, 'STANDARD');
    assert.equal(result.effectivePlan, 'STANDARD');
    assert.equal(result.billingCycle, 'MONTHLY');
    assert.deepEqual(result.usage, { users: 4, members: 850, storageGb: 0, resources: 0 });
    assert.equal(result.planVersion.id, 'pv-1');
    assert.equal(result.pendingPlanVersion, null);
    assert.deepEqual(result.limits.features.sort(), ['CORE_IDENTITY']);
});

test('getUsage passes packageSnapshot + checkoutOfferId through 1:1 (P11.4)', async () => {
    const limits = {
        plan: 'STANDARD',
        quotas: { users: 8, members: 1000, storageGb: 10, resources: 5 },
        features: new Set(['CORE_IDENTITY']),
    };
    const snapshot = {
        planId: 'STANDARD',
        planVersionId: 'pv-1',
        billingCycle: 'MONTHLY',
        bundleVersionIds: ['bv-a', 'bv-b'],
        currency: 'EUR',
        priceMonthlyNet: 49,
        priceTotalNet: 49,
        label: 'Standard + Marketing-Bundle',
        capturedAt: '2026-05-22T10:00:00Z',
    };
    const sub = {
        ...buildSub(),
        packageSnapshot: snapshot,
        checkoutOfferId: 'offer-123',
    };
    const ctrl = new TenantBillingController(
        buildEntitlement(limits),
        null,
        { findForTenant: async () => sub },
        { snapshot: async () => ({}) },
        null,
        () => 't1',
    );
    const result = await ctrl.getUsage({ user: { tenantId: 't1' } });
    assert.deepEqual(result.packageSnapshot, snapshot);
    assert.equal(result.checkoutOfferId, 'offer-123');
});

test('getUsage returns packageSnapshot=null when the Subscription has no snapshot', async () => {
    const limits = {
        plan: 'STANDARD',
        quotas: { users: 8, members: 1000, storageGb: 10, resources: 5 },
        features: new Set(),
    };
    const ctrl = new TenantBillingController(
        buildEntitlement(limits),
        null,
        { findForTenant: async () => buildSub() },
        { snapshot: async () => ({}) },
        null,
        () => 't1',
    );
    const result = await ctrl.getUsage({ user: { tenantId: 't1' } });
    assert.equal(result.packageSnapshot, null);
    assert.equal(result.checkoutOfferId, null);
});

test('getUsage throws NotFoundException when the Subscription is missing', async () => {
    const ctrl = new TenantBillingController(
        buildEntitlement({ plan: 'STARTER', quotas: {}, features: new Set() }),
        null,
        { findForTenant: async () => null },
        { snapshot: async () => ({}) },
        null,
        () => 't404',
    );
    await assert.rejects(() => ctrl.getUsage({ user: { tenantId: 't404' } }), /No subscription/);
});

// @requirement SC-SEC-002 — Which tenant a request belongs to is derived from the authenticated session
test('the tenant is taken from the session, not from what the caller sent', async () => {
    // The request carries a tenant in three places a caller controls and one
    // it does not. Reading any of the three would let a tenant name somebody
    // else's data and be served it, which is the whole of what this refuses.
    let asked = null;
    const ctrl = new TenantBillingController(
        buildEntitlement({ plan: 'STARTER', quotas: {}, features: new Set() }),
        null,
        {
            findForTenant: async (tenantId) => {
                asked = tenantId;
                return buildSub();
            },
        },
        { snapshot: async () => ({}) },
        null,
    );

    await ctrl.getUsage({
        user: { tenantId: 'the-session' },
        body: { tenantId: 'the-body' },
        query: { tenantId: 'the-query' },
        params: { tenantId: 'the-path' },
    });

    assert.equal(asked, 'the-session');
});

// @requirement SC-SEC-002 — Which tenant a request belongs to is derived from the authenticated session
test('and a session that names none is refused rather than falling back', async () => {
    // The counter-check that matters: refusing is only right if there is no
    // second place to look. A resolver that fell through to the body would
    // pass the case above and hand over another tenant's data here.
    const ctrl = new TenantBillingController(
        buildEntitlement({ plan: 'STARTER', quotas: {}, features: new Set() }),
        null,
        { findForTenant: async () => buildSub() },
        { snapshot: async () => ({}) },
        null,
    );

    await assert.rejects(
        () => ctrl.getUsage({ body: { tenantId: 'the-body' }, query: { tenantId: 'the-query' } }),
        /No tenant ID found on the request/,
    );
});

test('getUsage throws NotFoundException when tenantIdResolver yields no ID', async () => {
    const ctrl = new TenantBillingController(
        buildEntitlement({ plan: 'STARTER', quotas: {}, features: new Set() }),
        null,
        { findForTenant: async () => buildSub() },
        { snapshot: async () => ({}) },
        null,
        () => null,
    );
    await assert.rejects(() => ctrl.getUsage({}), /No tenant ID found on the request/);
});

test('ComposedTenantAuthGuard chains guards in order — all ok = true', async () => {
    const guard = new ComposedTenantAuthGuard([
        { canActivate: () => true },
        { canActivate: async () => true },
    ]);
    const result = await guard.canActivate({});
    assert.equal(result, true);
});

test('ComposedTenantAuthGuard short-circuits on the first false', async () => {
    let secondCalled = false;
    const guard = new ComposedTenantAuthGuard([
        { canActivate: () => false },
        {
            canActivate: () => {
                secondCalled = true;
                return true;
            },
        },
    ]);
    const result = await guard.canActivate({});
    assert.equal(result, false);
    assert.equal(secondCalled, false, 'the second guard must not be called');
});

test('ComposedTenantAuthGuard throws 403 without configured guards', async () => {
    const guard = new ComposedTenantAuthGuard(null);
    await assert.rejects(() => guard.canActivate({}), /authGuards is not configured/);
});
