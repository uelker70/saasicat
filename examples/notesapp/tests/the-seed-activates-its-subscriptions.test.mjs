// The seed activates its demo subscriptions the way an application does: the
// platform books each one's add-ons, freezes its first contract and brings its
// account up to date, so a change is priced against a contract and its charges
// rather than against a plan nobody was charged for. DB-free — the platform's
// services are stood in for by ones that record what they are asked, and the
// seed's own start of the platform is compiled without connecting.

// @requirement SC-COMP-014 — The example application is kept in step with the platform

import 'reflect-metadata';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { activateSeededSubscriptions, seedActivationPlatformOf } from '../dist/seed-activation.js';

const PERIOD_START = new Date('2026-11-15T10:00:00.000Z');
const PERIOD_END = new Date('2027-11-15T10:00:00.000Z');

/** acme's seeded subscription as its row stands, with EXPORT_PRO v1 still to book. */
const ACME = {
    id: 'sub-acme',
    tenantId: 'acme',
    plan: 'PRO',
    billingCycle: 'YEARLY',
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    billingAnchorDay: 15,
    canceledAt: null,
    canceledEffectiveAt: null,
    addOns: ['bv-export-1'],
};

/** The platform over `contractsByTenant`, recording each call in order. */
function platformWith(contractsByTenant = {}) {
    const calls = [];
    return {
        calls,
        platform: {
            contracts: {
                list: async ({ tenantId }) => contractsByTenant[tenantId] ?? [],
            },
            addOns: {
                addBundleToSubscription: async (input) => {
                    calls.push(['book', input]);
                },
            },
            freeze: {
                freezeOnPlanChange: async (...args) => {
                    calls.push(['freeze', ...args]);
                },
            },
            charges: {
                recordDueCharges: async (tenantId) => {
                    calls.push(['charges', tenantId]);
                    return [];
                },
            },
        },
    };
}

describe("the seed's activation of a subscription", () => {
    test('books the add-ons in the window, freezes the contract from its start, then charges', async () => {
        const { platform, calls } = platformWith();

        const activated = await activateSeededSubscriptions(platform, [ACME]);

        assert.deepEqual(activated, ['acme']);
        assert.deepEqual(calls, [
            [
                'book',
                {
                    subscriptionId: 'sub-acme',
                    bundleVersionId: 'bv-export-1',
                    currentPlanKey: 'PRO',
                    startedAt: PERIOD_START,
                    parentEndsAt: null,
                    planCycle: 'YEARLY',
                    planPeriodEnd: PERIOD_END,
                    planAnchorDay: 15,
                    plansAhead: [],
                },
            ],
            ['freeze', 'acme', 'PRO', 'YEARLY', PERIOD_START, null],
            ['charges', 'acme'],
        ]);
    });

    test('leaves a tenant that has a contract alone, so a second run activates nothing', async () => {
        const { platform, calls } = platformWith({
            acme: [{ id: 'c-ended', status: 'terminated' }],
        });

        assert.deepEqual(await activateSeededSubscriptions(platform, [ACME]), []);
        assert.deepEqual(calls, []);
    });

    test('ends the add-ons and the contract of a cancelled subscription where it lands', async () => {
        const { platform, calls } = platformWith();

        await activateSeededSubscriptions(platform, [
            {
                ...ACME,
                canceledAt: new Date('2026-12-01T00:00:00.000Z'),
                canceledEffectiveAt: PERIOD_END,
            },
        ]);

        assert.equal(calls[0][1].parentEndsAt, PERIOD_END);
        assert.deepEqual(calls[1], ['freeze', 'acme', 'PRO', 'YEARLY', PERIOD_START, PERIOD_END]);
    });

    test('refuses a subscription without a billing period, and books and freezes nothing', async () => {
        const { platform, calls } = platformWith();

        await assert.rejects(
            activateSeededSubscriptions(platform, [{ ...ACME, currentPeriodStart: null }]),
            /acme has no billing period/,
        );
        assert.deepEqual(calls, []);
    });
});

describe("the seed's start of the platform", () => {
    const environment = {
        SECRET_SEALER_KEY: 'ZGVtby1rZXktZm9yLXRoZS1ub3Rlc2FwcC1zdGFjayE=',
        SAASICAT_INSTALLATION: 'notesapp-test',
    };
    const saved = {};

    before(() => {
        for (const [key, value] of Object.entries(environment)) {
            saved[key] = process.env[key];
            process.env[key] = value;
        }
    });

    after(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    test("hands the seed the platform's own add-on booking, contract freeze, contracts and charges", async () => {
        const { Test } = await import('@nestjs/testing');
        const { SeedModule } = await import('../dist/seed.module.js');
        // The app is compiled to CommonJS, so the services are the classes its
        // `require` loads; the ES modules of the same entries are other classes.
        const require = createRequire(import.meta.url);
        const {
            SubscriberChargeService,
            SubscriptionBundlesService,
            SubscriptionContractFreezeService,
        } = require('@saasicat/nest/billing');
        const { SubscriptionContractService } = require('@saasicat/nest/subscription-contract');

        // Compiling builds every provider and connects to nothing: the client
        // connects when the application initialises.
        const moduleRef = await Test.createTestingModule({ imports: [SeedModule] }).compile();
        try {
            const platform = seedActivationPlatformOf(moduleRef);
            assert.ok(platform.addOns instanceof SubscriptionBundlesService);
            assert.ok(platform.freeze instanceof SubscriptionContractFreezeService);
            assert.ok(platform.contracts instanceof SubscriptionContractService);
            assert.ok(platform.charges instanceof SubscriberChargeService);
        } finally {
            await moduleRef.close();
        }
    });
});
