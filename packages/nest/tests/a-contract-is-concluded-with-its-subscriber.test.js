// A contract is concluded with a party, and names it.
//
// A tenant is where an application keeps a customer's data; the subscriber is
// the party the contract is with. Every way a contract arises — written by a
// caller, frozen after a plan change, concluded from an offer — finds the
// tenant's subscriber and copies it, with the issuer the configuration names,
// and refuses a tenant without one. A plan change and a booking end in such a
// contract after they are written, so they ask first, while nothing has moved.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { subscriberFromRegistration } from '@saasicat/core';
import {
    SubscriptionContractFreezeService,
    TenantBillingController,
    TenantBillingModule,
    buildTenantSubscriptionBundlesController,
} from '../dist/billing/index.js';
import { SubscriberService } from '../dist/subscriber/index.js';
import {
    SubscriptionContractModule,
    SubscriptionContractService,
} from '../dist/subscription-contract/index.js';
import { FakeSubscriptionContractRepository } from '../dist/testing/index.js';
import { SUBSCRIBER_CATALOG, subscribersFor } from './helpers/subscribers.js';

const EFFECTIVE_FROM = new Date('2026-06-01T00:00:00.000Z');

const ISSUER = {
    legalName: 'Example Software GmbH',
    addressLine1: 'Werkstraße 5',
    postalCode: '80331',
    city: 'München',
    country: 'DE',
    vatId: 'DE987654321',
};

const CATALOG_WITH_ISSUER = {
    ...SUBSCRIBER_CATALOG,
    issuer: ISSUER,
    subscribers: { customerNumberPrefix: 'K-' },
};

/** A contract as a caller asks for it: one plan line, and no word about parties. */
function contractFor(tenantId) {
    return {
        tenantId,
        effectiveFrom: EFFECTIVE_FROM,
        priceSnapshot: {
            currency: 'EUR',
            billingCycle: 'monthly',
            subtotalNet: 49,
            discountNet: 0,
            totalNet: 49,
            vatRate: 19,
            totalGross: 58.31,
        },
        lineItems: [
            {
                kind: 'plan',
                sourceKey: 'STANDARD',
                sourceVersionId: null,
                titleSnapshot: 'Standard',
                descriptionSnapshot: null,
                quantity: 1,
                unit: null,
                priceNet: 49,
                priceGross: 58.31,
                billingCycle: 'monthly',
                currency: 'EUR',
                taxRate: 19,
                taxAmount: 9.31,
                minimumTermUntil: null,
                featuresSnapshot: [],
                quotaEffectsSnapshot: {},
                metadata: null,
            },
        ],
    };
}

const refusedWith = (code) => (error) => {
    assert.equal(error.response?.code ?? error.getResponse?.().code, code, error.message);
    return true;
};

/** A contract service over in-memory stores, with the tenants given a subscriber. */
async function contractsWith({ tenants = [], catalog = CATALOG_WITH_ISSUER } = {}) {
    const { repository: subscriberRepo, service: subscribers } = await subscribersFor([], catalog);
    for (const tenantId of tenants) {
        await subscribers.createForTenant(tenantId, {
            legalName: `  Meier Autohaus GmbH `,
            addressLine1: 'Hauptstraße 1',
            postalCode: '10115',
            city: 'Berlin',
            country: 'de',
            vatId: 'DE123456789',
            invoiceEmail: 'rechnung@meier.example',
        });
    }
    const repo = new FakeSubscriptionContractRepository();
    return {
        repo,
        subscribers,
        subscriberRepo,
        contracts: new SubscriptionContractService(repo, subscribers),
    };
}

describe('a contract names the parties it is concluded with', () => {
    // @requirement SC-AUD-012 — A contract carries both parties as they were when it was concluded
    test("it copies the tenant's subscriber and the issuer the configuration names", async () => {
        const { contracts, subscribers } = await contractsWith({ tenants: ['tenant-meier'] });
        const subscriber = await subscribers.requireForTenant('tenant-meier');

        const contract = await contracts.create(contractFor('tenant-meier'));

        assert.equal(contract.subscriberId, subscriber.id);
        assert.deepEqual(contract.subscriber, {
            customerNumber: 'K-10001',
            legalName: 'Meier Autohaus GmbH',
            vatId: 'DE123456789',
            taxNumber: null,
            addressLine1: 'Hauptstraße 1',
            addressLine2: null,
            postalCode: '10115',
            city: 'Berlin',
            country: 'DE',
        });
        // The invoice email says how the party is reached, not who it is, and
        // a contract is kept for years after an address like that mattered.
        assert.equal('invoiceEmail' in contract.subscriber, false);
        assert.deepEqual(contract.issuer, {
            legalName: 'Example Software GmbH',
            vatId: 'DE987654321',
            taxNumber: null,
            addressLine1: 'Werkstraße 5',
            addressLine2: null,
            postalCode: '80331',
            city: 'München',
            country: 'DE',
        });
        assert.equal(contract.partiesMigrated, false);
    });

    // @requirement SC-AUD-012 — A contract carries both parties as they were when it was concluded
    test('where the configuration names no issuer, the contract says none was named', async () => {
        const { contracts } = await contractsWith({
            tenants: ['tenant-meier'],
            catalog: SUBSCRIBER_CATALOG,
        });

        const contract = await contracts.create(contractFor('tenant-meier'));

        assert.equal(contract.issuer, null);
        assert.equal(contract.subscriber.customerNumber, '10001', 'no prefix, the number alone');
    });

    // @requirement SC-AUD-012 — A contract carries both parties as they were when it was concluded
    test('a party a caller names itself is not the one written', async () => {
        const { contracts, subscribers } = await contractsWith({ tenants: ['tenant-meier'] });
        const forged = {
            subscriberId: 'somebody-else',
            subscriber: { legalName: 'Somebody Else AG' },
            issuer: null,
        };

        const contract = await contracts.create({
            ...contractFor('tenant-meier'),
            parties: forged,
        });

        assert.equal(
            contract.subscriberId,
            (await subscribers.requireForTenant('tenant-meier')).id,
        );
        assert.equal(contract.subscriber.legalName, 'Meier Autohaus GmbH');
    });

    // @requirement SC-SUB-017 — A subscriber's legal identity can be corrected, not replaced, under a running contract
    test('a later correction of the subscriber leaves the copy on the contract', async () => {
        const { contracts, subscribers } = await contractsWith({ tenants: ['tenant-meier'] });
        const contract = await contracts.create(contractFor('tenant-meier'));
        const subscriber = await subscribers.requireForTenant('tenant-meier');

        await subscribers.correctIdentity(subscriber.id, {
            kind: 'correction',
            legalName: 'Meier Autohaus Holding GmbH',
            reason: 'Change of name of the same company',
            correctedBy: 'operator:anna',
        });
        await subscribers.changeContact(subscriber.id, { city: 'Potsdam' });

        const kept = await contracts.getById(contract.id);
        assert.equal(kept.subscriber.legalName, 'Meier Autohaus GmbH');
        assert.equal(kept.subscriber.city, 'Berlin');
    });
});

// @requirement SC-SUB-016 — A subscription always has its subscriber, whichever path created the tenant
describe('no contract arises without its subscriber', () => {
    test('a contract for a tenant without one is refused, and nothing is written', async () => {
        const { contracts, repo } = await contractsWith();

        await assert.rejects(
            () => contracts.create(contractFor('tenant-without')),
            refusedWith('SUBSCRIBER_REQUIRED'),
        );
        assert.deepEqual(await repo.list({ tenantId: 'tenant-without' }), []);
    });

    test('replacing the contract in force is refused before that contract is closed', async () => {
        const { contracts, repo, subscriberRepo } = await contractsWith({
            tenants: ['tenant-meier'],
        });
        const inForce = await contracts.create(contractFor('tenant-meier'));
        // The subscriber goes, as it would for a tenant created before
        // subscribers existed and never migrated.
        subscriberRepo.findByTenantId = async () => null;

        await assert.rejects(
            () =>
                contracts.replaceActiveContract(
                    'tenant-meier',
                    contractFor('tenant-meier'),
                    new Date('2026-07-01T00:00:00.000Z'),
                ),
            refusedWith('SUBSCRIBER_REQUIRED'),
        );
        const still = await repo.findById(inForce.id);
        assert.equal(still.status, 'active');
        assert.equal(still.effectiveUntil, null, 'the contract in force was closed anyway');
    });

    test('a frozen contract is refused before the one in force is closed', async () => {
        const { contracts, repo, subscriberRepo } = await contractsWith({
            tenants: ['tenant-meier'],
        });
        const inForce = await contracts.create(contractFor('tenant-meier'));
        subscriberRepo.findByTenantId = async () => null;
        const freeze = freezeService(contracts);

        await assert.rejects(
            () =>
                freeze.freezeOnPlanChange('tenant-meier', 'STANDARD', 'MONTHLY', new Date(), null),
            refusedWith('SUBSCRIBER_REQUIRED'),
        );
        assert.equal((await repo.findById(inForce.id)).effectiveUntil, null);
    });
});

function freezeService(contracts) {
    return new SubscriptionContractFreezeService(
        {
            ...SUBSCRIBER_CATALOG,
            plans: [
                {
                    id: 'STANDARD',
                    name: 'Standard',
                    monthlyNet: 49,
                    yearlyNet: 490,
                    quotas: {},
                    features: [],
                },
            ],
        },
        {
            invalidateTenant() {},
            computeLimits: async () => ({ plan: 'STANDARD', quotas: {}, features: new Set() }),
        },
        contracts,
        {
            findLivePlanVersionId: async () => null,
            loadBookedBundles: async () => ({ lineItems: [], bundleVersionIds: [] }),
        },
    );
}

// @requirement SC-SUB-016 — A subscription always has its subscriber, whichever path created the tenant
describe('a change that ends in a contract asks for the subscriber before it is written', () => {
    const request = { user: { tenantId: 'tenant-without', sub: 'user-1' }, headers: {} };

    const SUBSCRIPTION = {
        id: 'sub-1',
        plan: 'STARTER',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        isPilot: false,
        trialEndsAt: null,
        currentPeriodStart: new Date('2026-06-01'),
        currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
        canceledAt: null,
        canceledEffectiveAt: null,
        planVersion: { id: 'pv-1', planId: 'STARTER', version: 1 },
    };

    async function freezeForTenantWithout() {
        const { contracts } = await contractsWith();
        return freezeService(contracts);
    }

    test('a plan change is refused, and no plan is written', async () => {
        const writes = [];
        const controller = new TenantBillingController(
            { computeLimits: async () => ({}), invalidateTenant() {} },
            {
                async preview() {
                    return { isImmediate: true, effectiveAt: null, blockers: [] };
                },
            },
            { findForTenant: async () => SUBSCRIPTION },
            { snapshot: async () => ({}) },
            {
                async changePlanImmediate(...args) {
                    writes.push(args);
                    return { claimed: true };
                },
                async schedulePlanChange(...args) {
                    writes.push(args);
                    return { claimed: true };
                },
            },
            () => 'tenant-without',
            () => 'user-1',
            null,
            null,
            null,
            null,
            null,
            null,
            await freezeForTenantWithout(),
        );

        await assert.rejects(
            () => controller.changePlan(request, { plan: 'STANDARD', billingCycle: 'MONTHLY' }),
            refusedWith('SUBSCRIBER_REQUIRED'),
        );
        assert.deepEqual(writes, [], 'the plan was changed before the refusal');
    });

    /** The bundle routes, over a service that records what it was asked to do. */
    async function bundleRoutes() {
        const Ctrl = buildTenantSubscriptionBundlesController();
        const calls = [];
        const service = {
            addBundleToSubscription: async (input) => {
                calls.push('add');
                return { id: 'sb-1', ...input };
            },
            reactivateBundle: async () => {
                calls.push('reactivate');
                return { id: 'sb-1' };
            },
            cancelBundleFromSubscription: async (input) => {
                calls.push('cancel');
                return { id: input.subscriptionBundleId };
            },
        };
        const ctrl = new Ctrl(
            service,
            {},
            { findForTenant: async () => SUBSCRIPTION },
            () => 'tenant-without',
            await freezeForTenantWithout(),
        );
        return { ctrl, calls };
    }

    test('booking an add-on is refused, and nothing is booked', async () => {
        const { ctrl, calls } = await bundleRoutes();

        await assert.rejects(
            () => ctrl.add(request, { bundleVersionId: 'bv-1' }),
            refusedWith('SUBSCRIBER_REQUIRED'),
        );
        assert.deepEqual(calls, []);
    });

    test('reactivating one is refused as well, being a purchase again', async () => {
        const { ctrl, calls } = await bundleRoutes();

        await assert.rejects(
            () => ctrl.reactivate(request, 'sb-1'),
            refusedWith('SUBSCRIBER_REQUIRED'),
        );
        assert.deepEqual(calls, []);
    });

    test('while cancelling one is not refused: a cancellation is a declaration', async () => {
        const { ctrl, calls } = await bundleRoutes();

        await ctrl.cancel(request, 'sb-1', {});

        assert.deepEqual(calls, ['cancel']);
    });
});

describe('a completed sign-up names its subscriber from what it collected', () => {
    // @requirement SC-SUB-016 — A subscription always has its subscriber, whichever path created the tenant
    test('the registered name as the legal name, and the verified address for invoices', () => {
        assert.deepEqual(
            subscriberFromRegistration({
                tenantName: 'Meier Autohaus GmbH',
                email: 'anna@meier.example',
                firstName: 'Anna',
            }),
            { legalName: 'Meier Autohaus GmbH', invoiceEmail: 'anna@meier.example' },
        );
    });
});

describe('a module that writes contracts does not start without the subscribers', () => {
    // Wired without the repository, the service over it would resolve to
    // nothing and the first contract would fail with a TypeError naming no
    // setting. Refused at boot instead, naming the one that is missing.

    test('the contract module', () => {
        assert.throws(
            () => SubscriptionContractModule.forRoot({ subscriptionContractRepository: {} }),
            /`subscriberRepository` is required/,
        );
    });

    test('and provides the subscriber service beside the contract service when it has one', () => {
        const mounted = SubscriptionContractModule.forRoot({
            subscriptionContractRepository: {},
            subscriberRepository: {},
        });
        assert.ok(mounted.exports.includes(SubscriberService));
        assert.ok(mounted.exports.includes(SubscriptionContractService));
    });

    test('tenant billing with a contract freeze', () => {
        const options = {
            authGuards: [class Guard {}],
            subscriptionUsagePort: {},
            usageSnapshotPort: {},
            subscriptionWritePort: {},
            contractFreeze: { sourcePort: {}, subscriptionContractRepository: {} },
        };
        assert.throws(() => TenantBillingModule.forRoot(options), /needs `subscriberRepository`/);
        // The counter-check: the same options with it start.
        options.contractFreeze.subscriberRepository = {};
        assert.ok(TenantBillingModule.forRoot(options));
    });
});
