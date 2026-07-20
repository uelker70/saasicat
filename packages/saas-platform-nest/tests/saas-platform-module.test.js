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

// Plattform-Sicherheits-Tests für das Quickstart-Mega-Modul.
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
    test('wirft, wenn weder planCatalog noch planCatalogReadSink gesetzt sind', () => {
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

    test('Quickstart-Pfad: planCatalog + 3 Adapter reichen', () => {
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
        assert.ok(Array.isArray(dyn.imports), 'imports muss Array sein');
        // PlanCatalog + Discovery + Admin + AdminManifest = 4 Sub-Module
        assert.equal(dyn.imports.length, 4, 'genau 4 Sub-Module ohne Entitlement');
        assert.equal(dyn.global, true, 'Mega-Modul ist global registriert');
    });

    test('Entitlement opt-in: aktiviert ohne Repos -> Fehler', () => {
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

    test('Entitlement aktiv mit allen Repos -> 5 Sub-Module', () => {
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
        assert.equal(dyn.imports.length, 5, 'mit Entitlement: 5 Sub-Module');
    });

    test('akzeptiert leere guards: [] als explizite Wahl', () => {
        const dyn = SaasPlatformModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [] },
            adapters: {
                mfa: new FakeMfaPort(),
                audit: new FakeAuditPort(),
                rlsBypass: new FakeRlsBypassPort(),
            },
        });
        assert.ok(dyn.imports, 'forRoot muss DynamicModule mit imports liefern');
    });

    test('ohne defaultPlanId & ohne planResolver: kein Lightweight-Stack', () => {
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
            'StaticEntitlementService darf ohne Resolver nicht exportiert sein',
        );
        const providers = dyn.providers ?? [];
        assert.equal(providers.length, 0, 'keine Lightweight-Provider ohne Resolver');
    });

    test('mit defaultPlanId: StaticPlanResolver + Guard + Interceptor auto-registriert', () => {
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
            'StaticEntitlementService muss Provider sein',
        );
        assert.ok(
            tokens.includes(StaticFeatureGuard),
            'StaticFeatureGuard muss Provider sein',
        );
        assert.ok(
            tokens.includes(EnforceQuotaInterceptor),
            'EnforceQuotaInterceptor muss Provider sein',
        );
        assert.ok(
            tokens.includes(PLAN_RESOLVER_PORT_TOKEN),
            'PLAN_RESOLVER_PORT_TOKEN muss Provider sein',
        );
        assert.ok(
            tokens.includes(QUOTA_PROVIDERS_TOKEN),
            'QUOTA_PROVIDERS_TOKEN muss Provider sein',
        );
    });

    test('mit quotaProviders: Klassen werden als Provider + im Registry-Token aggregiert', () => {
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
        assert.ok(tokens.includes(FakeQuotaProvider), 'QuotaProvider-Klasse als Provider');
        const registry = providers.find((p) => p.provide === QUOTA_PROVIDERS_TOKEN);
        assert.deepEqual(registry.inject, [FakeQuotaProvider]);
    });
});

describe('StaticEntitlementService (via StaticPlanResolver)', () => {
    test('snapshot liefert features+quotas aus dem Plan-Catalog', async () => {
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

    test('hasFeature + quotaLimit als Convenience-Methoden', async () => {
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

    test('snapshot bei nicht aufgelöstem Plan = leeres Set', async () => {
        const resolver = { async getPlanIdForTenant() { return null; } };
        const svc = new StaticEntitlementService(MINIMAL_CATALOG, resolver);
        const snap = await svc.snapshot('any');
        assert.equal(snap.planId, null);
        assert.deepEqual(snap.features, []);
    });
});
