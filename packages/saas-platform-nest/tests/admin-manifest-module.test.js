import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AdminManifestModule } from '../dist/admin/index.js';

// Plattform-Sicherheit: AdminManifestModule.forRoot() darf einen
// Manifest-Endpoint NIEMALS stillschweigend auth-frei registrieren.
// Wenn der Konsument `includeManifestController: true` (Default) und keine
// `guards` setzt, MUSS forRoot() werfen — sonst rutscht eine ungeschützte
// `GET /admin/manifest`-Route in Production. Spec: SUPERADMIN-Findings §1.

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

describe('AdminManifestModule.forRoot — Guard-Konfiguration', () => {
    test('wirft, wenn Controller registriert werden soll und `guards` fehlt', () => {
        assert.throws(
            () =>
                AdminManifestModule.forRoot({
                    config: MINIMAL_CONFIG,
                    // includeManifestController default true, guards fehlt
                }),
            /guards.*Pflicht/,
        );
    });

    test('akzeptiert leere `guards: []` als explizite auth-frei-Wahl', () => {
        const dyn = AdminManifestModule.forRoot({
            config: MINIMAL_CONFIG,
            guards: [],
        });
        assert.ok(Array.isArray(dyn.controllers), 'controllers muss Array sein');
        // PublicBoot + generated Manifest = 2 controllers
        assert.equal(dyn.controllers?.length, 2);
    });

    test('wirft NICHT, wenn `includeManifestController: false`', () => {
        const dyn = AdminManifestModule.forRoot({
            config: MINIMAL_CONFIG,
            includeManifestController: false,
        });
        // Nur PublicBoot
        assert.equal(dyn.controllers?.length, 1);
    });

    test('akzeptiert konfigurierte `guards`-Liste', () => {
        const dyn = AdminManifestModule.forRoot({
            config: MINIMAL_CONFIG,
            guards: [FakeJwtGuard, FakeSuperAdminGuard],
        });
        assert.equal(dyn.controllers?.length, 2);
    });

    test('akzeptiert zusätzlich `reloadGuards` für MFA-Schutz auf reload', () => {
        const dyn = AdminManifestModule.forRoot({
            config: MINIMAL_CONFIG,
            guards: [FakeJwtGuard, FakeSuperAdminGuard],
            reloadGuards: [FakeJwtGuard],
        });
        assert.equal(dyn.controllers?.length, 2);
    });

    test('wirft bei fehlendem `guards` auch ohne explizites includeManifestController', () => {
        // Default ist true — Boot-Crash schützt vor versehentlich auth-freier Registrierung
        assert.throws(
            () =>
                AdminManifestModule.forRoot({
                    config: MINIMAL_CONFIG,
                    reloadGuards: [FakeJwtGuard], // nur reloadGuards reicht nicht
                }),
            /guards.*Pflicht/,
        );
    });
});
