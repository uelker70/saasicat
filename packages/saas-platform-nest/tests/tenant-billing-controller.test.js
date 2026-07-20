// Smoke-Tests für TenantBillingController + ComposedTenantAuthGuard.
// Direktes Instanziieren ohne NestJS-Bootstrap — Mocks fuer EntitlementService,
// SubscriptionUsagePort, UsageSnapshotPort. Auth-Guard wird isoliert getestet.

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

test('getEntitlement liefert EffectiveLimitsSnapshot generisch (quotas-Map)', async () => {
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

test('getUsage joined Subscription + Limits + Usage und füllt fehlende quotaKeys mit 0', async () => {
    const limits = {
        plan: 'STANDARD',
        quotas: { users: 8, members: 1000, storageGb: 10, resources: 5 },
        features: new Set(['CORE_IDENTITY']),
    };
    const ctrl = new TenantBillingController(
        buildEntitlement(limits),
        null,
        { findForTenant: async () => buildSub() },
        { snapshot: async () => ({ users: 4, members: 850 }) }, // storageGb + resources fehlen
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

test('getUsage reicht packageSnapshot + checkoutOfferId 1:1 durch (P11.4)', async () => {
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

test('getUsage liefert packageSnapshot=null wenn Subscription keinen Snapshot hat', async () => {
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

test('getUsage wirft NotFoundException bei fehlendem Subscription', async () => {
    const ctrl = new TenantBillingController(
        buildEntitlement({ plan: 'STARTER', quotas: {}, features: new Set() }),
        null,
        { findForTenant: async () => null },
        { snapshot: async () => ({}) },
        null,
        () => 't404',
    );
    await assert.rejects(() => ctrl.getUsage({ user: { tenantId: 't404' } }), /Keine Subscription/);
});

test('getUsage wirft NotFoundException wenn tenantIdResolver kein ID liefert', async () => {
    const ctrl = new TenantBillingController(
        buildEntitlement({ plan: 'STARTER', quotas: {}, features: new Set() }),
        null,
        { findForTenant: async () => buildSub() },
        { snapshot: async () => ({}) },
        null,
        () => null,
    );
    await assert.rejects(() => ctrl.getUsage({}), /Tenant-ID nicht im Request/);
});

test('ComposedTenantAuthGuard kettet Guards in Reihenfolge — alle ok = true', async () => {
    const guard = new ComposedTenantAuthGuard([
        { canActivate: () => true },
        { canActivate: async () => true },
    ]);
    const result = await guard.canActivate({});
    assert.equal(result, true);
});

test('ComposedTenantAuthGuard short-circuited bei erstem false', async () => {
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
    assert.equal(secondCalled, false, 'zweiter Guard darf nicht aufgerufen werden');
});

test('ComposedTenantAuthGuard wirft 403 ohne konfigurierte Guards', async () => {
    const guard = new ComposedTenantAuthGuard(null);
    await assert.rejects(() => guard.canActivate({}), /authGuards ist nicht konfiguriert/);
});
