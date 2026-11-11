// What serving tenants wires in for the subscriptions that end, and the
// configuration it refuses: an end nobody can record is a deletion day nobody
// is told (`SC-CANC-027`).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import {
    EndAtOnceService,
    PlanCatalogModule,
    SubscriptionCancellationService,
    SubscriptionEndCron,
    SubscriptionEndService,
    TenantBillingController,
    TenantBillingModule,
    TrialEndService,
} from '../dist/billing/index.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../dist/entitlement/index.js';
import { storeSecretsInPlainText } from '../dist/index.js';
import { SaaSiCatModule, findViolations } from '../dist/platform/index.js';
import { FakeSubscriptionEndRepository } from '../dist/testing/index.js';
import { bootable, everythingOnOptions } from './helpers/operator-routes.js';
import { usageRecord } from './helpers/subscription-fixtures.js';

/** The platform's options with `subscriptionEnds` as given, and the bundle's store kept or not. */
function withEnds(subscriptionEnds, { bundleKeepsEnds = true } = {}) {
    const options = everythingOnOptions();
    const { subscriptionEnds: store, ...core } = options.persistence.core;
    return {
        ...options,
        persistence: {
            ...options.persistence,
            core: bundleKeepsEnds ? { ...core, subscriptionEnds: store } : core,
        },
        tenantBilling: subscriptionEnds
            ? { ...options.tenantBilling, subscriptionEnds }
            : options.tenantBilling,
    };
}

// @requirement SC-CANC-027 — An ended subscription leaves the tenant a period to read and export before its deletion
describe('the configuration the ends need', () => {
    const violations = (options) =>
        findViolations({ options, adapters: { secretSealer: storeSecretsInPlainText() } })
            .map((violation) => violation.id)
            .filter((id) => id.startsWith('subscription-ends.'));

    test('serving tenants with nowhere to keep the ends, the start is refused, naming the rule', () => {
        assert.deepEqual(violations(withEnds(undefined, { bundleKeepsEnds: false })), [
            'subscription-ends.requires-store',
        ]);
    });

    test("the bundle's store, or one named, is enough", () => {
        assert.deepEqual(violations(withEnds(undefined)), []);
        assert.deepEqual(violations(withEnds({ store: {} }, { bundleKeepsEnds: false })), []);
    });

    test('without tenant billing, nothing is asked for', () => {
        const { tenantBilling: _off, ...options } = withEnds(undefined, { bundleKeepsEnds: false });
        assert.deepEqual(violations(options), []);
    });
});

// @requirement SC-CANC-027 — An ended subscription leaves the tenant a period to read and export before its deletion
describe('an installation that serves tenants', () => {
    async function compiled(options) {
        const moduleRef = await Test.createTestingModule({
            imports: [SaaSiCatModule.forRoot(bootable(options))],
        }).compile();
        // Nest answers a provider nobody registered with an exception, not null.
        const find = (type) => {
            try {
                return moduleRef.get(type, { strict: false });
            } catch (error) {
                if (error?.constructor?.name === 'UnknownElementException') return null;
                throw error;
            }
        };
        return {
            service: find(SubscriptionEndService),
            cron: find(SubscriptionEndCron),
            trials: find(TrialEndService),
        };
    }

    test('records the ends every quarter of an hour unless told not to', async () => {
        const on = await compiled(withEnds(undefined));
        assert.ok(on.service instanceof SubscriptionEndService);
        assert.ok(on.cron instanceof SubscriptionEndCron);
        assert.ok(on.trials instanceof TrialEndService, 'and the way an application ends a trial');

        const own = await compiled(withEnds({ includeCron: false }));
        assert.ok(
            own.service instanceof SubscriptionEndService,
            'callable from a scheduler of its own',
        );
        assert.equal(own.cron, null);
    });

    test('refuses to start where the file says nothing of the end, naming the setting', async () => {
        const options = withEnds(undefined);
        const { endOfSubscription: _missing, ...tenantBilling } = options.planCatalog.tenantBilling;
        await assert.rejects(
            compiled({ ...options, planCatalog: { ...options.planCatalog, tenantBilling } }),
            /tenantBilling\.endOfSubscription/,
        );
    });
});

describe('the routes a tenant ends its subscription through', () => {
    // @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
    // @requirement SC-CANC-029 — A tenant that ends its subscription at once is told the deletion day first
    test('are handed the service that records the ends, where serving tenants composes it', async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [SaaSiCatModule.forRoot(bootable(withEnds(undefined)))],
        }).compile();
        const service = moduleRef.get(SubscriptionEndService, { strict: false });

        assert.ok(service instanceof SubscriptionEndService);
        assert.equal(
            moduleRef.get(SubscriptionCancellationService, { strict: false }).subscriptionEnds,
            service,
        );
        assert.equal(moduleRef.get(EndAtOnceService, { strict: false }).subscriptionEnds, service);
        await moduleRef.close();
    });

    /** Tenant billing wired by hand over one running subscription, with `subscriptionEnds` or without. */
    async function handWired(subscriptionEnds) {
        const moduleRef = await Test.createTestingModule({
            imports: [
                PlanCatalogModule.forRootWithCatalog(HAND_WIRED_CATALOG),
                {
                    module: class FakeEntitlementModule {},
                    global: true,
                    providers: [
                        {
                            provide: ENTITLEMENT_SERVICE_TOKEN,
                            useValue: {
                                computeLimits: async () => ({
                                    plan: 'STARTER',
                                    quotas: {},
                                    features: new Set(),
                                }),
                                invalidateTenant() {},
                            },
                        },
                    ],
                    exports: [ENTITLEMENT_SERVICE_TOKEN],
                },
                TenantBillingModule.forRoot({
                    authGuards: [class Guard {}],
                    subscriptionUsagePort: {
                        findForTenant: async () => RUNNING,
                        listCancelled: async () => [],
                    },
                    usageSnapshotPort: { snapshot: async () => ({}) },
                    subscriptionWritePort: {},
                    subscriptionEnds,
                }),
            ],
        }).compile();
        return moduleRef.get(TenantBillingController, { strict: false });
    }

    test('wired by hand without the ends, start, and the account tells no deletion day', async () => {
        const route = await handWired(undefined);
        const usage = await route.getUsage({ user: { tenantId: 't1', sub: 'u1' }, headers: {} });
        assert.equal(usage.cancellation.deletion, null);
        assert.equal(usage.announcedDeletion, null);
    });

    // @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
    test('wired by hand with them, the account tells the day', async () => {
        const route = await handWired({ store: new FakeSubscriptionEndRepository() });
        const usage = await route.getUsage({ user: { tenantId: 't1', sub: 'u1' }, headers: {} });
        assert.deepEqual(usage.cancellation.deletion, {
            readOnlyDays: 30,
            readOnlyUntil: '2100-01-30',
            deletesOn: '2100-01-31',
        });
    });
});

/** A catalogue as `config/saas.yaml` gives it to a module wired by hand, in Berlin. */
const HAND_WIRED_CATALOG = {
    schemaVersion: 1,
    app: { name: 'Probe', version: '0.0.1' },
    currency: 'EUR',
    vatRate: 19,
    timeZone: 'Europe/Berlin',
    tenantBilling: {
        cancellationNoticeDays: { monthly: 0, yearly: 0 },
        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
        endOfSubscription: { readOnlyDays: 30 },
    },
    plans: [],
};

/** A running subscription whose term ends half past midnight into 1 January 2100 in Berlin. */
const RUNNING = usageRecord({
    id: 'sub-t1',
    billingCycle: 'MONTHLY',
    currentPeriodEnd: new Date('2099-12-31T23:30:00.000Z'),
});
