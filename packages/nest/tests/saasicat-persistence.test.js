import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
    AdminManifestService,
    QUOTA_PROVIDERS_TOKEN,
    QuotaProvidersUsageSnapshot,
    SaaSiCatModule,
    StaticEntitlementService,
    SubscriptionPlanResolver,
    defineSaaSiCat,
} from '../dist/platform/index.js';

// forRoot wiring of the `persistence` bundle option (adapter bundles from
// e.g. @saasicat/adapter-prisma) incl. the capability fail-fast.

const planCatalog = {
    schemaVersion: 1,
    app: { name: 'NotesApp' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling: {
        cancellationNoticeDays: { monthly: 0, yearly: 0 },
        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
    },
    plans: [],
};

function fakeBundle(capabilityOverrides = {}) {
    const spec = { useFactory: () => ({}), inject: [] };
    return {
        capabilities: {
            transactions: true,
            pessimisticLocking: true,
            rowLevelSecurity: false,
            advisoryLocks: false,
            ...capabilityOverrides,
        },
        core: {
            mfa: spec,
            audit: spec,
            rlsBypass: spec,
            transactionRunner: spec,
        },
        entitlement: {
            subscriptionRepository: spec,
            planVersionRepository: spec,
        },
        planCatalogReadSink: spec,
    };
}

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide
describe('SaaSiCatModule persistence bundle', () => {
    test('forRoot wires from a bundle without individual adapters', () => {
        const mod = SaaSiCatModule.forRoot({
            planCatalog,
            controller: { guards: [] },
            persistence: fakeBundle(),
        });
        assert.ok(mod.module);
        assert.ok(Array.isArray(mod.imports));
    });

    test('missing core adapters are reported by name', () => {
        assert.throws(
            () => SaaSiCatModule.forRoot({ planCatalog, controller: { guards: [] } }),
            /mfa, audit, rlsBypass/,
        );
    });

    test('entitlement pulls repositories + transaction runner from the bundle', () => {
        const mod = SaaSiCatModule.forRoot({
            planCatalog,
            controller: { guards: [] },
            persistence: fakeBundle(),
            entitlement: {},
        });
        assert.ok(mod.imports.length >= 5, 'EntitlementModule must be included');
    });

    test('entitlement without required capabilities fails fast at boot', () => {
        assert.throws(
            () =>
                SaaSiCatModule.forRoot({
                    planCatalog,
                    controller: { guards: [] },
                    persistence: fakeBundle({ pessimisticLocking: false }),
                    entitlement: {},
                }),
            (err) => {
                assert.equal(err.code, 'PERSISTENCE_CAPABILITY_MISSING');
                assert.match(err.message, /pessimisticLocking/);
                assert.match(err.message, /enforceLimit/);
                return true;
            },
        );
    });

    test('explicit adapters combine with a bundle', () => {
        const explicitMfa = { getSecret: async () => null };
        const mod = SaaSiCatModule.forRoot({
            planCatalog,
            controller: { guards: [] },
            persistence: fakeBundle(),
            adapters: { mfa: explicitMfa },
        });
        assert.ok(mod.module);
    });

    test('DB hydration forwards the dbCatalog identity to the plan-catalog factory', async () => {
        let loads = 0;
        const sink = {
            loadSnapshot: async () => {
                loads++;
                return { plans: [], livePlanVersions: [], featureEntries: [] };
            },
        };
        const mod = SaaSiCatModule.forRoot({
            controller: { guards: [] },
            persistence: fakeBundle(),
            adapters: { planCatalogReadSink: sink },
            dbCatalog: { app: { name: 'NotesApp' }, currency: 'EUR', vatRate: 19 },
        });

        const planCatalogModule = mod.imports[0];
        const catalogFactory = planCatalogModule.providers.find(
            (provider) => typeof provider.useFactory === 'function',
        );
        const catalog = await catalogFactory.useFactory(sink);

        assert.equal(loads, 1);
        assert.equal(catalog.app.name, 'NotesApp');
        assert.equal(catalog.currency, 'EUR');
        assert.equal(catalog.vatRate, 19);
    });

    test('DB hydration without dbCatalog fails fast instead of loading an empty catalog', () => {
        assert.throws(
            () =>
                SaaSiCatModule.forRoot({
                    controller: { guards: [] },
                    persistence: fakeBundle(), // provides a read sink, but no identity
                }),
            /dbCatalog/,
        );
    });

    test('the mega module COMPILES through Nest DI with a bundle (boot smoke)', async () => {
        // forRoot() is a pure function — only a real compile catches DI wiring
        // bugs like exporting an imported module's token (UnknownExportException).
        const instanceBundle = {
            capabilities: {
                transactions: true,
                pessimisticLocking: true,
                rowLevelSecurity: false,
                advisoryLocks: false,
            },
            core: {
                mfa: {
                    getSecret: async () => null,
                    setSecret: async () => {},
                    isEnabled: async () => false,
                },
                audit: { write: async () => {} },
                rlsBypass: { runWithBypass: (fn) => fn() },
                transactionRunner: { run: (fn) => fn({}) },
            },
        };
        const moduleRef = await Test.createTestingModule({
            imports: [
                SaaSiCatModule.forRoot({
                    planCatalog: {
                        ...planCatalog,
                        plans: [{ id: 'STARTER', features: ['NOTES'], quotas: { notesMax: 25 } }],
                    },
                    controller: { guards: [] },
                    persistence: instanceBundle,
                    defaultPlanId: 'STARTER',
                }),
            ],
        }).compile();

        const entitlement = moduleRef.get(StaticEntitlementService);
        const snapshot = await entitlement.snapshot('tenant-a');
        assert.equal(snapshot.planId, 'STARTER');
        assert.ok(snapshot.features.includes('NOTES'));
        await moduleRef.close();
    });

    test('bundle without entitlement slice still requires repositories for entitlement', () => {
        const bundle = fakeBundle();
        delete bundle.entitlement;
        assert.throws(
            () =>
                SaaSiCatModule.forRoot({
                    planCatalog,
                    controller: { guards: [] },
                    persistence: bundle,
                    entitlement: {},
                }),
            /subscriptionRepository, planVersionRepository/,
        );
    });

    test('the high-level standard stack wires catalog and tenant billing from one bundle', () => {
        const bundle = fakeBundle();
        bundle.catalog = {
            planRepository: {},
            bundleRepository: {},
            catalogEntryRepository: {},
            marketingProjectionRepository: {},
            promotionRepository: {},
            marketingSettingsRepository: {},
        };
        bundle.tenantBilling = {
            subscriptionUsagePort: {},
            subscriptionWritePort: {},
        };
        bundle.entitlement.subscriptionBundleRepository = {};
        bundle.entitlement.bundleRepository = bundle.catalog.bundleRepository;
        bundle.adminResources = { resources: {} };
        bundle.promo = {
            promoCodeRepository: {},
            redemptionRepository: {},
            validationLogRepository: {},
            subscriptionLookup: {},
            revenueAggregator: {},
        };

        const mod = SaaSiCatModule.forRoot(
            defineSaaSiCat({
                planCatalog,
                controller: { guards: [] },
                persistence: bundle,
                catalog: {
                    featureUiRegistry: {},
                    autoSyncDiscoveryAtBoot: false,
                },
                tenantBilling: { authGuards: [] },
                subscriptionBundles: true,
                adminResources: true,
                promoCodes: true,
                tenantManifest: true,
            }),
        );

        // Base 4 + Entitlement + Catalog + PublicCatalog + TenantBilling +
        // Bundles + AdminResources + PromoCodes.
        // Ten platform modules plus Nest's DiscoveryModule, which every
        // configuration imports for `EnforcementChainCheck`.
        assert.equal(mod.imports.length, 12);
        assert.ok(mod.exports.some((entry) => entry.name === 'CatalogModule'));
        assert.ok(mod.exports.some((entry) => entry.name === 'TenantBillingModule'));
        assert.ok(
            mod.providers.some((provider) =>
                provider.provide?.description?.includes('PlanResolver'),
            ),
            'subscription-backed plan resolver is auto-wired',
        );
    });

    test('the high-level standard stack compiles through Nest DI', async () => {
        const emptyRepository = {};
        class FakeQuotaProvider {
            constructor() {
                this.key = 'notesMax';
            }
            async count() {
                return 0;
            }
        }
        const clientToken = Symbol('NON_GLOBAL_CLIENT');
        class LocalClientModule {}
        Module({
            providers: [{ provide: clientToken, useValue: {} }],
            exports: [clientToken],
        })(LocalClientModule);
        const planRepository = {
            listVersions: async () => [],
            findVersionById: async () => null,
            findCurrentDraft: async () => null,
            findLatestLivePlanVersion: async () => null,
            createPlanVersionDraft: async () => null,
            updatePlanVersionDraft: async () => null,
            publishPlanVersionDraft: async () => null,
        };
        const bundle = {
            capabilities: {
                transactions: true,
                pessimisticLocking: true,
                rowLevelSecurity: false,
                advisoryLocks: false,
            },
            core: {
                mfa: {
                    getSecret: async () => null,
                    setSecret: async () => {},
                    isEnabled: async () => false,
                },
                audit: { write: async () => {} },
                rlsBypass: { runWithBypass: (fn) => fn() },
                transactionRunner: { run: (fn) => fn({}) },
            },
            entitlement: {
                subscriptionRepository: {
                    useFactory: () => ({
                        findByTenantId: async () => null,
                        findByTenantIdLocked: async () => null,
                    }),
                    inject: [clientToken],
                },
                planVersionRepository: { findById: async () => null },
                subscriptionBundleRepository: emptyRepository,
                bundleRepository: emptyRepository,
            },
            catalog: {
                planRepository,
                bundleRepository: emptyRepository,
                catalogEntryRepository: emptyRepository,
                marketingProjectionRepository: emptyRepository,
                promotionRepository: emptyRepository,
                marketingSettingsRepository: emptyRepository,
            },
            tenantBilling: {
                subscriptionUsagePort: { findForTenant: async () => null },
                subscriptionWritePort: emptyRepository,
            },
            adminResources: {
                resources: {
                    listTenants: async () => [],
                    getTenantDetail: async () => null,
                    setTenantActive: async () => null,
                    listUsers: async () => [],
                    listAudit: async () => [],
                    listSubscriptions: async () => [],
                },
            },
            promo: {
                promoCodeRepository: emptyRepository,
                redemptionRepository: emptyRepository,
                validationLogRepository: emptyRepository,
                subscriptionLookup: emptyRepository,
                revenueAggregator: emptyRepository,
            },
        };
        const moduleRef = await Test.createTestingModule({
            imports: [
                SaaSiCatModule.forRoot({
                    planCatalog,
                    controller: { guards: [] },
                    imports: [LocalClientModule],
                    persistence: bundle,
                    catalog: {
                        featureUiRegistry: {},
                        adminControllers: false,
                        autoSyncDiscoveryAtBoot: false,
                    },
                    tenantBilling: { authGuards: [] },
                    subscriptionBundles: true,
                    adminResources: true,
                    promoCodes: true,
                    quotaProviders: [FakeQuotaProvider],
                    tenantManifest: true,
                }),
            ],
        }).compile();

        assert.ok(moduleRef.get(StaticEntitlementService));
        assert.equal(moduleRef.get(QUOTA_PROVIDERS_TOKEN)[0].key, 'notesMax');
        const manifest = moduleRef.get(AdminManifestService).getManifest();
        assert.equal(manifest.capabilities['tenants.read'], true);
        assert.equal(manifest.capabilities['promoCodes.read'], true);
        assert.equal(manifest.navigation.standardPages?.subscriptions?.enabled, true);
        await moduleRef.close();
    });
});

// @requirement SC-COMP-011 — Every data-access implementation is held to the same executable contract
// @requirement SC-COMP-012 — Where one implementation cannot do what another can, the gap is recorded
describe('standard adapters', () => {
    test('SubscriptionPlanResolver only grants active subscriptions', async () => {
        const repository = {
            async findByTenantId(tenantId) {
                return tenantId === 'active'
                    ? { plan: 'PRO', status: 'ACTIVE' }
                    : { plan: 'PRO', status: 'CANCELED' };
            },
        };
        const resolver = new SubscriptionPlanResolver(repository);
        assert.equal(await resolver.getPlanIdForTenant('active'), 'PRO');
        assert.equal(await resolver.getPlanIdForTenant('canceled'), null);
    });

    test('QuotaProvidersUsageSnapshot reuses every quota counter', async () => {
        const snapshot = new QuotaProvidersUsageSnapshot([
            { key: 'notesMax', count: async () => 7 },
            { key: 'storageGb', count: async () => 1.5 },
        ]);
        assert.deepEqual(await snapshot.snapshot('tenant-a'), {
            notesMax: 7,
            storageGb: 1.5,
        });
    });
});
