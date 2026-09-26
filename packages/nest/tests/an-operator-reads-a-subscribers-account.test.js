// The operator reads a subscriber's account beside the tenant it belongs to.
//
// The account is derived the way an application's calls derive it — through
// `SubscriberChargeService` over a subscription whose window moves — and read
// back through `SubscriberAccountService`, so what is asserted is what the
// operator is shown, not what a fixture was seeded with.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BILLING_ERROR_CODES } from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN, AdminResourcesService } from '../dist/admin/index.js';
import { SubscriberAccountModule, SubscriberAccountService } from '../dist/billing/index.js';
import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import { ARCHIVE, anAccount, discountLine, line, utc } from './helpers/charge-journal.js';
import { controllersIn, handlersOf } from './helpers/operator-routes.js';

const STANDARD = () => line('plan', 'STANDARD', 49, { titleSnapshot: 'Standard' });
const WELCOME = () => ({
    code: 'WELCOME20',
    label: '20 %',
    valueType: 'PERCENT',
    value: 20,
    resolvedAmountNet: 9.8,
    durationType: 'BILLING_CYCLES',
    durationValue: 2,
});

const HOLDER = {
    id: 'subscriber-1',
    customerNumber: 'K-10001',
    legalName: 'Tenant One GmbH',
};

/** Standard with a welcome discount from January, and an add-on booked on the 21st. */
async function twoMonthsOfAnAccount() {
    const account = anAccount({ subscriber: HOLDER });
    await account.contract({
        offer: 'offer-1',
        lineItems: [
            STANDARD(),
            ARCHIVE(),
            { ...discountLine(9.8, { promoCode: WELCOME() }), titleSnapshot: 'Welcome 20 %' },
        ],
    });
    account.book();
    await account.charge(utc('2026-01-21'));
    account.roll(utc('2026-02-01'), utc('2026-03-01'));
    account.bookings[0].currentPeriodStart = utc('2026-02-01');
    account.bookings[0].currentPeriodEnd = utc('2026-03-01');
    await account.charge(utc('2026-02-01'));
    return account;
}

/** An entry as `[due, title, origin, amount]`. */
const rowOf = ({ charge, title }) => [
    charge.bookedAt.slice(0, 10),
    title,
    charge.origin,
    charge.amountNet,
];

// @requirement SC-ADM-028 — An operator reads a subscriber's charges beside its tenant
describe("the operator reads a subscriber's account", () => {
    test('newest first, and within one due date the plan, then its add-ons, then its discounts', async () => {
        const account = await twoMonthsOfAnAccount();

        const { entries } = await account.read();

        assert.deepEqual(entries.map(rowOf), [
            ['2026-02-01', 'Standard', 'renewal', 49],
            ['2026-02-01', 'ARCHIVE', 'renewal', 10],
            ['2026-02-01', 'Welcome 20 %', 'renewal', -9.8],
            ['2026-01-21', 'ARCHIVE', 'bundleBooking', 3.55],
            ['2026-01-01', 'Standard', 'activation', 49],
            ['2026-01-01', 'Welcome 20 %', 'activation', -9.8],
        ]);
    });

    test('each charge as the journal holds it, its dates as the wire carries them', async () => {
        const account = await twoMonthsOfAnAccount();

        const { entries } = await account.read();
        const written = account.ledger.rows.find(
            (row) => row.source === 'bundle' && row.origin === 'bundleBooking',
        );
        const read = entries.find(({ charge }) => charge.id === written.id).charge;

        assert.deepEqual(read, {
            ...written,
            periodStart: '2026-01-21T00:00:00.000Z',
            periodEnd: '2026-02-01T00:00:00.000Z',
            bookedAt: '2026-01-21T00:00:00.000Z',
            createdAt: written.createdAt.toISOString(),
        });
    });

    test('a charge under a superseded contract keeps the title that contract gave it', async () => {
        const account = anAccount({ subscriber: HOLDER });
        await account.contract({ lineItems: [STANDARD()], until: utc('2026-02-01') });
        await account.charge(utc('2026-01-10'));
        await account.contract({
            effectiveFrom: utc('2026-02-01'),
            lineItems: [line('plan', 'STANDARD', 49, { titleSnapshot: 'Standard (2026)' })],
        });
        account.roll(utc('2026-02-01'), utc('2026-03-01'));
        await account.charge(utc('2026-02-01'));

        const { entries } = await account.read();

        assert.deepEqual(
            entries.map(({ charge, title }) => [charge.periodStart.slice(0, 10), title]),
            [
                ['2026-02-01', 'Standard (2026)'],
                ['2026-01-01', 'Standard'],
            ],
        );
    });

    test('a charge whose contract line cannot be read is shown without a title', async () => {
        const account = anAccount({ subscriber: HOLDER });
        await account.contract({ lineItems: [STANDARD()] });
        await account.charge(utc('2026-01-10'));
        account.ledger.rows[0].contractLineItemId = 'no-such-line';

        const { entries } = await account.read();

        assert.equal(entries.length, 1);
        assert.equal(entries[0].title, null);
    });

    test('names whose account it is by customer number and legal name', async () => {
        const account = anAccount({ subscriber: { ...HOLDER, city: 'Berlin' } });

        const { holder } = await account.read();

        assert.deepEqual(holder, HOLDER);
    });

    test('a tenant without a subscriber has an account with no holder', async () => {
        const account = anAccount({ subscriber: null });

        assert.deepEqual(await account.read(), { holder: null, entries: [] });
    });

    test('a tenant without a subscription has no charges', async () => {
        const account = anAccount({ subscriber: HOLDER });
        await account.contract({ lineItems: [STANDARD()] });
        await account.charge(utc('2026-01-10'));
        account.subscription.id = null;

        assert.deepEqual(await account.read(), { holder: HOLDER, entries: [] });
    });
});

// @requirement SC-ADM-028 — An operator reads a subscriber's charges beside its tenant
describe('two charges due at the same moment', () => {
    test('the one for the later period comes first', async () => {
        const account = anAccount({ subscriber: HOLDER });
        await account.contract({ lineItems: [STANDARD()] });
        const due = utc('2026-03-01');
        const charge = (id, periodStart) => ({
            id,
            subscriberId: HOLDER.id,
            tenantId: 't1',
            subscriptionId: 'sub-1',
            contractId: 'c1',
            contractLineItemId: 'l1',
            origin: 'renewal',
            source: 'plan',
            sourceRef: 'sub-1',
            periodStart,
            periodEnd: utc('2026-04-01'),
            currency: 'EUR',
            amountNet: 49,
            bookedAt: due,
            createdAt: due,
        });
        account.ledger.rows.push(charge('a', utc('2026-02-01')), charge('b', utc('2026-03-01')));

        const { entries } = await account.read();

        assert.deepEqual(
            entries.map(({ charge: { id } }) => id),
            ['b', 'a'],
        );
    });
});

const PLAN_CATALOG = {
    schemaVersion: 1,
    app: { name: 'Probe' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling: {
        cancellationNoticeDays: { monthly: 0, yearly: 0 },
        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
    },
    plans: [],
};

/**
 * The platform as an application composes it, every adapter a fake. The
 * journal holds one charge for `northwind`, and records whether it was read
 * inside the bypass frame and how often the adapter was built.
 */
async function aPlatform({ journal = true, adminResources = true } = {}) {
    const seen = { built: 0, lookups: [], reads: [] };
    let bypassed = 0;
    const rlsBypass = {
        async runWithBypass(fn) {
            bypassed += 1;
            try {
                return await fn();
            } finally {
                bypassed -= 1;
            }
        },
    };
    const ledger = {
        recordCharges: async () => [],
        async listBySubscription(subscriptionId) {
            seen.reads.push({ subscriptionId, bypassed: bypassed > 0 });
            return [
                {
                    id: 'charge-1',
                    subscriberId: HOLDER.id,
                    tenantId: 't-northwind',
                    subscriptionId,
                    contractId: 'c1',
                    contractLineItemId: 'l1',
                    origin: 'activation',
                    source: 'plan',
                    sourceRef: subscriptionId,
                    periodStart: utc('2026-01-01'),
                    periodEnd: utc('2026-02-01'),
                    currency: 'EUR',
                    amountNet: 49,
                    bookedAt: utc('2026-01-01'),
                    createdAt: utc('2026-01-01'),
                },
            ];
        },
    };
    const tenants = {
        listTenants: async () => [],
        async getTenantDetail(slug) {
            seen.lookups.push({ slug, bypassed: bypassed > 0 });
            return slug === 'northwind' ? { id: 't-northwind', slug, name: 'Northwind' } : null;
        },
        setTenantActive: async () => null,
        listUsers: async () => [],
        listAudit: async () => [],
        listSubscriptions: async () => [],
    };
    const root = SaaSiCatModule.forRoot({
        planCatalog: PLAN_CATALOG,
        controller: { guards: [] },
        discoverySnapshotPath: null,
        persistence: {
            capabilities: {
                transactions: true,
                pessimisticLocking: true,
                rowLevelSecurity: true,
                advisoryLocks: false,
            },
            core: {
                mfa: {},
                audit: { write: async () => {} },
                rlsBypass,
                transactionRunner: { run: (fn) => fn({}) },
            },
            entitlement: {
                subscriptionRepository: { findByTenantId: async () => null },
                planVersionRepository: { findById: async () => null },
            },
            tenantBilling: {
                subscriptionUsagePort: {
                    findForTenant: async (tenantId) =>
                        tenantId === 't-northwind' ? { id: 'sub-northwind' } : null,
                },
                subscriptionWritePort: {},
            },
            adminResources: { resources: tenants },
        },
        tenantBilling: {
            authGuards: [],
            contractFreeze: {
                sourcePort: {},
                subscriptionContractRepository: { list: async () => [] },
                subscriberRepository: {
                    findByTenantId: async (tenantId) =>
                        tenantId === 't-northwind' ? HOLDER : null,
                },
            },
            ...(journal
                ? {
                      chargeJournal: {
                          ledgerRepository: {
                              useFactory: () => {
                                  seen.built += 1;
                                  return ledger;
                              },
                              inject: [],
                          },
                      },
                  }
                : {}),
        },
        adminResources,
    });
    const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
    const manifest = await moduleRef.get(AdminManifestService).getManifest();
    const served = controllersIn(root)
        .flatMap(handlersOf)
        .find(({ route }) => route === ROUTE);
    return {
        moduleRef,
        manifest,
        seen,
        served,
        /** Asks the route the way Nest dispatches to it. */
        chargesOf: (slug) => moduleRef.get(served.controller, { strict: false })[served.name](slug),
    };
}

const ROUTE = 'GET admin/tenants/:slug/charges';

// @requirement SC-ADM-028 — An operator reads a subscriber's charges beside its tenant
describe("the account is served beside the tenant's detail", () => {
    test('with a journal and the tenants, the route answers and the manifest announces it', async () => {
        const platform = await aPlatform();

        const account = await platform.chargesOf('northwind');

        assert.equal(platform.manifest.capabilities['charges.read'], true);
        assert.deepEqual(account.holder, HOLDER);
        assert.deepEqual(
            account.entries.map(({ charge }) => [charge.subscriptionId, charge.amountNet]),
            [['sub-northwind', 49]],
        );
        await platform.moduleRef.close();
    });

    test('an unknown tenant is answered as not found, by code', async () => {
        const platform = await aPlatform();

        await assert.rejects(
            () => platform.chargesOf('nowhere'),
            (error) => {
                assert.ok(error instanceof NotFoundException);
                assert.equal(error.getResponse().code, BILLING_ERROR_CODES.TENANT_NOT_FOUND);
                return true;
            },
        );
        assert.deepEqual(platform.seen.reads, []);
        await platform.moduleRef.close();
    });

    test("the tenant is found and its journal read outside the tenants' row-level policy", async () => {
        const platform = await aPlatform();

        await platform.chargesOf('northwind');

        assert.deepEqual(platform.seen.lookups, [{ slug: 'northwind', bypassed: true }]);
        assert.deepEqual(platform.seen.reads, [
            { subscriptionId: 'sub-northwind', bypassed: true },
        ]);
        await platform.moduleRef.close();
    });

    test('the journal the route reads is the one the platform writes to, built once', async () => {
        const platform = await aPlatform();

        await platform.chargesOf('northwind');

        assert.equal(platform.seen.built, 1);
        await platform.moduleRef.close();
    });

    for (const [without, options] of [
        ['a journal', { journal: false }],
        ['the tenants', { adminResources: false }],
    ]) {
        test(`without ${without}, neither the route nor the capability exists`, async () => {
            const platform = await aPlatform(options);

            assert.equal(platform.served, undefined);
            assert.equal(platform.manifest.capabilities['charges.read'], undefined);
            await platform.moduleRef.close();
        });
    }
});

// @requirement SC-ADM-028 — An operator reads a subscriber's charges beside its tenant
describe('mounted by hand', () => {
    /** The two services the route needs, from a module standing in for the platform's. */
    const services = {
        module: class PlatformServices {},
        providers: [
            { provide: AdminResourcesService, useValue: {} },
            { provide: SubscriberAccountService, useValue: {} },
        ],
        exports: [AdminResourcesService, SubscriberAccountService],
    };

    test('without the bypass port, it refuses to start rather than read in a tenant scope', async () => {
        await assert.rejects(
            () =>
                Test.createTestingModule({
                    imports: [SubscriberAccountModule.forRoot({ guards: [], imports: [services] })],
                }).compile(),
            /RlsBypassPort/,
        );
    });

    test('with it, it starts', async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                {
                    module: class Bypass {},
                    global: true,
                    providers: [
                        {
                            provide: RLS_BYPASS_PORT_TOKEN,
                            useValue: { runWithBypass: (fn) => fn() },
                        },
                    ],
                    exports: [RLS_BYPASS_PORT_TOKEN],
                },
                SubscriberAccountModule.forRoot({ guards: [], imports: [services] }),
            ],
        }).compile();
        await moduleRef.close();
    });
});
