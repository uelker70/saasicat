import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DiscoveryModule as NestDiscoveryModule } from '@nestjs/core';
import {
    AdminStatsService,
    CheckoutOfferService,
    SaaSiCatModule,
    SetupService,
    StaticEntitlementService,
    StaticFeatureGuard,
    SuperAdminGuard,
    SubscriptionContractService,
    EnforceQuotaInterceptor,
    PLAN_RESOLVER_PORT_TOKEN,
    QUOTA_PROVIDERS_TOKEN,
    StaticPlanResolver,
} from '../dist/platform/index.js';

// Platform safety tests for the quickstart mega-module.

class FakeJwtGuard {
    canActivate() {
        return true;
    }
}

class FakeMfaPort {
    async getSecret() {
        return null;
    }
    async setSecret() {}
    async isEnabled() {
        return false;
    }
}

class FakeAuditPort {
    async write() {}
}

class FakeRlsBypassPort {
    async runWithBypass(fn) {
        return fn();
    }
}

const MINIMAL_CATALOG = {
    schemaVersion: 1,
    projectKey: 'test-app',
    app: { name: 'TestApp', version: '0.0.1' },
    currency: 'EUR',
    vatRate: 19.0,
    plans: [],
};

const OPTIONAL_SERVICES_TOKEN = Symbol('optional-services');
class OptionalServicesConsumerModule {}
Module({
    providers: [
        {
            provide: OPTIONAL_SERVICES_TOKEN,
            useFactory: (setup, stats, checkout, contract) => ({
                setup,
                stats,
                checkout,
                contract,
            }),
            inject: [
                SetupService,
                AdminStatsService,
                CheckoutOfferService,
                SubscriptionContractService,
            ],
        },
    ],
    exports: [OPTIONAL_SERVICES_TOKEN],
})(OptionalServicesConsumerModule);

describe('SaaSiCatModule.forRoot', () => {
    test('throws when neither planCatalog nor planCatalogReadSink is set', () => {
        assert.throws(
            () =>
                SaaSiCatModule.forRoot({
                    controller: { guards: [FakeJwtGuard] },
                    adapters: {
                        mfa: new FakeMfaPort(),
                        audit: new FakeAuditPort(),
                        rlsBypass: new FakeRlsBypassPort(),
                    },
                }),
            /planCatalog.*planCatalogReadSink.*dbCatalog/,
        );
    });

    test('quickstart path: planCatalog + 3 adapters are enough', () => {
        const dyn = SaaSiCatModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [FakeJwtGuard] },
            adapters: {
                mfa: new FakeMfaPort(),
                audit: new FakeAuditPort(),
                rlsBypass: new FakeRlsBypassPort(),
            },
        });
        assert.equal(dyn.module.name, 'SaaSiCatModule');
        assert.ok(Array.isArray(dyn.imports), 'imports must be an array');
        // PlanCatalog + Discovery + Admin + AdminManifest = 4 sub-modules
        // Four platform sub-modules, plus Nest's own DiscoveryModule.
        //
        // The last one is in every configuration: `EnforcementChainCheck` runs
        // for all of them and walks the controllers, so it needs Nest's
        // discovery primitives. Registering it per branch — only where a
        // misconfiguration seemed possible — meant deciding in advance which
        // shapes can be wrong, in the file that produces the shapes.
        assert.equal(dyn.imports.length, 5, 'four sub-modules plus Nest DiscoveryModule');
        assert.ok(dyn.imports.includes(NestDiscoveryModule));
        assert.equal(dyn.global, true, 'mega-module is registered globally');
    });

    test('Entitlement opt-in: enabled without repos -> error', () => {
        assert.throws(
            () =>
                SaaSiCatModule.forRoot({
                    planCatalog: MINIMAL_CATALOG,
                    controller: { guards: [FakeJwtGuard] },
                    adapters: {
                        mfa: new FakeMfaPort(),
                        audit: new FakeAuditPort(),
                        rlsBypass: new FakeRlsBypassPort(),
                    },
                    entitlement: {},
                }),
            /entitlement active.*adapters are missing.*subscriptionRepository.*planVersionRepository.*transactionRunner/,
        );
    });

    test('Entitlement active with all repos -> 5 sub-modules', () => {
        const dyn = SaaSiCatModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [FakeJwtGuard] },
            adapters: {
                mfa: new FakeMfaPort(),
                audit: new FakeAuditPort(),
                rlsBypass: new FakeRlsBypassPort(),
                subscriptionRepository: { findActiveByTenantId: async () => null },
                planVersionRepository: { findById: async () => null },
                transactionRunner: { run: async (fn) => fn({}) },
            },
            entitlement: {},
        });
        assert.equal(dyn.imports.length, 6, 'with Entitlement: 5 sub-modules + discovery');
    });

    test('accepts empty guards: [] as an explicit choice', () => {
        const dyn = SaaSiCatModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [] },
            adapters: {
                mfa: new FakeMfaPort(),
                audit: new FakeAuditPort(),
                rlsBypass: new FakeRlsBypassPort(),
            },
        });
        assert.ok(dyn.imports, 'forRoot must return a DynamicModule with imports');
    });

    test('composes setup, admin stats, checkout offer and subscription contract', () => {
        const dyn = SaaSiCatModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [FakeJwtGuard] },
            adapters: {
                mfa: new FakeMfaPort(),
                audit: new FakeAuditPort(),
                rlsBypass: new FakeRlsBypassPort(),
            },
            setup: {
                provisioningPort: {
                    hasSuperAdmin: async () => false,
                    createSuperAdmin: async () => undefined,
                },
            },
            adminStats: {
                subscriptionStatsPort: { getSubscriptionStats: async () => ({}) },
                promoCodeStatsPort: { getPromoCodeStats: async () => ({}) },
                auditStatsPort: { getAuditStats: async () => ({}) },
            },
            checkoutOffer: {
                checkoutOfferRepository: {},
                controller: { guards: [] },
            },
            subscriptionContract: {
                subscriptionContractRepository: {},
            },
        });

        const moduleNames = dyn.imports.map((imported) => imported.module?.name);
        assert.ok(moduleNames.includes('SetupModule'));
        assert.ok(moduleNames.includes('AdminStatsModule'));
        assert.ok(moduleNames.includes('CheckoutOfferModule'));
        assert.ok(moduleNames.includes('SubscriptionContractModule'));
        assert.equal(dyn.imports.length, 9, 'four base + four optional + Nest discovery');

        const statsModule = dyn.imports.find(
            (imported) => imported?.module?.name === 'AdminStatsModule',
        );
        const guards = Reflect.getMetadata('__guards__', statsModule.controllers[0]);
        assert.deepEqual(guards, [FakeJwtGuard, SuperAdminGuard]);
    });

    test('setup and subscription contract can derive their adapters from persistence', () => {
        const provisioning = {};
        const contractRepository = {};
        const dyn = SaaSiCatModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [FakeJwtGuard] },
            persistence: {
                capabilities: {
                    transactions: true,
                    pessimisticLocking: true,
                    rowLevelSecurity: false,
                    advisoryLocks: false,
                },
                core: {
                    mfa: new FakeMfaPort(),
                    audit: new FakeAuditPort(),
                    rlsBypass: new FakeRlsBypassPort(),
                    transactionRunner: { run: async (fn) => fn({}) },
                    superAdminProvisioning: provisioning,
                },
                entitlement: {
                    subscriptionRepository: {},
                    planVersionRepository: {},
                    subscriptionContractRepository: contractRepository,
                },
            },
            setup: true,
            subscriptionContract: true,
        });

        const moduleNames = dyn.imports.map((imported) => imported.module?.name);
        assert.ok(moduleNames.includes('SetupModule'));
        assert.ok(moduleNames.includes('SubscriptionContractModule'));
    });

    test('the centrally composed optional services resolve in a real Nest container', async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [
                SaaSiCatModule.forRoot({
                    planCatalog: MINIMAL_CATALOG,
                    controller: { guards: [FakeJwtGuard] },
                    discoverySnapshotPath: null,
                    adapters: {
                        mfa: new FakeMfaPort(),
                        audit: new FakeAuditPort(),
                        rlsBypass: new FakeRlsBypassPort(),
                    },
                    setup: { provisioningPort: {} },
                    adminStats: {
                        subscriptionStatsPort: {},
                        promoCodeStatsPort: {},
                        auditStatsPort: {},
                    },
                    checkoutOffer: { checkoutOfferRepository: {} },
                    subscriptionContract: { subscriptionContractRepository: {} },
                }),
                OptionalServicesConsumerModule,
            ],
        }).compile();

        const services = moduleRef.get(OPTIONAL_SERVICES_TOKEN);
        assert.ok(services.setup);
        assert.ok(services.stats);
        assert.ok(services.checkout);
        assert.ok(services.contract);
        await moduleRef.close();
    });

    test('without defaultPlanId & without planResolver: no entitlement stack', () => {
        const dyn = SaaSiCatModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [FakeJwtGuard] },
            adapters: {
                mfa: new FakeMfaPort(),
                audit: new FakeAuditPort(),
                rlsBypass: new FakeRlsBypassPort(),
            },
        });
        const exports_ = dyn.exports ?? [];
        assert.equal(
            exports_.includes(StaticEntitlementService),
            false,
            'StaticEntitlementService must not be exported without a resolver',
        );
        const providers = dyn.providers ?? [];
        const tokens = providers.map((provider) => provider.provide ?? provider);
        assert.equal(
            tokens.includes(StaticEntitlementService),
            false,
            'no entitlement providers without a resolver',
        );
        // Standard-manifest registration, plus the two the inert case adds:
        // the chain check and the state that tells it which case it is in.
        assert.equal(providers.length, 3, 'manifest registration + the enforcement-chain check');
        assert.ok(
            providers.some((p) => typeof p === 'function' && p.name === 'EnforcementChainCheck'),
            'nothing would ask whether the inert annotations exist',
        );
    });

    test('with defaultPlanId: StaticPlanResolver + Guard + Interceptor auto-registered', () => {
        const dyn = SaaSiCatModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [FakeJwtGuard] },
            adapters: {
                mfa: new FakeMfaPort(),
                audit: new FakeAuditPort(),
                rlsBypass: new FakeRlsBypassPort(),
            },
            defaultPlanId: 'starter',
        });
        const providers = dyn.providers ?? [];
        const tokens = providers.map((p) => p.provide ?? p);
        assert.ok(
            tokens.includes(StaticEntitlementService),
            'StaticEntitlementService must be a provider',
        );
        assert.ok(tokens.includes(StaticFeatureGuard), 'StaticFeatureGuard must be a provider');
        assert.ok(
            tokens.includes(EnforceQuotaInterceptor),
            'EnforceQuotaInterceptor must be a provider',
        );
        assert.ok(
            tokens.includes(PLAN_RESOLVER_PORT_TOKEN),
            'PLAN_RESOLVER_PORT_TOKEN must be a provider',
        );
        assert.ok(
            tokens.includes(QUOTA_PROVIDERS_TOKEN),
            'QUOTA_PROVIDERS_TOKEN must be a provider',
        );
    });

    test('with quotaProviders: classes become providers + aggregated in the registry token', () => {
        class FakeQuotaProvider {
            constructor() {
                this.key = 'notes.max';
            }
            async count() {
                return 0;
            }
        }
        const dyn = SaaSiCatModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [FakeJwtGuard] },
            adapters: {
                mfa: new FakeMfaPort(),
                audit: new FakeAuditPort(),
                rlsBypass: new FakeRlsBypassPort(),
            },
            defaultPlanId: 'starter',
            quotaProviders: [FakeQuotaProvider],
        });
        const providers = dyn.providers ?? [];
        const tokens = providers.map((p) => p.provide ?? p);
        assert.ok(tokens.includes(FakeQuotaProvider), 'QuotaProvider class as provider');
        const registry = providers.find((p) => p.provide === QUOTA_PROVIDERS_TOKEN);
        assert.deepEqual(registry.inject, [FakeQuotaProvider]);
    });
});

describe('StaticEntitlementService (via StaticPlanResolver)', () => {
    test('snapshot returns features+quotas from the plan catalog', async () => {
        const catalog = {
            ...MINIMAL_CATALOG,
            plans: [
                { id: 'starter', features: ['NOTES'], quotas: { 'notes.max': 25 } },
                { id: 'pro', features: ['NOTES', 'EXPORT'], quotas: { 'notes.max': 1000 } },
            ],
        };
        const resolver = new StaticPlanResolver('pro');
        const svc = new StaticEntitlementService(catalog, resolver);
        const snap = await svc.snapshot('any-tenant');
        assert.equal(snap.planId, 'pro');
        assert.deepEqual(snap.features, ['NOTES', 'EXPORT']);
        assert.equal(snap.quotas['notes.max'], 1000);
    });

    test('hasFeature + quotaLimit as convenience methods', async () => {
        const catalog = {
            ...MINIMAL_CATALOG,
            plans: [{ id: 'starter', features: ['NOTES'], quotas: { 'notes.max': 25 } }],
        };
        const svc = new StaticEntitlementService(catalog, new StaticPlanResolver('starter'));
        assert.equal(await svc.hasFeature('t', 'NOTES'), true);
        assert.equal(await svc.hasFeature('t', 'EXPORT'), false);
        assert.equal(await svc.quotaLimit('t', 'notes.max'), 25);
        assert.equal(await svc.quotaLimit('t', 'unbekannt'), null);
    });

    test('snapshot with an unresolved plan = empty set', async () => {
        const resolver = {
            async getPlanIdForTenant() {
                return null;
            },
        };
        const svc = new StaticEntitlementService(MINIMAL_CATALOG, resolver);
        const snap = await svc.snapshot('any');
        assert.equal(snap.planId, null);
        assert.deepEqual(snap.features, []);
    });
});
