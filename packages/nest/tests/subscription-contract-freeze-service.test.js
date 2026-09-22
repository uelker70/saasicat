// Tests for SubscriptionContractFreezeService (#18) — generic freeze:
// plan line item from the version the subscription is bound to, bundle line
// items from the source port, entitlementSnapshot from computeLimits, previous
// contract is superseded.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
    CONTRACT_FREEZE_SOURCE_PORT_TOKEN,
    PlanCatalogModule,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
    SubscriptionContractFreezeService,
    givenPlanCatalogSource,
} from '../dist/billing/index.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../dist/entitlement/index.js';
import { SubscriptionContractService } from '../dist/subscription-contract/index.js';
import { publishingCatalogue } from './helpers/publishing-catalogue.js';
import { boundPlanVersion } from './helpers/subscription-fixtures.js';

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
    catalogs = givenPlanCatalogSource(catalog),
    boundFor = () => boundPlanVersion(catalog.plans[0], 'pv-standard-3'),
    tenantHasSubscriber = true,
} = {}) {
    const calls = { terminated: [], created: [], invalidated: 0, limitsFrom: [] };
    const entitlements = {
        invalidateTenant() {
            calls.invalidated += 1;
        },
        async computeLimits(_tenantId, _now, catalog) {
            calls.limitsFrom.push(catalog);
            return {
                plan: 'STANDARD',
                quotas: { users: 8, members: 1000 },
                features: new Set(['CORE', 'WHATSAPP']),
            };
        },
    };
    const contracts = {
        async assertPartyFor(tenantId) {
            if (!tenantHasSubscriber) {
                throw Object.assign(new Error(`Tenant '${tenantId}' has no subscriber.`), {
                    code: 'SUBSCRIBER_REQUIRED',
                });
            }
        },
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
        async findBoundPlanVersion() {
            return boundFor();
        },
        async loadBookedBundles() {
            return bundles;
        },
    };
    const service = new SubscriptionContractFreezeService(
        catalogs,
        entitlements,
        contracts,
        source,
    );
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

describe('the plan line records the version the subscription is bound to', () => {
    const effectiveFrom = new Date('2026-06-09T00:00:00.000Z');
    const V1 = CATALOG.plans[0];
    const V2 = {
        ...V1,
        monthlyNet: 59,
        quotas: { users: 12, members: 2000 },
        features: ['CORE', 'WHATSAPP', 'EXPORT'],
    };

    // @requirement SC-SUB-012 — A new version of a plan does not move a customer who already bought one
    test('a tenant on v1 who books an add-on after v2 is published keeps v1', async () => {
        const operator = publishingCatalogue(CATALOG);
        const { calls, service } = makeService({
            catalogs: operator.source,
            boundFor: () => boundPlanVersion(V1, 'pv-standard-1'),
        });
        operator.publish(V2);

        await service.freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', effectiveFrom);

        const planLine = calls.created[0].lineItems[0];
        assert.equal(calls.created[0].originalPlanVersionId, 'pv-standard-1');
        assert.equal(planLine.sourceVersionId, 'pv-standard-1');
        assert.equal(planLine.priceNet, 49, 'charged the price of the successor');
        assert.deepEqual(planLine.featuresSnapshot, V1.features);
        assert.deepEqual(planLine.quotaEffectsSnapshot, V1.quotas);
    });

    test('after a plan change, the version the write bound: its id, price, features and quotas', async () => {
        let bound = boundPlanVersion(V1, 'pv-standard-1');
        const { calls, service } = makeService({ boundFor: () => bound });
        await service.freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', effectiveFrom);
        bound = boundPlanVersion(V2, 'pv-standard-2');

        await service.freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', effectiveFrom);

        const planLine = calls.created[1].lineItems[0];
        assert.equal(planLine.sourceVersionId, 'pv-standard-2');
        assert.equal(planLine.priceNet, 59);
        assert.equal(planLine.priceGross, 70.21); // 59 * 1.19
        assert.deepEqual(planLine.featuresSnapshot, V2.features);
        assert.deepEqual(planLine.quotaEffectsSnapshot, V2.quotas);
    });

    test('a plan the subscription is not bound to is refused before the contract in force is closed', async () => {
        const { calls, service } = makeService({ previousContract: { id: 'old-1' } });

        await assert.rejects(
            () => service.freezeOnPlanChange('t1', 'PREMIUM', 'MONTHLY', effectiveFrom),
            /bound to 'STANDARD'/,
        );
        assert.deepEqual(calls.terminated, [], 'the contract in force was closed');
        assert.deepEqual(calls.created, []);
    });
});

describe('a freeze beside a write that does not bind the plan version', () => {
    // Booted through Nest rather than constructed: the write reaches the
    // freeze by its token, and a freeze that never received it would start
    // beside any write at all.
    async function boot(writes) {
        const app = await Test.createTestingModule({
            imports: [PlanCatalogModule.forRootWithCatalog(CATALOG)],
            providers: [
                { provide: ENTITLEMENT_SERVICE_TOKEN, useValue: {} },
                { provide: SubscriptionContractService, useValue: {} },
                { provide: CONTRACT_FREEZE_SOURCE_PORT_TOKEN, useValue: {} },
                { provide: SUBSCRIPTION_WRITE_PORT_TOKEN, useValue: writes },
                SubscriptionContractFreezeService,
            ],
        }).compile();
        await app.close();
    }

    test('stops the start, naming the option that binds it', async () => {
        await assert.rejects(() => boot({ bindsPlanVersion: false }), /synchronizePlanVersion/);
    });

    test('starts beside a write that binds, or that does not say', async () => {
        await boot({ bindsPlanVersion: true });
        await boot({});
    });
});

// @requirement SC-PLAN-026 — A version is sold from the moment it is published, not from the next start
describe('a plan the operator publishes after the service was built', () => {
    const effectiveFrom = new Date('2026-06-09T00:00:00.000Z');

    test('is recorded under the name it is sold under, at the price it was bound at', async () => {
        const operator = publishingCatalogue(CATALOG);
        const PREMIUM = {
            id: 'PREMIUM',
            name: 'Premium',
            marketed: true,
            monthlyNet: 99,
            yearlyNet: 990,
            quotas: { users: 50 },
            features: ['CORE'],
        };
        let bound = boundPlanVersion(CATALOG.plans[0], 'pv-standard-3');
        const { calls, service } = makeService({
            catalogs: operator.source,
            boundFor: () => bound,
        });
        await service.freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', effectiveFrom);
        operator.publish(PREMIUM);
        bound = boundPlanVersion(PREMIUM);

        await service.freezeOnPlanChange('t1', 'PREMIUM', 'MONTHLY', effectiveFrom);

        const planLine = calls.created[1].lineItems[0];
        assert.equal(planLine.titleSnapshot, 'Premium');
        assert.equal(planLine.priceNet, 99);
    });

    test('its entitlement snapshot is filtered against the same reading', async () => {
        const operator = publishingCatalogue(CATALOG);
        const { calls, service } = makeService({ catalogs: operator.source });

        await service.freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', effectiveFrom);

        assert.equal(operator.source.reads, 1, 'one contract, one reading');
        assert.ok(calls.limitsFrom[0]?.plans, 'the entitlements read a catalogue of their own');
    });
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

// @requirement SC-CFG-035 — Every tax rate is a percentage, wherever it is stated
test('a catalogue rate that is not a percentage is refused before the previous contract is closed', async () => {
    const { calls, service } = makeService({
        previousContract: { id: 'old-1' },
        catalog: { ...CATALOG, vatRate: 0.19 },
    });

    await assert.rejects(
        () =>
            service.freezeOnPlanChange(
                't1',
                'STANDARD',
                'MONTHLY',
                new Date('2026-06-09T00:00:00.000Z'),
            ),
        (error) => error.getResponse().code === 'SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_PERCENT',
    );

    assert.deepEqual(calls.terminated, [], 'the contract in force was closed');
    assert.deepEqual(calls.created, []);
});

// @requirement SC-CHG-019 — A plan is booked only in a rhythm it carries a price for
test('a plan without a price for the rhythm is refused before the previous contract is closed', async () => {
    const monthlyOnly = { ...CATALOG.plans[0], yearlyNet: null };
    const { calls, service } = makeService({
        previousContract: { id: 'old-1' },
        catalog: { ...CATALOG, plans: [monthlyOnly] },
    });

    await assert.rejects(
        () =>
            service.freezeOnPlanChange(
                't1',
                'STANDARD',
                'YEARLY',
                new Date('2026-06-09T00:00:00.000Z'),
            ),
        (error) => {
            const body = error.getResponse();
            assert.equal(body.code, 'PLAN_NOT_SOLD_IN_CYCLE');
            assert.deepEqual(body.params, {
                planName: 'Standard',
                planKey: 'STANDARD',
                billingCycle: 'YEARLY',
            });
            return true;
        },
    );

    assert.deepEqual(calls.terminated, [], 'the contract in force was closed');
    assert.deepEqual(calls.created, [], 'a plan line of 0.00 was recorded');
});

test('the same plan is recorded in the rhythm it carries a price for', async () => {
    const monthlyOnly = { ...CATALOG.plans[0], yearlyNet: null };
    const { calls, service } = makeService({ catalog: { ...CATALOG, plans: [monthlyOnly] } });

    await service.freezeOnPlanChange(
        't1',
        'STANDARD',
        'MONTHLY',
        new Date('2026-06-09T00:00:00.000Z'),
    );

    assert.equal(calls.created[0].lineItems[0].priceNet, 49);
});

test('an end that is not after the start is refused before the previous contract is closed', async () => {
    const { calls, service } = makeService({ previousContract: { id: 'old-1' } });
    const effectiveFrom = new Date('2026-06-09T00:00:00.000Z');

    await assert.rejects(
        () => service.freezeOnPlanChange('t1', 'STANDARD', 'MONTHLY', effectiveFrom, effectiveFrom),
        (error) => error.getResponse().code === 'SUBSCRIPTION_CONTRACT_INVALID_WINDOW',
    );

    assert.deepEqual(calls.terminated, [], 'the contract in force was closed');
    assert.deepEqual(calls.created, []);
});

test('a second plan line from the source is refused before the previous contract is closed', async () => {
    const { calls, service } = makeService({
        previousContract: { id: 'old-1' },
        bundles: {
            lineItems: [
                {
                    kind: 'plan',
                    sourceKey: 'OTHER',
                    sourceVersionId: null,
                    titleSnapshot: 'Other',
                    descriptionSnapshot: null,
                    quantity: 1,
                    unit: null,
                    priceNet: 10,
                    priceGross: 11.9,
                    billingCycle: 'monthly',
                    minimumTermUntil: null,
                    featuresSnapshot: [],
                    quotaEffectsSnapshot: {},
                    metadata: null,
                },
            ],
            bundleVersionIds: [],
        },
    });

    await assert.rejects(
        () =>
            service.freezeOnPlanChange(
                't1',
                'STANDARD',
                'MONTHLY',
                new Date('2026-06-09T00:00:00.000Z'),
            ),
        (error) => error.getResponse().code === 'SUBSCRIPTION_CONTRACT_PLAN_LINE_ITEM_REQUIRED',
    );

    assert.deepEqual(calls.terminated, [], 'the contract in force was closed');
    assert.deepEqual(calls.created, []);
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

// @requirement SC-SUB-016 — A subscription always has its subscriber, whichever path created the tenant
test('a tenant without a subscriber is refused before the contract in force is closed', async () => {
    // The freeze runs after a plan change is written, and a refusal after the
    // termination below would leave the tenant with no contract at all.
    const { calls, service } = makeService({
        previousContract: { id: 'old-contract', status: 'active' },
        tenantHasSubscriber: false,
    });

    await assert.rejects(
        () =>
            service.freezeOnPlanChange(
                't1',
                'STANDARD',
                'MONTHLY',
                new Date('2026-06-01T00:00:00.000Z'),
                null,
            ),
        { code: 'SUBSCRIBER_REQUIRED' },
    );
    assert.deepEqual(calls.terminated, [], 'the contract in force was closed anyway');
    assert.deepEqual(calls.created, []);
});
