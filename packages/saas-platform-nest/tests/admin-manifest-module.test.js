import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AdminManifestModule } from '../dist/admin/index.js';

// Platform security: AdminManifestModule.forRoot() must NEVER silently
// register a manifest endpoint without auth. If the consumer sets
// `includeManifestController: true` (default) and no `guards`, forRoot()
// MUST throw — otherwise an unprotected `GET /admin/manifest` route slips
// into production. Spec: SUPERADMIN findings §1.

const MINIMAL_CONFIG = {
    project: { key: 'test-app', displayName: 'Test', environment: 'development' },
    build: { platformPackageVersion: '0.0.0', appVersion: '0.0.0' },
    planCatalogSnapshot: {
        source: 'test',
        hash: 'sha256-x',
        currency: 'EUR',
        vatRate: 0,
        plans: [],
        features: [],
    },
};

class FakeJwtGuard {
    canActivate() {
        return true;
    }
}

class FakeSuperAdminGuard {
    canActivate() {
        return true;
    }
}

describe('AdminManifestModule.forRoot — guard configuration', () => {
    test('throws when the controller should be registered and `guards` is missing', () => {
        assert.throws(
            () =>
                AdminManifestModule.forRoot({
                    config: MINIMAL_CONFIG,
                    // includeManifestController defaults to true, guards is missing
                }),
            /guards.*Pflicht/,
        );
    });

    test('accepts empty `guards: []` as an explicit auth-free choice', () => {
        const dyn = AdminManifestModule.forRoot({
            config: MINIMAL_CONFIG,
            guards: [],
        });
        assert.ok(Array.isArray(dyn.controllers), 'controllers must be an array');
        // PublicBoot + generated Manifest = 2 controllers
        assert.equal(dyn.controllers?.length, 2);
    });

    test('does NOT throw when `includeManifestController: false`', () => {
        const dyn = AdminManifestModule.forRoot({
            config: MINIMAL_CONFIG,
            includeManifestController: false,
        });
        // Only PublicBoot
        assert.equal(dyn.controllers?.length, 1);
    });

    test('accepts a configured `guards` list', () => {
        const dyn = AdminManifestModule.forRoot({
            config: MINIMAL_CONFIG,
            guards: [FakeJwtGuard, FakeSuperAdminGuard],
        });
        assert.equal(dyn.controllers?.length, 2);
    });

    test('additionally accepts `reloadGuards` for MFA protection on reload', () => {
        const dyn = AdminManifestModule.forRoot({
            config: MINIMAL_CONFIG,
            guards: [FakeJwtGuard, FakeSuperAdminGuard],
            reloadGuards: [FakeJwtGuard],
        });
        assert.equal(dyn.controllers?.length, 2);
    });

    test('throws on missing `guards` even without an explicit includeManifestController', () => {
        // Default is true — boot crash guards against accidentally auth-free registration
        assert.throws(
            () =>
                AdminManifestModule.forRoot({
                    config: MINIMAL_CONFIG,
                    reloadGuards: [FakeJwtGuard], // reloadGuards alone is not enough
                }),
            /guards.*Pflicht/,
        );
    });
});
