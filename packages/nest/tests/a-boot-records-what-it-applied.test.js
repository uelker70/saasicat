// At boot, the platform records the configuration it applied.
//
// `config/saas.yaml` says what should be true. Until now nothing said what IS
// true, and somebody who edited the file an hour ago had no way to tell whether
// it had landed. These boot real applications — `app.init()` is what runs the
// lifecycle hook — against an in-memory port, and check the three states a boot
// can find the record in, the one where there is no record to keep, and the
// promise that makes all of it safe: the record is a mirror, never a source.

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import {
    APPLIED_SETTINGS_PORT_TOKEN,
    CANCELLATION_NOTICE_DAYS_TOKEN,
    fingerprintOf,
    loadPlanCatalogFromFile,
    SETTINGS_SOURCE_TOKEN,
} from '../dist/index.js';
import { settingsSubtreeOf } from '@saasicat/core';
import { FakeAppliedSettingsPort } from './helpers/applied-settings-port.js';

const NOTICE = { monthly: 14, yearly: 90 };
const BLOCKED = { asTarget: ['ENTERPRISE'], asSource: [] };

const catalogWith = (overrides = {}) => ({
    schemaVersion: 1,
    app: { name: 'TestApp' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling: { cancellationNoticeDays: NOTICE, selfServiceBlockedPlans: BLOCKED },
    plans: [{ id: 'PRO', name: 'Pro', monthlyNet: 9, yearlyNet: 90, features: [], quotas: {} }],
    ...overrides,
});

class FakeJwtGuard {
    canActivate() {
        return true;
    }
}

const spec = {};
const persistenceWith = (appliedSettings) => ({
    capabilities: {
        transactions: true,
        pessimisticLocking: true,
        rowLevelSecurity: false,
        advisoryLocks: false,
    },
    core: {
        mfa: spec,
        audit: spec,
        rlsBypass: spec,
        transactionRunner: spec,
        ...(appliedSettings ? { appliedSettings } : {}),
    },
});

/** Composed the way a consumer composes it, and started — the hook runs on init. */
async function boot(catalog, persistence) {
    const app = await Test.createTestingModule({
        imports: [
            SaaSiCatModule.forRoot({
                planCatalog: catalog,
                controller: { guards: [FakeJwtGuard] },
                discoverySnapshotPath: null,
                persistence,
                defaultPlanId: 'PRO',
            }),
        ],
    }).compile();
    await app.init();
    return app;
}

/** What `Logger.warn` and `Logger.log` said while `fn` ran. */
async function capturingLogs(fn) {
    const said = { warn: [], log: [] };
    const original = { warn: Logger.prototype.warn, log: Logger.prototype.log };
    Logger.prototype.warn = function (message) {
        said.warn.push(String(message));
    };
    Logger.prototype.log = function (message) {
        said.log.push(String(message));
    };
    try {
        return { said, result: await fn() };
    } finally {
        Logger.prototype.warn = original.warn;
        Logger.prototype.log = original.log;
    }
}

let app;
afterEach(async () => {
    await app?.close().catch(() => {});
    app = undefined;
});

// @requirement SC-CFG-025 — The installation records the configuration it applied, and notices when it changed
describe('the three states a boot can find the record in', () => {
    test('no record: the first boot writes one, and the log says so', async () => {
        const port = new FakeAppliedSettingsPort();
        const { said } = await capturingLogs(async () => {
            app = await boot(catalogWith(), persistenceWith(port));
        });

        assert.ok(port.applied, 'a record expected after the first boot');
        assert.deepEqual(port.applied.settings, settingsSubtreeOf(catalogWith()));
        assert.equal(port.applied.fingerprint, fingerprintOf(port.applied.settings));
        assert.ok(port.applied.appliedAt instanceof Date);
        assert.deepEqual(port.changes, [], 'nothing to compare against, so no change');
        assert.ok(
            said.log.some((line) => /recorded for the first time/.test(line)),
            said.log,
        );
    });

    test('same fingerprint: the record is left alone, and nothing is said', async () => {
        const port = new FakeAppliedSettingsPort();
        const appliedAt = new Date('2026-08-01T06:00:00.000Z');
        const settings = settingsSubtreeOf(catalogWith());
        port.applied = {
            fingerprint: fingerprintOf(settings),
            settings,
            source: '/elsewhere/config/saas.yaml',
            appliedAt,
        };

        const { said } = await capturingLogs(async () => {
            app = await boot(catalogWith(), persistenceWith(port));
        });

        // `appliedAt` keeps saying when these values took effect — a restart
        // with the same configuration did not apply anything new. The source
        // follows the running one (the file may have moved); that is its own
        // case below.
        assert.equal(port.applied.appliedAt, appliedAt);
        assert.equal(port.applied.source, app.get(SETTINGS_SOURCE_TOKEN));
        assert.deepEqual(port.changes, []);
        assert.deepEqual(
            said.warn.filter((line) => /settings/i.test(line)),
            [],
            'a boot that found nothing changed must not warn about the settings',
        );
    });

    test('same fingerprint, moved file: the source follows, the moment does not', async () => {
        // A Dockerfile that relocates config/saas.yaml with its content intact
        // changes no setting — and the record must not go on naming a path that
        // no longer exists.
        const port = new FakeAppliedSettingsPort();
        const appliedAt = new Date('2026-08-01T06:00:00.000Z');
        const settings = settingsSubtreeOf(catalogWith());
        port.applied = {
            fingerprint: fingerprintOf(settings),
            settings,
            source: '/old/place/config/saas.yaml',
            appliedAt,
        };
        app = await boot(catalogWith(), persistenceWith(port));
        assert.notEqual(port.applied.source, '/old/place/config/saas.yaml');
        assert.equal(port.applied.appliedAt, appliedAt, 'nothing was applied anew');
        assert.deepEqual(port.changes, [], 'a moved file is not a changed setting');
    });

    test('different fingerprint: the record is replaced and the difference written down', async () => {
        const port = new FakeAppliedSettingsPort();
        const previous = settingsSubtreeOf(catalogWith());
        port.applied = {
            fingerprint: fingerprintOf(previous),
            settings: previous,
            source: '/elsewhere/config/saas.yaml',
            appliedAt: new Date('2026-08-01T06:00:00.000Z'),
        };
        const changed = catalogWith({
            tenantBilling: {
                cancellationNoticeDays: { monthly: 30, yearly: 90 },
                selfServiceBlockedPlans: BLOCKED,
            },
        });

        const { said } = await capturingLogs(async () => {
            app = await boot(changed, persistenceWith(port));
        });

        assert.deepEqual(port.applied.settings, settingsSubtreeOf(changed));
        assert.ok(
            port.applied.appliedAt > new Date('2026-08-01T06:00:00.000Z'),
            'the new values took effect at this boot',
        );
        assert.equal(port.changes.length, 1);
        const [change] = port.changes;
        assert.deepEqual(change.previous, previous);
        assert.deepEqual(change.current, settingsSubtreeOf(changed));
        assert.equal(change.acknowledgedAt, null);
        // The log names the leaf that moved, with both values — an operator
        // reading a boot log should not have to open the screen to know.
        const line = said.warn.find((l) => /settings changed since the last start/.test(l));
        assert.ok(line, said.warn);
        assert.match(line, /tenantBilling\.cancellationNoticeDays\.monthly: 14 → 30/);
    });

    test('a change that cannot be written leaves the record alone, so the next start notices again', async () => {
        // The change and the record it supersedes land together or not at all
        // — the port's promise. A failure here therefore leaves the OLD record
        // in place, and the next start finds the fingerprints differ and tries
        // again; a record replaced without its change would say nothing, ever.
        const port = new FakeAppliedSettingsPort();
        const previous = settingsSubtreeOf(catalogWith());
        port.applied = {
            fingerprint: fingerprintOf(previous),
            settings: previous,
            source: 'x',
            appliedAt: new Date('2026-08-01T06:00:00.000Z'),
        };
        port.recordChange = async () => {
            throw new Error('statement timeout');
        };
        const changed = catalogWith({ vatRate: 20 });
        const errors = [];
        const original = Logger.prototype.error;
        Logger.prototype.error = function (message) {
            errors.push(String(message));
        };
        try {
            app = await boot(changed, persistenceWith(port));
        } finally {
            Logger.prototype.error = original;
        }
        assert.equal(
            port.applied.fingerprint,
            fingerprintOf(previous),
            'the record was not replaced',
        );
        assert.ok(
            errors.some((line) => /could not be recorded/.test(line)),
            errors,
        );
    });

    test('a plan added to the catalogue is not a settings change', async () => {
        const port = new FakeAppliedSettingsPort();
        const settings = settingsSubtreeOf(catalogWith());
        port.applied = {
            fingerprint: fingerprintOf(settings),
            settings,
            source: 'x',
            appliedAt: new Date('2026-08-01T06:00:00.000Z'),
        };
        const morePlans = catalogWith({
            plans: [
                ...catalogWith().plans,
                {
                    id: 'TEAM',
                    name: 'Team',
                    monthlyNet: 19,
                    yearlyNet: 190,
                    features: [],
                    quotas: {},
                },
            ],
        });
        app = await boot(morePlans, persistenceWith(port));
        assert.deepEqual(port.changes, []);
        assert.equal(
            port.applied.appliedAt.toISOString(),
            '2026-08-01T06:00:00.000Z',
            'nothing was applied anew',
        );
    });
});

// @requirement SC-CFG-025 — The installation records the configuration it applied, and notices when it changed
describe('an installation whose adapter keeps no record', () => {
    test('boots, says so once, and answers the endpoint without a record', async () => {
        const { said } = await capturingLogs(async () => {
            app = await boot(catalogWith(), persistenceWith(undefined));
        });
        const warnings = said.warn.filter((line) => /not recorded/.test(line));
        assert.equal(warnings.length, 1, said.warn);
        assert.match(warnings[0], /core\.appliedSettings/);
        assert.equal(app.get(APPLIED_SETTINGS_PORT_TOKEN), null);
    });

    test('a failing port does not take the boot down, and the log names the file', async () => {
        const port = new FakeAppliedSettingsPort();
        port.readApplied = async () => {
            throw new Error('connection refused');
        };
        const errors = [];
        const original = Logger.prototype.error;
        Logger.prototype.error = function (message) {
            errors.push(String(message));
        };
        try {
            app = await boot(catalogWith(), persistenceWith(port));
        } finally {
            Logger.prototype.error = original;
        }
        assert.ok(app, 'the application started');
        assert.ok(
            errors.some((line) => /could not be recorded/.test(line)),
            errors,
        );
    });
});

describe('an app that serves the route itself', () => {
    test('declines the controller, keeps the record, and keeps the page in the manifest', async () => {
        const port = new FakeAppliedSettingsPort();
        app = await Test.createTestingModule({
            imports: [
                SaaSiCatModule.forRoot({
                    planCatalog: catalogWith(),
                    controller: { guards: [FakeJwtGuard] },
                    discoverySnapshotPath: null,
                    persistence: persistenceWith(port),
                    defaultPlanId: 'PRO',
                    includeSettingsController: false,
                }),
            ],
        }).compile();
        await app.init();
        // No controller class for the route is registered anywhere in the tree…
        const controllers = [...app.get(ModulesContainer).values()].flatMap((m) =>
            [...m.controllers.values()].map((c) => c.metatype?.name ?? ''),
        );
        assert.ok(!controllers.includes('GeneratedSettingsController'), controllers);
        // …and the record is still written at boot.
        assert.ok(port.applied, 'the record is kept whether or not the route is mounted');
        // The flag says who answers the route, not whether the page exists:
        // the sidebar entry and its capability stay.
        const manifest = app.get(AdminManifestService).getManifest();
        assert.equal(manifest.capabilities['settings.read'], true);
        assert.equal(manifest.navigation.standardPages?.settings?.enabled, true);
    });
});

// @requirement SC-CFG-027 — The record says where the values came from
describe('where the record says the values came from', () => {
    let dir;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    test('the absolute path of the file the platform read', async () => {
        dir = mkdtempSync(join(tmpdir(), 'saasicat-source-'));
        const path = join(dir, 'saas.yaml');
        writeFileSync(
            path,
            [
                'schemaVersion: 1',
                'app: { name: FromFile }',
                'currency: EUR',
                'vatRate: 19',
                'tenantBilling:',
                '  cancellationNoticeDays: { monthly: 14, yearly: 90 }',
                '  selfServiceBlockedPlans: { asTarget: [], asSource: [] }',
                'plans:',
                '  - { id: PRO, name: Pro, monthlyNet: 9, yearlyNet: 90, features: [], quotas: { users: 1 } }',
            ].join('\n'),
        );
        const port = new FakeAppliedSettingsPort();
        app = await boot(loadPlanCatalogFromFile({ path }), persistenceWith(port));
        assert.equal(port.applied.source, path);
        assert.equal(app.get(SETTINGS_SOURCE_TOKEN), path);
    });

    test('a catalogue built in code says so rather than inventing a path', async () => {
        const port = new FakeAppliedSettingsPort();
        app = await boot(catalogWith(), persistenceWith(port));
        assert.match(port.applied.source, /planCatalog/);
        assert.doesNotMatch(port.applied.source, /saas\.yaml/);
    });
});

// @requirement SC-CFG-026 — The record of the applied configuration is a mirror, never a source
describe('the record is a mirror, never a source', () => {
    test('a record that disagrees with the file changes nothing about what runs', async () => {
        const port = new FakeAppliedSettingsPort();
        const stale = settingsSubtreeOf(
            catalogWith({
                tenantBilling: {
                    cancellationNoticeDays: { monthly: 99, yearly: 99 },
                    selfServiceBlockedPlans: { asTarget: [], asSource: [] },
                },
            }),
        );
        port.applied = {
            fingerprint: fingerprintOf(stale),
            settings: stale,
            source: 'x',
            appliedAt: new Date('2026-08-01T06:00:00.000Z'),
        };
        app = await Test.createTestingModule({
            imports: [
                SaaSiCatModule.forRoot({
                    planCatalog: catalogWith(),
                    controller: { guards: [FakeJwtGuard] },
                    discoverySnapshotPath: null,
                    persistence: {
                        ...persistenceWith(port),
                        entitlement: {
                            subscriptionRepository: { findByTenantId: async () => null },
                            planVersionRepository: {
                                findLatestLive: async () => null,
                                findById: async () => null,
                            },
                        },
                        catalog: { bundleRepository: spec },
                    },
                    tenantBilling: {
                        authGuards: { jwt: FakeJwtGuard },
                        subscriptionUsagePort: { findForTenant: async () => null },
                        usageSnapshotPort: { snapshot: async () => ({}) },
                        subscriptionWritePort: {},
                    },
                    entitlement: { defaultPlanId: 'PRO' },
                }),
            ],
        }).compile();
        await app.init();

        // The value the code runs on is the file's, and the record now says so too.
        assert.deepEqual(app.get(CANCELLATION_NOTICE_DAYS_TOKEN), NOTICE);
        assert.deepEqual(port.applied.settings.tenantBilling.cancellationNoticeDays, NOTICE);
        assert.equal(port.changes.length, 1, 'the disagreement was recorded as a change');
    });
});
