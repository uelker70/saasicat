// Tests für SubscriptionContractFreezeService (#18) — generischer Freeze:
// Plan-Line-Item aus dem Catalog, Bundle-Line-Items aus dem Source-Port,
// entitlementSnapshot aus computeLimits, vorheriger Contract wird superseded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionContractFreezeService } from '../dist/billing/index.js';

const CATALOG = {
    schemaVersion: 1,
    projectKey: 'demo',
    currency: 'EUR',
    vatRate: 19,
    plans: [
        {
            id: 'STANDARD',
            name: 'Standard',
            tagline: 'Für Wachsende',
            marketed: true,
            monthlyNet: 49,
            yearlyNet: 490,
            quotas: { users: 8, members: 1000 },
            features: ['CORE', 'WHATSAPP'],
        },
    ],
};

function makeService({ previousContract = null, bundles = { lineItems: [], bundleVersionIds: [] } } = {}) {
    const calls = { terminated: [], created: [], invalidated: 0 };
    const entitlements = {
        invalidateTenant() {
            calls.invalidated += 1;
        },
        async computeLimits() {
            return { plan: 'STANDARD', quotas: { users: 8, members: 1000 }, features: new Set(['CORE', 'WHATSAPP']) };
        },
    };
    const contracts = {
        async findActiveByTenantId() {
            return previousContract;
        },
        async terminate(id, data) {
            calls.terminated.push({ id, data });
        },
        async create(data) {
            calls.created.push(data);
            return { id: 'new-contract', ...data };
        },
    };
    const source = {
        async findLivePlanVersionId() {
            return 'pv-standard-3';
        },
        async loadBookedBundles() {
            return bundles;
        },
    };
    const service = new SubscriptionContractFreezeService(CATALOG, entitlements, contracts, 'demo', source);
    return { calls, service };
}

test('freezes plan as active contract with snapshot + plan line item', async () => {
    const { calls, service } = makeService();
    await service.freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', new Date('2026-06-09T00:00:00.000Z'));

    assert.equal(calls.created.length, 1);
    const contract = calls.created[0];
    assert.equal(contract.projectKey, 'demo');
    assert.equal(contract.tenantId, 't1');
    assert.equal(contract.status, 'active');
    assert.equal(contract.originalPlanVersionId, 'pv-standard-3');
    assert.deepEqual(contract.entitlementSnapshot.features, ['CORE', 'WHATSAPP']);
    assert.equal(contract.entitlementSnapshot.plan, 'STANDARD');

    const planLine = contract.lineItems[0];
    assert.equal(planLine.kind, 'plan');
    assert.equal(planLine.sourceKey, 'STANDARD');
    assert.equal(planLine.priceNet, 49);
    assert.equal(planLine.priceGross, 58.31); // 49 * 1.19
    assert.equal(planLine.billingCycle, 'monthly');
});

test('supersedes the previous active contract before creating the new one', async () => {
    const { calls, service } = makeService({ previousContract: { id: 'old-1' } });
    await service.freezeOnPlanChange('t1', 'STANDARD', 'YEARLY', new Date('2026-06-09T00:00:00.000Z'));

    assert.equal(calls.terminated.length, 1);
    assert.equal(calls.terminated[0].id, 'old-1');
    assert.equal(calls.terminated[0].data.status, 'superseded');
    assert.equal(calls.created[0].priceSnapshot.billingCycle, 'yearly');
});

test('appends consumer bundle line items + version ids', async () => {
    const bundleLine = {
        kind: 'bundle',
        sourceKey: 'SPORT',
        sourceVersionId: 'bv-1',
        titleSnapshot: 'Sportplatz',
        descriptionSnapshot: null,
        quantity: 1,
        unit: null,
        priceNet: 20,
        priceGross: 23.8,
        billingCycle: 'monthly',
        minimumTermUntil: null,
        featuresSnapshot: ['RESOURCES'],
        quotaEffectsSnapshot: { resources: 5 },
        metadata: null,
    };
    const { calls, service } = makeService({
        bundles: { lineItems: [bundleLine], bundleVersionIds: ['bv-1'] },
    });
    await service.freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', new Date('2026-06-09T00:00:00.000Z'));

    const contract = calls.created[0];
    assert.equal(contract.lineItems.length, 2);
    assert.equal(contract.lineItems[1].kind, 'bundle');
    assert.deepEqual(contract.originalBundleVersionIds, ['bv-1']);
    // Subtotal = Plan 49 + Bundle 20 = 69.
    assert.equal(contract.priceSnapshot.subtotalNet, 69);
});
