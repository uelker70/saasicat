// What turning maintenance on changes in an installation, beyond the lock: the
// configuration it needs, the screen the administration offers, and the
// platform's own scheduled jobs, which pause while the lock holds.

import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MAINTENANCE_CAPABILITY } from '@saasicat/core';

import {
    AdminManifestService,
    MaintenanceService,
    PromoCodeExpirer,
    RegistrationCleanupCron,
    SaaSiCatModule,
} from '../dist/index.js';
import { findViolations } from '../dist/platform/index.js';
import { FakeMaintenanceWindowPort, OPERATOR } from './helpers/maintenance-windows.js';

afterEach(() => mock.restoreAll());

const CATALOG = {
    schemaVersion: 1,
    app: { name: 'TestApp' },
    currency: 'EUR',
    vatRate: 19,
    plans: [{ id: 'PRO', features: [], quotas: {} }],
};

const CORE = {
    mfa: {},
    audit: { write: async () => {} },
    rlsBypass: {},
    transactionRunner: {},
};

class PassGuard {
    canActivate() {
        return true;
    }
}

const persistenceWith = (core) => ({
    capabilities: {
        transactions: true,
        pessimisticLocking: true,
        rowLevelSecurity: false,
        advisoryLocks: false,
    },
    core: { ...CORE, ...core },
});

describe('the configuration maintenance needs', () => {
    const configuration = (options) => ({
        options: { planCatalog: CATALOG, controller: { guards: [] }, ...options },
        adapters: CORE,
    });
    const ids = (options) => findViolations(configuration(options)).map((v) => v.id);

    test('turned on with nowhere to keep windows, the start is refused, naming the rule', () => {
        assert.deepEqual(ids({ maintenance: true }), ['maintenance.requires-windows-port']);
        assert.deepEqual(ids({ maintenance: {}, persistence: persistenceWith({}) }), [
            'maintenance.requires-windows-port',
        ]);
    });

    test('a bundle that keeps windows, or a port of its own, is enough', () => {
        const port = new FakeMaintenanceWindowPort();
        assert.deepEqual(
            ids({ maintenance: true, persistence: persistenceWith({ maintenanceWindows: port }) }),
            [],
        );
        assert.deepEqual(ids({ maintenance: { windows: port } }), []);
    });

    test('turned off, it asks for nothing', () => {
        assert.deepEqual(ids({ maintenance: false }), []);
        assert.deepEqual(ids({}), []);
    });
});

/** An installation composed the way a consumer composes it. */
async function boot(maintenance, port = new FakeMaintenanceWindowPort()) {
    const moduleRef = await Test.createTestingModule({
        imports: [
            SaaSiCatModule.forRoot({
                planCatalog: CATALOG,
                controller: { guards: [PassGuard] },
                discoverySnapshotPath: null,
                persistence: persistenceWith({ maintenanceWindows: port }),
                defaultPlanId: 'PRO',
                ...(maintenance === undefined ? {} : { maintenance }),
            }),
        ],
    }).compile();
    await moduleRef.init();
    return moduleRef;
}

describe('the screen the administration offers', () => {
    test('an installation that keeps windows grants the capability the screen needs', async () => {
        mock.method(Logger.prototype, 'log', () => {});
        const moduleRef = await boot(true);
        const manifest = await moduleRef.get(AdminManifestService).getManifest();
        assert.equal(manifest.capabilities[MAINTENANCE_CAPABILITY], true);
        assert.deepEqual(manifest.navigation.standardPages.maintenance, {
            enabled: true,
            requiredCapability: MAINTENANCE_CAPABILITY,
        });
        const actions = manifest.audit.actions.map((a) => a.key);
        for (const action of ['MAINTENANCE_LOCK', 'MAINTENANCE_UNLOCK']) {
            assert.ok(actions.includes(action), `${action} has a label`);
        }
        await moduleRef.close();
    });

    // @requirement SC-ADM-015 — The administration only offers what the application actually has
    test('one that does not, does not — so the screen is not offered', async () => {
        mock.method(Logger.prototype, 'log', () => {});
        const moduleRef = await boot(undefined);
        const manifest = await moduleRef.get(AdminManifestService).getManifest();
        assert.equal(manifest.capabilities[MAINTENANCE_CAPABILITY], undefined);
        await moduleRef.close();
    });

    test('an installation serving the routes itself keeps the lock and offers no screen', async () => {
        mock.method(Logger.prototype, 'log', () => {});
        const moduleRef = await boot({ includeAdminController: false });
        const manifest = await moduleRef.get(AdminManifestService).getManifest();
        assert.equal(manifest.capabilities[MAINTENANCE_CAPABILITY], undefined);
        assert.ok(moduleRef.get(MaintenanceService), 'the lock is there either way');
        await moduleRef.close();
    });
});

// @requirement SC-OPS-013 — While the lock holds, no tenant request reaches the application
describe('the platform’s own scheduled jobs', () => {
    /** Repositories that count what the job asks of them. */
    function promoRepositories() {
        const calls = [];
        const record = (name, answer) => async () => {
            calls.push(name);
            return answer;
        };
        return {
            calls,
            codes: { expireDueCodes: record('codes', 0) },
            redemptions: { expireDueRedemptions: record('redemptions', 0) },
            holds: { expireDue: record('holds', 0) },
        };
    }

    async function lockedService() {
        const service = new MaintenanceService(new FakeMaintenanceWindowPort(), null, null);
        await service.lock({}, OPERATOR);
        return service;
    }

    test('the promotional code sweep skips its run while the lock holds', async () => {
        mock.method(Logger.prototype, 'log', () => {});
        const repositories = promoRepositories();
        const expirer = new PromoCodeExpirer(
            repositories.codes,
            repositories.redemptions,
            repositories.holds,
            await lockedService(),
        );
        await expirer.expirePromoCodes();
        assert.deepEqual(repositories.calls, []);
    });

    test('and runs once it is unlocked, or where maintenance is off', async () => {
        const service = await lockedService();
        await service.unlock({}, OPERATOR);
        for (const maintenance of [service, null]) {
            const repositories = promoRepositories();
            await new PromoCodeExpirer(
                repositories.codes,
                repositories.redemptions,
                repositories.holds,
                maintenance,
            ).expirePromoCodes();
            assert.deepEqual(repositories.calls, ['codes', 'redemptions', 'holds']);
        }
    });

    test('the expired sign-up cleanup skips its run while the lock holds', async () => {
        mock.method(Logger.prototype, 'log', () => {});
        const calls = [];
        const registrations = {
            runCleanup: async () => {
                calls.push('cleanup');
                return { deleted: 0, moreAvailable: false };
            },
        };
        await new RegistrationCleanupCron(registrations, await lockedService()).runDaily();
        assert.deepEqual(calls, []);

        await new RegistrationCleanupCron(registrations, null).runDaily();
        assert.deepEqual(calls, ['cleanup']);
    });
});
