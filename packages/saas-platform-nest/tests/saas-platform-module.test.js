import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SaasPlatformModule,
    StaticEntitlementService,
    StaticFeatureGuard,
    EnforceQuotaInterceptor,
    PLAN_RESOLVER_PORT_TOKEN,
    QUOTA_PROVIDERS_TOKEN,
    StaticPlanResolver,
} from '../dist/platform/index.js';

// Platform safety tests for the quickstart mega-module.
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P1.

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

describe('SaasPlatformModule.forRoot', () => {
    test('throws when neither planCatalog nor planCatalogReadSink is set', () => {
        assert.throws(
            () =>
                SaasPlatformModule.forRoot({
                    controller: { guards: [FakeJwtGuard] },
                    adapters: {
                        mfa: new FakeMfaPort(),
                        audit: new FakeAuditPort(),
                        rlsBypass: new FakeRlsBypassPort(),
                    },
                }),
            /planCatalog.*oder.*planCatalogReadSink/,
        );
    });

    test('quickstart path: planCatalog + 3 adapters are enough', () => {
        const dyn = SaasPlatformModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [FakeJwtGuard] },
            adapters: {
                mfa: new FakeMfaPort(),
                audit: new FakeAuditPort(),
                rlsBypass: new FakeRlsBypassPort(),
            },
        });
        assert.equal(dyn.module.name, 'SaasPlatformModule');
        assert.ok(Array.isArray(dyn.imports), 'imports must be an array');
        // PlanCatalog + Discovery + Admin + AdminManifest = 4 sub-modules
        assert.equal(dyn.imports.length, 4, 'exactly 4 sub-modules without Entitlement');
        assert.equal(dyn.global, true, 'mega-module is registered globally');
    });

    test('Entitlement opt-in: enabled without repos -> error', () => {
        assert.throws(
            () =>
                SaasPlatformModule.forRoot({
                    planCatalog: MINIMAL_CATALOG,
                    controller: { guards: [FakeJwtGuard] },
                    adapters: {
                        mfa: new FakeMfaPort(),
                        audit: new FakeAuditPort(),
                        rlsBypass: new FakeRlsBypassPort(),
                    },
                    entitlement: {},
                }),
            /entitlement.*Adapter fehlen.*subscriptionRepository.*planVersionRepository.*transactionRunner/,
        );
    });

    test('Entitlement active with all repos -> 5 sub-modules', () => {
        const dyn = SaasPlatformModule.forRoot({
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
        assert.equal(dyn.imports.length, 5, 'with Entitlement: 5 sub-modules');
    });

    test('accepts empty guards: [] as an explicit choice', () => {
        const dyn = SaasPlatformModule.forRoot({
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

    test('without defaultPlanId & without planResolver: no lightweight stack', () => {
        const dyn = SaasPlatformModule.forRoot({
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
        assert.equal(providers.length, 0, 'no lightweight providers without a resolver');
    });

    test('with defaultPlanId: StaticPlanResolver + Guard + Interceptor auto-registered', () => {
        const dyn = SaasPlatformModule.forRoot({
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
        assert.ok(
            tokens.includes(StaticFeatureGuard),
            'StaticFeatureGuard must be a provider',
        );
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
        const dyn = SaasPlatformModule.forRoot({
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
        const resolver = { async getPlanIdForTenant() { return null; } };
        const svc = new StaticEntitlementService(MINIMAL_CATALOG, resolver);
        const snap = await svc.snapshot('any');
        assert.equal(snap.planId, null);
        assert.deepEqual(snap.features, []);
    });
});
