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
    TenantDataExportController,
    TenantDataExportService,
    TenantExportDeliveryService,
    TrialEndService,
} from '../dist/billing/index.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../dist/entitlement/index.js';
import { storeSecretsInPlainText } from '../dist/index.js';
import { SaaSiCatModule, findViolations } from '../dist/platform/index.js';
import { FakeSubscriptionEndRepository } from '../dist/testing/index.js';
import {
    bootable,
    controllersIn,
    everythingOnOptions,
    handlersOf,
} from './helpers/operator-routes.js';
import { usageRecord } from './helpers/subscription-fixtures.js';
import { anExport } from './helpers/tenant-data-export.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

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
        assert.deepEqual(
            violations(withEnds({ store: {}, export: anExport() }, { bundleKeepsEnds: false })),
            [],
        );
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

        const own = await compiled(withEnds({ includeCron: false, export: anExport() }));
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

// @requirement SC-PRIV-020 — A tenant's administrator takes its full export, from the platform or the application
describe("the application's export, which the ends cannot start without", () => {
    const violationsOf = (options) =>
        findViolations({ options, adapters: { secretSealer: storeSecretsInPlainText() } }).filter(
            (violation) => violation.id === 'subscription-ends.requires-export',
        );

    test('serving tenants without it, the start is refused with one sentence naming the option, the port and why', () => {
        const [violation, ...more] = violationsOf(withEnds({}));
        assert.deepEqual(more, []);
        const message = String(violation?.message);
        assert.match(message, /`tenantBilling\.subscriptionEnds\.export` is missing/);
        assert.match(message, /TenantDataExportPort/);
        assert.match(
            message,
            /read-only period before the deletion day exists for the tenant to take it/,
        );
        assert.equal(message.split('. ').length, 1, 'one sentence');
    });

    test('given, nothing is refused', () => {
        assert.deepEqual(violationsOf(withEnds({ export: anExport() })), []);
    });

    test('without tenant billing, it is not asked for', () => {
        const { tenantBilling: _off, ...options } = withEnds({});
        assert.deepEqual(violationsOf(options), []);
    });

    test('tenant billing wired by hand with the ends and without it does not start, naming the option and the port', () => {
        assert.throws(
            () =>
                TenantBillingModule.forRoot({
                    authGuards: [class Guard {}],
                    subscriptionUsagePort: {},
                    usageSnapshotPort: {},
                    subscriptionWritePort: {},
                    subscriptionEnds: { store: new FakeSubscriptionEndRepository() },
                }),
            /TenantBillingModule: `subscriptionEnds\.export` is missing: .*TenantDataExportPort/,
        );
    });

    test('given, the route is mounted and the export is asked through the port given', async () => {
        const port = anExport();
        const moduleRef = await Test.createTestingModule({
            imports: [SaaSiCatModule.forRoot(bootable(withEnds({ export: port })))],
        }).compile();

        assert.ok(moduleRef.get(TenantDataExportController, { strict: false }));
        assert.equal(moduleRef.get(TenantDataExportService, { strict: false }).exports, port);
        await moduleRef.close();
    });
});

// @requirement SC-PRIV-020 — A tenant's administrator takes its full export, from the platform or the application
describe('the declaration that the application delivers the export itself', () => {
    const DELIVERED_BY_THE_APPLICATION = { deliveredBy: 'application' };
    const EXPORT_RULES = new Set([
        'subscription-ends.requires-export',
        'subscription-ends.export-delivered-by-the-application',
    ]);
    const violationsOf = (options) =>
        findViolations({ options, adapters: { secretSealer: storeSecretsInPlainText() } }).filter(
            (violation) => EXPORT_RULES.has(violation.id),
        );
    /** Every route the composed module declares, as `VERB path`. */
    const routesOf = (root) =>
        controllersIn(root).flatMap((controller) =>
            handlersOf(controller).map(({ route }) => route),
        );

    test('stands in for the port: nothing is refused', () => {
        assert.deepEqual(violationsOf(withEnds({ export: DELIVERED_BY_THE_APPLICATION })), []);
        assert.deepEqual(violationsOf(withEnds({ export: anExport() })), []);
    });

    test('naming anybody else as delivering it, the start is refused in one sentence naming the application', () => {
        for (const deliveredBy of ['app', 'platform', null]) {
            const [violation, ...more] = violationsOf(withEnds({ export: { deliveredBy } }));
            assert.deepEqual(more, [], String(deliveredBy));
            assert.equal(violation?.id, 'subscription-ends.export-delivered-by-the-application');
            const message = String(violation?.message);
            assert.ok(message.includes(`deliveredBy: ${JSON.stringify(deliveredBy)}`), message);
            assert.ok(message.includes("{ deliveredBy: 'application' }"), message);
            assert.equal(message.split('. ').length, 1, 'one sentence');
        }
    });

    test('tenant billing wired by hand with a declaration naming anybody else does not start', () => {
        assert.throws(
            () =>
                TenantBillingModule.forRoot({
                    authGuards: [class Guard {}],
                    subscriptionUsagePort: {},
                    usageSnapshotPort: {},
                    subscriptionWritePort: {},
                    notices: { port: sendingPort(), record: noticeRecord() },
                    subscriptionEnds: {
                        store: new FakeSubscriptionEndRepository(),
                        export: { deliveredBy: 'app' },
                    },
                }),
            /TenantBillingModule: `subscriptionEnds\.export` declares `deliveredBy: "app"`.*\{ deliveredBy: 'application' \}/,
        );
    });

    test('the refusal of a start with neither names both ways', () => {
        const [violation] = violationsOf(withEnds({}));
        assert.equal(violation?.id, 'subscription-ends.requires-export');
        assert.match(String(violation?.message), /TenantDataExportPort, or declares/);
        assert.match(String(violation?.message), /deliveredBy: 'application'/);
    });

    test('mounts no route of the platform for the export, and asks no port', async () => {
        const root = SaaSiCatModule.forRoot(
            bootable(withEnds({ export: DELIVERED_BY_THE_APPLICATION })),
        );
        const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();

        assert.ok(!routesOf(root).includes('GET billing/export'));
        assert.ok(
            routesOf(root).includes('GET billing/access'),
            'the tenant still reads its state',
        );
        assert.throws(() => moduleRef.get(TenantDataExportService, { strict: false }));
        assert.throws(() => moduleRef.get(TenantDataExportController, { strict: false }));
        await moduleRef.close();
    });

    test('hands the application the service it records each delivered download through', async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                SaaSiCatModule.forRoot(
                    bootable(withEnds({ export: DELIVERED_BY_THE_APPLICATION })),
                ),
            ],
        }).compile();

        assert.ok(
            moduleRef.get(TenantExportDeliveryService, { strict: false }) instanceof
                TenantExportDeliveryService,
        );
        await moduleRef.close();
    });

    test('where the platform serves the export, its route is mounted and no such service handed out', async () => {
        const root = SaaSiCatModule.forRoot(bootable(withEnds({ export: anExport() })));
        const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();

        assert.ok(routesOf(root).includes('GET billing/export'));
        assert.throws(() => moduleRef.get(TenantExportDeliveryService, { strict: false }));
        await moduleRef.close();
    });

    test('tenant billing wired by hand with it mounts no route for the export either', () => {
        const module = TenantBillingModule.forRoot({
            authGuards: [class Guard {}],
            subscriptionUsagePort: {},
            usageSnapshotPort: {},
            subscriptionWritePort: {},
            notices: { port: sendingPort(), record: noticeRecord() },
            subscriptionEnds: {
                store: new FakeSubscriptionEndRepository(),
                export: DELIVERED_BY_THE_APPLICATION,
            },
        });

        assert.ok(!module.controllers.includes(TenantDataExportController));
        assert.ok(module.exports.includes(TenantExportDeliveryService));
        assert.ok(!module.providers.includes(TenantDataExportService));
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
                    notices: subscriptionEnds
                        ? { port: sendingPort(), record: noticeRecord() }
                        : undefined,
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
        const route = await handWired({
            store: new FakeSubscriptionEndRepository(),
            export: anExport(),
        });
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
        endOfSubscription: { readOnlyDays: 30, reminderDaysBefore: [29, 10, 3] },
    },
    plans: [],
};

/** A running subscription whose term ends half past midnight into 1 January 2100 in Berlin. */
const RUNNING = usageRecord({
    id: 'sub-t1',
    billingCycle: 'MONTHLY',
    currentPeriodEnd: new Date('2099-12-31T23:30:00.000Z'),
});

/**
 * Starts the platform over a catalogue built in code whose `tenantBilling`
 * carries `sections` in place of the ones the helper writes.
 */
async function startedWith(sections, catalogue = {}) {
    const options = withEnds(undefined);
    const planCatalog = {
        ...options.planCatalog,
        ...catalogue,
        tenantBilling: { ...options.planCatalog.tenantBilling, ...sections },
    };
    const moduleRef = await Test.createTestingModule({
        imports: [SaaSiCatModule.forRoot(bootable({ ...options, planCatalog }))],
    }).compile();
    await moduleRef.close();
}

/** `endOfSubscription` with `change` applied to the helper's valid one. */
const endOfSubscription = (change) => ({
    endOfSubscription: { readOnlyDays: 30, reminderDaysBefore: [29, 10, 3], ...change },
});

/** Asserts that starting with `sections` is refused with `line` among the problems named. */
async function refusedNaming(sections, line) {
    await assert.rejects(startedWith(sections), (error) => {
        assert.ok(
            error.message.includes('was built in code: check the object passed to `planCatalog`'),
            error.message,
        );
        assert.ok(error.message.includes(`\n  ${line}`), error.message);
        return true;
    });
}

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('the lead times of a catalogue built in code', () => {
    test('left out, the start is refused, naming the field', async () => {
        await refusedNaming(
            { endOfSubscription: { readOnlyDays: 30 } },
            "tenantBilling.endOfSubscription.reminderDaysBefore: must have required property 'reminderDaysBefore'",
        );
    });

    for (const [given, line] of [
        [
            [],
            'tenantBilling.endOfSubscription.reminderDaysBefore: must NOT have fewer than 1 items',
        ],
        [[0], 'tenantBilling.endOfSubscription.reminderDaysBefore.0: must be >= 1'],
        [
            [3, 3],
            'tenantBilling.endOfSubscription.reminderDaysBefore: must NOT have duplicate items',
        ],
        [[2.5], 'tenantBilling.endOfSubscription.reminderDaysBefore.0: must be integer'],
        ['29', 'tenantBilling.endOfSubscription.reminderDaysBefore: must be array'],
    ]) {
        test(`given as ${JSON.stringify(given)}, the start is refused, naming the field`, async () => {
            await refusedNaming(endOfSubscription({ reminderDaysBefore: given }), line);
        });
    }

    test('given as [1], the smallest the schema takes, the application starts', async () => {
        await startedWith(endOfSubscription({ reminderDaysBefore: [1] }));
    });
});

// @requirement SC-CANC-027 — An ended subscription leaves the tenant a period to read and export before its deletion
describe('the read-only period of a catalogue built in code', () => {
    test('left out, the start is refused, naming the field', async () => {
        await refusedNaming(
            { endOfSubscription: { reminderDaysBefore: [29, 10, 3] } },
            "tenantBilling.endOfSubscription.readOnlyDays: must have required property 'readOnlyDays'",
        );
    });

    for (const [given, line] of [
        [0, 'tenantBilling.endOfSubscription.readOnlyDays: must be >= 1'],
        [1.5, 'tenantBilling.endOfSubscription.readOnlyDays: must be integer'],
    ]) {
        test(`given as ${given}, the start is refused, naming the field`, async () => {
            await refusedNaming(endOfSubscription({ readOnlyDays: given }), line);
        });
    }

    test('given as 1, the smallest the schema takes, the application starts', async () => {
        await startedWith(endOfSubscription({ readOnlyDays: 1 }));
    });

    test('beside a member the schema does not know, the start is refused, naming the member', async () => {
        await refusedNaming(
            endOfSubscription({ deleteAfterDays: 30 }),
            'tenantBilling.endOfSubscription.deleteAfterDays: must NOT have additional properties',
        );
    });

    test('malformed, it is refused while the application starts, before any run could read it', async () => {
        let compiled = false;
        await assert.rejects(
            startedWith(endOfSubscription({ readOnlyDays: 0 })).then(() => {
                compiled = true;
            }),
            /tenantBilling\.endOfSubscription\.readOnlyDays: must be >= 1/,
        );
        assert.equal(compiled, false, 'no module came up for a run to be scheduled in');
    });
});

describe('the other tenant billing sections of a catalogue built in code', () => {
    test('a negative notice period refuses the start, naming the field', async () => {
        await refusedNaming(
            { cancellationNoticeDays: { monthly: -1, yearly: 90 } },
            'tenantBilling.cancellationNoticeDays.monthly: must be >= 0',
        );
    });

    test('blocked plans without the list of plans not to leave refuse the start, naming the field', async () => {
        await refusedNaming(
            { selfServiceBlockedPlans: { asTarget: [] } },
            "tenantBilling.selfServiceBlockedPlans.asSource: must have required property 'asSource'",
        );
    });

    test('the rest of the catalogue is not held to the schema at start: a member it does not know still starts', async () => {
        await startedWith({}, { notInTheSchema: true });
    });
});
