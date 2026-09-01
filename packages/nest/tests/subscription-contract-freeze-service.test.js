// Tests for SubscriptionContractFreezeService (#18) — generic freeze:
// plan line item from the catalog, bundle line items from the source port,
// entitlementSnapshot from computeLimits, previous contract is superseded.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SubscriptionContractFreezeService } from '../dist/billing/index.js';

const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Test App' },
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

function makeService({
    previousContract = null,
    bundles = { lineItems: [], bundleVersionIds: [] },
    catalog = CATALOG,
} = {}) {
    const calls = { terminated: [], created: [], invalidated: 0 };
    const entitlements = {
        invalidateTenant() {
            calls.invalidated += 1;
        },
        async computeLimits() {
            return {
                plan: 'STANDARD',
                quotas: { users: 8, members: 1000 },
                features: new Set(['CORE', 'WHATSAPP']),
            };
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
    const service = new SubscriptionContractFreezeService(catalog, entitlements, contracts, source);
    return { calls, service };
}

test('freezes plan as active contract with snapshot + plan line item', async () => {
    const { calls, service } = makeService();
    await service.freezeOnPlanChange(
        't1',
        'STANDARD',
        'MONTHLY',
        new Date('2026-06-09T00:00:00.000Z'),
    );

    assert.equal(calls.created.length, 1);
    const contract = calls.created[0];
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
    await service.freezeOnPlanChange(
        't1',
        'STANDARD',
        'YEARLY',
        new Date('2026-06-09T00:00:00.000Z'),
    );

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
    await service.freezeOnPlanChange(
        't1',
        'STANDARD',
        'MONTHLY',
        new Date('2026-06-09T00:00:00.000Z'),
    );

    const contract = calls.created[0];
    assert.equal(contract.lineItems.length, 2);
    assert.equal(contract.lineItems[1].kind, 'bundle');
    assert.deepEqual(contract.originalBundleVersionIds, ['bv-1']);
    // Subtotal = plan 49 + bundle 20 = 69.
    assert.equal(contract.priceSnapshot.subtotalNet, 69);
});

// A contract that mixes rhythms.
//
// A bundle's term may not outlast the plan it hangs on, so a yearly add-on
// beside a monthly plan is refused — but the other way round is legal, and a
// tenant on a yearly plan may hold monthly add-ons. Both rhythms then sit in
// one contract, and its total states one period of the contract's own rhythm.
// Adding the figures as they stand would put a single month of an add-on into
// a year's total, which the contract is then evidence of.

const monthlyAddOn = (priceNet) => ({
    kind: 'bundle',
    sourceKey: 'ANALYTICS',
    sourceVersionId: 'bv-1',
    titleSnapshot: 'Analytics',
    descriptionSnapshot: null,
    quantity: 1,
    unit: null,
    priceNet,
    priceGross: priceNet,
    billingCycle: 'monthly',
    minimumTermUntil: null,
    featuresSnapshot: [],
    quotaEffectsSnapshot: {},
    metadata: null,
});

// @requirement SC-PRIC-012 — A contract mixing rhythms totals one period of its own rhythm
// @requirement SC-MKT-017 — One offer yields at most one contract, and only once its prices are frozen
describe('a yearly contract holding a monthly add-on', () => {
    test('counts the add-on as often as it falls due', async () => {
        const { calls, service } = makeService({
            bundles: { lineItems: [monthlyAddOn(10)], bundleVersionIds: ['bv-1'] },
        });
        await service.freezeOnPlanChange(
            't1',
            'STANDARD',
            'YEARLY',
            new Date('2026-06-09T00:00:00.000Z'),
        );
        const { priceSnapshot, lineItems } = calls.created[0];
        // 490 for the year, plus twelve months of a ten-a-month add-on.
        assert.equal(priceSnapshot.totalNet, 610);
        assert.equal(priceSnapshot.billingCycle, 'yearly');
        // The line keeps what it actually is, so the contract still says the
        // add-on is billed monthly at ten.
        const addOn = lineItems.find((li) => li.kind === 'bundle');
        assert.equal(addOn.billingCycle, 'monthly');
        assert.equal(addOn.priceNet, 10);
    });

    test('a yearly add-on beside a yearly plan is counted once', async () => {
        const { calls, service } = makeService({
            bundles: {
                lineItems: [{ ...monthlyAddOn(100), billingCycle: 'yearly' }],
                bundleVersionIds: ['bv-1'],
            },
        });
        await service.freezeOnPlanChange(
            't1',
            'STANDARD',
            'YEARLY',
            new Date('2026-06-09T00:00:00.000Z'),
        );
        assert.equal(calls.created[0].priceSnapshot.totalNet, 590);
    });

    test('a monthly contract adds a monthly add-on as it stands', async () => {
        const { calls, service } = makeService({
            bundles: { lineItems: [monthlyAddOn(10)], bundleVersionIds: ['bv-1'] },
        });
        await service.freezeOnPlanChange(
            't1',
            'STANDARD',
            'MONTHLY',
            new Date('2026-06-09T00:00:00.000Z'),
        );
        assert.equal(calls.created[0].priceSnapshot.totalNet, 59);
    });
});

// The money facts a bookkeeping record needs, and where they come from.
//
// The source port prices what it sells; the currency and the rate belong to the
// installation, so the platform records them. Asked of both kinds of line,
// because a stamping that reaches only the one the platform builds itself is
// the shape this would fail in.

// @requirement SC-PRIC-015 — An amount records the currency it was booked in
// @requirement SC-PRIC-017 — The tax rate and the tax amount are recorded, not re-derived
describe('what a frozen line records about its money', () => {
    const addOn = {
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
        featuresSnapshot: [],
        quotaEffectsSnapshot: {},
        metadata: null,
    };

    async function freeze(options) {
        const { calls, service } = makeService(options);
        await service.freezeOnPlanChange(
            't1',
            'STANDARD',
            'MONTHLY',
            new Date('2026-06-09T00:00:00.000Z'),
        );
        return calls.created[0];
    }

    test('every line names the currency and the rate the installation applies', async () => {
        const contract = await freeze({
            bundles: { lineItems: [addOn], bundleVersionIds: ['bv-1'] },
        });
        assert.equal(contract.lineItems.length, 2);
        for (const line of contract.lineItems) {
            assert.equal(line.currency, 'EUR', `${line.kind} line lost its currency`);
            assert.equal(line.taxRate, 19, `${line.kind} line lost its rate`);
        }
    });

    test('and the tax it names closes the gap between its own net and gross', async () => {
        const contract = await freeze({
            bundles: { lineItems: [addOn], bundleVersionIds: ['bv-1'] },
        });
        assert.equal(contract.lineItems[0].taxAmount, 9.31); // 58.31 − 49
        assert.equal(contract.lineItems[1].taxAmount, 3.8); //  23.80 − 20
        for (const line of contract.lineItems) {
            assert.equal(Math.round((line.priceNet + line.taxAmount) * 100) / 100, line.priceGross);
        }
    });

    test('a rate of zero is recorded as zero, not left to be read as absent', async () => {
        // An installation that charges no VAT is not one whose lines forgot to
        // say so. Zero is a fact about the line, and a reader that has to tell
        // "no tax" from "nobody wrote it" has to guess.
        const contract = await freeze({ catalog: { ...CATALOG, vatRate: 0 } });
        const [planLine] = contract.lineItems;
        assert.equal(planLine.taxRate, 0);
        assert.equal(planLine.taxAmount, 0);
        assert.equal(planLine.priceGross, planLine.priceNet);
    });

    test('a currency other than the euro is the one that is recorded', async () => {
        // The value comes from the catalogue rather than a default anywhere in
        // the path — which every case above would pass over, EUR being what
        // this fixture already configures.
        const contract = await freeze({ catalog: { ...CATALOG, currency: 'CHF' } });
        assert.equal(contract.lineItems[0].currency, 'CHF');
    });
});
