// @requirement SC-CFG-006 — A misconfigured installation is told everything that is wrong at once

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    AdminManifestDoctorCheck,
    DiscoverySnapshotDoctorCheck,
    IssuerIdentityDoctorCheck,
    PlanCatalogDoctorCheck,
    PLATFORM_DOCTOR_CHECK_PROVIDERS,
    UserPortDoctorCheck,
} from '../dist/index.js';
import { givenPlanCatalogSource } from '@saasicat/nest';

describe('PlanCatalogDoctorCheck', () => {
    test('error when no plans', async () => {
        const check = new PlanCatalogDoctorCheck(
            givenPlanCatalogSource({ app: { name: 'App' }, plans: [] }),
        );
        const r = await check.run();
        assert.equal(r.severity, 'error');
        assert.match(r.message, /no plans/);
    });

    test('error when the catalogue cannot be read', async () => {
        const check = new PlanCatalogDoctorCheck({
            origin: 'database',
            current: async () => {
                throw new Error('connection refused');
            },
        });
        const r = await check.run();
        assert.equal(r.severity, 'error');
        assert.match(r.message, /cannot be read: connection refused/);
    });

    test('ok with plans + details contain planIds', async () => {
        const check = new PlanCatalogDoctorCheck(
            givenPlanCatalogSource({
                app: { name: 'App' },
                plans: [{ id: 'starter' }, { id: 'pro' }],
                features: [{ key: 'NOTES' }],
            }),
        );
        const r = await check.run();
        assert.equal(r.severity, 'ok');
        assert.match(r.message, /2 plan\(s\), 1 feature/);
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
            getManifest: async () => ({
                navigation: { standardPages: { dashboard: {}, tenants: {}, plans: {} } },
                build: { manifestHash: 'sha256-abcdef1234567890' },
            }),
        };
        const r = await new AdminManifestDoctorCheck(svc).run();
        assert.equal(r.severity, 'ok');
        assert.match(r.message, /3 standard pages/);
        assert.match(r.message, /sha256-abcde/);
    });

    test('error when getManifest throws', async () => {
        const svc = {
            getManifest: async () => {
                throw new Error('Manifest broken');
            },
        };
        const r = await new AdminManifestDoctorCheck(svc).run();
        assert.equal(r.severity, 'error');
    });
});

// @requirement SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued
describe('IssuerIdentityDoctorCheck', () => {
    /** The verdict the platform's own inspector would hand back, without booting one. */
    const checkWith = (verdict, running = null) =>
        new IssuerIdentityDoctorCheck({
            inspect: async () => verdict,
            runningContractCount: async () => running,
        });

    test('a refusal is reported as the error it would be at the next start', async () => {
        const r = await checkWith({
            kind: 'refused',
            change: { kind: 'undeclared' },
            running: {
                total: 2,
                contracts: [
                    {
                        id: 'c-1',
                        tenantId: 't-1',
                        issuerLegalName: null,
                        effectiveFrom: new Date(),
                    },
                ],
            },
            refusal: 'The issuer in config/saas.yaml is not the legal entity …',
        }).run();
        assert.equal(r.severity, 'error');
        assert.match(r.message, /is not the legal entity/);
        // The number and the identifiers, not the rows: a report is serialised
        // as JSON, and a date on a row would come out as a timestamp beside the
        // same date already written as a day in the message.
        assert.deepEqual(r.details, { runningContracts: 2, named: ['c-1'] });

        // One unknown answered once: a null count beside an empty list reads as
        // "none", which is the opposite of what it means.
        const unknown = await checkWith({
            kind: 'refused',
            change: { kind: 'undeclared' },
            running: null,
            refusal: 'The issuer …',
        }).run();
        assert.deepEqual(unknown.details, { runningContracts: null, named: null });
    });

    test('an installation that records nothing is warned that nothing is compared', async () => {
        const r = await checkWith({
            kind: 'not-compared',
            why: 'this installation records no applied settings',
        }).run();
        assert.equal(r.severity, 'warning');
        assert.match(r.message, /records no applied settings/);
    });

    test('an unchanged identity says what changing it would cost', async () => {
        const unchanged = {
            kind: 'settled',
            change: {
                kind: 'unchanged',
                identity: { legalName: 'Example Software GmbH', vatId: null, taxNumber: null },
            },
        };
        const r = await checkWith(unchanged, 142).run();
        assert.equal(r.severity, 'ok');
        assert.match(r.message, /Example Software GmbH/);
        assert.match(r.message, /142 contract\(s\) are running/);
        assert.match(r.message, /issuer\.correctionOf/);

        // And where nothing can say how many, the sentence that names the cost
        // is left out rather than made up.
        const unknown = await checkWith(unchanged).run();
        assert.equal(unknown.severity, 'ok');
        assert.doesNotMatch(unknown.message, /contract\(s\) are running/);
        assert.match(unknown.message, /issuer\.correctionOf/);
    });

    test('a declared correction is reported before the start applies it', async () => {
        const r = await checkWith({
            kind: 'settled',
            change: {
                kind: 'corrected',
                recorded: { legalName: 'Example Software GmbH', vatId: null, taxNumber: null },
                current: { legalName: 'Example Software AG', vatId: null, taxNumber: null },
                moved: ['legalName'],
                reason: 'Change of legal form',
            },
        }).run();
        assert.equal(r.severity, 'ok');
        assert.match(r.message, /Change of legal form/);
    });

    test('the first naming, and an installation that names none', async () => {
        const first = await checkWith({
            kind: 'settled',
            change: {
                kind: 'first-naming',
                identity: { legalName: 'Example Software GmbH', vatId: null, taxNumber: null },
            },
        }).run();
        assert.equal(first.severity, 'ok');
        assert.match(first.message, /for the first time/);

        const none = await checkWith({ kind: 'settled', change: { kind: 'none-named' } }).run();
        assert.equal(none.severity, 'ok');
        assert.match(none.message, /No issuer is named/);
    });
});

describe('PLATFORM_DOCTOR_CHECK_PROVIDERS', () => {
    test('holds every platform check, and nothing else', () => {
        assert.deepEqual(PLATFORM_DOCTOR_CHECK_PROVIDERS, [
            PlanCatalogDoctorCheck,
            DiscoverySnapshotDoctorCheck,
            UserPortDoctorCheck,
            AdminManifestDoctorCheck,
            IssuerIdentityDoctorCheck,
        ]);
    });
});
