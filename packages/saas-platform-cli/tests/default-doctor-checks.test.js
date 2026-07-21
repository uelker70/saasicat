import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    AdminManifestDoctorCheck,
    DiscoverySnapshotDoctorCheck,
    PlanCatalogDoctorCheck,
    PLATFORM_DOCTOR_CHECK_PROVIDERS,
    UserPortDoctorCheck,
} from '../dist/index.js';

// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P12.

describe('PlanCatalogDoctorCheck', () => {
    test('error when no plans', async () => {
        const check = new PlanCatalogDoctorCheck({ projectKey: 'app', plans: [] });
        const r = await check.run();
        assert.equal(r.severity, 'error');
        assert.match(r.message, /keine Pläne/);
    });

    test('ok with plans + details contain planIds', async () => {
        const check = new PlanCatalogDoctorCheck({
            projectKey: 'app',
            plans: [{ id: 'starter' }, { id: 'pro' }],
            features: [{ key: 'NOTES' }],
        });
        const r = await check.run();
        assert.equal(r.severity, 'ok');
        assert.match(r.message, /2 Plan\(s\), 1 Feature/);
        assert.deepEqual(r.details.planIds, ['starter', 'pro']);
    });
});

describe('DiscoverySnapshotDoctorCheck', () => {
    test('warning when snapshot empty', async () => {
        const check = new DiscoverySnapshotDoctorCheck({
            capabilities: [],
            features: [],
            quotas: [],
        });
        const r = await check.run();
        assert.equal(r.severity, 'warning');
    });

    test('ok with content', async () => {
        const check = new DiscoverySnapshotDoctorCheck({
            capabilities: [{ capabilityKey: 'x' }],
            features: [{ key: 'F' }],
            quotas: [{ key: 'Q' }],
        });
        const r = await check.run();
        assert.equal(r.severity, 'ok');
        assert.match(r.message, /1 Capabilities, 1 Features, 1 Quotas/);
    });
});

describe('UserPortDoctorCheck', () => {
    test('ok when findByEmail does not throw', async () => {
        const port = { findByEmail: async () => null };
        const r = await new UserPortDoctorCheck(port).run();
        assert.equal(r.severity, 'ok');
    });

    test('error when findByEmail throws', async () => {
        const port = {
            findByEmail: async () => {
                throw new Error('DB unreachable');
            },
        };
        const r = await new UserPortDoctorCheck(port).run();
        assert.equal(r.severity, 'error');
        assert.match(r.message, /DB unreachable/);
    });
});

describe('AdminManifestDoctorCheck', () => {
    test('ok with standardPages count', async () => {
        const svc = {
            getManifest: () => ({
                navigation: { standardPages: { dashboard: {}, tenants: {}, plans: {} } },
                build: { manifestHash: 'sha256-abcdef1234567890' },
            }),
        };
        const r = await new AdminManifestDoctorCheck(svc).run();
        assert.equal(r.severity, 'ok');
        assert.match(r.message, /3 Standard-Pages/);
        assert.match(r.message, /sha256-abcde/);
    });

    test('error when getManifest throws', async () => {
        const svc = {
            getManifest: () => {
                throw new Error('Manifest broken');
            },
        };
        const r = await new AdminManifestDoctorCheck(svc).run();
        assert.equal(r.severity, 'error');
    });
});

describe('PLATFORM_DOCTOR_CHECK_PROVIDERS', () => {
    test('contains exactly 4 provider classes', () => {
        assert.equal(PLATFORM_DOCTOR_CHECK_PROVIDERS.length, 4);
        assert.ok(PLATFORM_DOCTOR_CHECK_PROVIDERS.includes(PlanCatalogDoctorCheck));
        assert.ok(PLATFORM_DOCTOR_CHECK_PROVIDERS.includes(DiscoverySnapshotDoctorCheck));
        assert.ok(PLATFORM_DOCTOR_CHECK_PROVIDERS.includes(UserPortDoctorCheck));
        assert.ok(PLATFORM_DOCTOR_CHECK_PROVIDERS.includes(AdminManifestDoctorCheck));
    });
});
