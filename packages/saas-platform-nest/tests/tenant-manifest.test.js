import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    StaticEntitlementService,
    StaticPlanResolver,
    TenantManifestService,
    SaasPlatformModule,
    buildTenantManifestController,
} from '../dist/platform/index.js';

// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P14.

const CATALOG = {
    schemaVersion: 1,
    projectKey: 'app',
    currency: 'EUR',
    vatRate: 19,
    plans: [
        { id: 'starter', features: ['NOTES'], quotas: { 'notes.max': 25 } },
        { id: 'pro', features: ['NOTES', 'EXPORT'], quotas: { 'notes.max': 1000 } },
    ],
};

describe('TenantManifestService', () => {
    test('returns a snapshot with filtered NavItems (feature gate)', async () => {
        const ent = new StaticEntitlementService(CATALOG, new StaticPlanResolver('starter'));
        const svc = new TenantManifestService(ent);
        svc.registerNavItem({ id: 'notes', label: 'Notizen', path: '/notes', requiresFeature: 'NOTES' });
        svc.registerNavItem({
            id: 'export',
            label: 'Export',
            path: '/export',
            requiresFeature: 'EXPORT',
        });
        svc.registerNavItem({ id: 'home', label: 'Home', path: '/' });

        const m = await svc.getManifest('t1');
        const ids = m.navigation.map((n) => n.id);
        assert.ok(ids.includes('notes'), 'NOTES feature active → notes item');
        assert.ok(!ids.includes('export'), 'EXPORT missing from plan → no export item');
        assert.ok(ids.includes('home'), 'unconditional item stays');
        assert.equal(m.planId, 'starter');
        assert.deepEqual(m.features, ['NOTES']);
        assert.equal(m.quotas['notes.max'], 25);
        assert.equal(m.tenant.id, 't1');
    });

    test('sorts NavItems by order ASC, default 100', async () => {
        const ent = new StaticEntitlementService(CATALOG, new StaticPlanResolver('pro'));
        const svc = new TenantManifestService(ent);
        svc.registerNavItem({ id: 'a', label: 'A', path: '/a', order: 200 });
        svc.registerNavItem({ id: 'b', label: 'B', path: '/b', order: 50 });
        svc.registerNavItem({ id: 'c', label: 'C', path: '/c' });
        const m = await svc.getManifest('t');
        assert.deepEqual(
            m.navigation.map((n) => n.id),
            ['b', 'c', 'a'],
        );
    });

    test('requiresFeature as an array = logical OR', async () => {
        const ent = new StaticEntitlementService(CATALOG, new StaticPlanResolver('starter'));
        const svc = new TenantManifestService(ent);
        svc.registerNavItem({
            id: 'either',
            label: 'Either',
            path: '/x',
            requiresFeature: ['NOTES', 'NOPE'],
        });
        svc.registerNavItem({
            id: 'neither',
            label: 'Neither',
            path: '/y',
            requiresFeature: ['NOPE1', 'NOPE2'],
        });
        const m = await svc.getManifest('t');
        const ids = m.navigation.map((n) => n.id);
        assert.ok(ids.includes('either'));
        assert.ok(!ids.includes('neither'));
    });

    test('registerNavItem is idempotent (same id overwrites)', async () => {
        const ent = new StaticEntitlementService(CATALOG, new StaticPlanResolver('starter'));
        const svc = new TenantManifestService(ent);
        svc.registerNavItem({ id: 'home', label: 'Alt', path: '/' });
        svc.registerNavItem({ id: 'home', label: 'Neu', path: '/' });
        const m = await svc.getManifest('t');
        assert.equal(m.navigation.length, 1);
        assert.equal(m.navigation[0].label, 'Neu');
    });
});

describe('SaasPlatformModule + tenantManifest', () => {
    class FakeMfa {
        async getSecret() {
            return null;
        }
        async setSecret() {}
        async isEnabled() {
            return false;
        }
    }
    class FakeAudit {
        async write() {}
    }
    class FakeRls {
        async runWithBypass(fn) {
            return fn();
        }
    }

    test('tenantManifest without defaultPlanId/resolver throws', () => {
        assert.throws(
            () =>
                SaasPlatformModule.forRoot({
                    planCatalog: CATALOG,
                    controller: { guards: [] },
                    adapters: {
                        mfa: new FakeMfa(),
                        audit: new FakeAudit(),
                        rlsBypass: new FakeRls(),
                    },
                    tenantManifest: { guards: [] },
                }),
            /tenantManifest.*defaultPlanId.*planResolver/,
        );
    });

    test('tenantManifest + defaultPlanId registers controller + service', () => {
        const dyn = SaasPlatformModule.forRoot({
            planCatalog: CATALOG,
            controller: { guards: [] },
            adapters: {
                mfa: new FakeMfa(),
                audit: new FakeAudit(),
                rlsBypass: new FakeRls(),
            },
            defaultPlanId: 'starter',
            tenantManifest: { guards: [] },
        });
        assert.equal(dyn.controllers?.length, 1, 'exactly one tenant-manifest controller');
        const tokens = (dyn.providers ?? []).map((p) => p.provide ?? p);
        assert.ok(tokens.includes(TenantManifestService));
    });
});

describe('buildTenantManifestController', () => {
    test('creates a controller class with the configured path', () => {
        const Ctrl = buildTenantManifestController({ guards: [], path: 'my/custom' });
        assert.equal(typeof Ctrl, 'function');
    });
});
