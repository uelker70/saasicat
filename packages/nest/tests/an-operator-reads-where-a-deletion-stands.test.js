// The operator reads where a tenant's deletion stands, on the tenant's page and
// in the subscriber's record, through the routes the platform mounts — only
// where it also announces them, only for the platform's administrator, and
// read across tenants, outside the row-level policy that keeps them apart.
//
// What the view says is decided in `TenantDeletionReadingService` and held by
// its own suite; here the deletion is a record the run began, read back
// through the platform as an application composes it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUTH_ERROR_CODES, TENANT_DELETION_CAPABILITY } from '@saasicat/core';

import { AdminResourcesService } from '../dist/admin/index.js';
import { TenantDeletionAdminModule, TenantDeletionReadingService } from '../dist/billing/index.js';
import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import { storeSecretsInPlainText } from '../dist/index.js';
import {
    FakeInstallationMarkRepository,
    FakeTenantDeletionRepository,
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
} from '../dist/testing/index.js';
import { THIS_INSTALLATION, aDeletion } from './helpers/installation-mark.js';
import { controllersIn, everythingOn, handlersOf, passes } from './helpers/operator-routes.js';
import { anExport } from './helpers/tenant-data-export.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

const TENANT_ROUTE = 'GET admin/tenants/:slug/deletion';
const SUBSCRIBER_ROUTE = 'GET admin/subscribers/:id/deletions';

const HOLDER = { id: 'subscriber-1', customerNumber: 'K-10001', legalName: 'Northwind GmbH' };
const NORTHWIND = { id: 't-northwind', slug: 'northwind', name: 'Northwind' };
/** A tenant the application has, whose subscription never ended. */
const CONTOSO = { id: 't-contoso', slug: 'contoso', name: 'Contoso' };
const STARTED_AT = new Date('2026-12-01T00:15:00.000Z');

const PLAN_CATALOG = {
    schemaVersion: 1,
    app: { name: 'Probe' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling: {
        cancellationNoticeDays: { monthly: 0, yearly: 0 },
        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
        endOfSubscription: { readOnlyDays: 30, reminderDaysBefore: [29, 10, 3] },
    },
    plans: [],
};

/** A deletion of Northwind the run began, its record kept with its subscriber. */
async function northwindsDeletion() {
    const records = new FakeTenantDeletionRepository();
    await records.begin({
        tenantId: NORTHWIND.id,
        subscriberId: HOLDER.id,
        subscriptionId: 'sub-northwind',
        subscriptionEndId: 'end-northwind',
        deletesOn: '2026-12-01',
        exportOfferedFrom: new Date('2026-10-31T23:00:00.000Z'),
        exportBlockedBySuspension: false,
        keep: [],
        startedAt: STARTED_AT,
        stores: [{ store: 'data', position: 0 }],
    });
    return records;
}

/**
 * The platform as an application composes it, every adapter a fake. Each read
 * of a tenant, a subscriber or a deletion is recorded with whether it ran
 * inside the bypass frame.
 */
async function aPlatform({ adminResources = true, tenantBilling = true } = {}) {
    const reads = [];
    let bypassed = 0;
    const rlsBypass = {
        async runWithBypass(fn) {
            bypassed += 1;
            try {
                return await fn();
            } finally {
                bypassed -= 1;
            }
        },
    };
    const noted = (read) => reads.push({ read, bypassed: bypassed > 0 });
    const records = await northwindsDeletion();
    const findForTenants = records.findForTenants.bind(records);
    records.findForTenants = (tenantIds) => {
        noted(`deletions of ${tenantIds.join(', ')}`);
        return findForTenants(tenantIds);
    };
    const findForSubscriber = records.findForSubscriber.bind(records);
    records.findForSubscriber = (subscriberId) => {
        noted(`deletions of ${subscriberId}`);
        return findForSubscriber(subscriberId);
    };
    const subscribers = {
        async findById(subscriberId) {
            noted(`subscriber ${subscriberId}`);
            return subscriberId === HOLDER.id ? HOLDER : null;
        },
        findByTenantId: async (tenantId) => (tenantId === NORTHWIND.id ? HOLDER : null),
        listTenantLinks: async () => [],
    };
    const tenants = {
        listTenants: async () => [],
        async getTenantDetail(slug) {
            noted(`tenant ${slug}`);
            return [NORTHWIND, CONTOSO].find((tenant) => tenant.slug === slug) ?? null;
        },
        findTenantsByIds: async () => [],
        listUsers: async () => [],
        listAudit: async () => [],
        listSubscriptions: async () => [],
    };
    const root = SaaSiCatModule.forRoot({
        adapters: { secretSealer: storeSecretsInPlainText() },
        planCatalog: PLAN_CATALOG,
        controller: { guards: [] },
        discoverySnapshotPath: null,
        persistence: {
            capabilities: {
                transactions: true,
                pessimisticLocking: true,
                rowLevelSecurity: true,
                advisoryLocks: false,
            },
            core: {
                tenantAccessHolds: new FakeTenantAccessHoldRepository(),
                subscriptionEnds: new FakeSubscriptionEndRepository(),
                installationMark: new FakeInstallationMarkRepository(),
                tenantDeletions: records,
                mfa: {},
                audit: { write: async () => {} },
                rlsBypass,
                transactionRunner: { run: (fn) => fn({}) },
            },
            entitlement: {
                subscriberRepository: subscribers,
                subscriptionRepository: { findByTenantId: async () => null },
                planVersionRepository: { findById: async () => null },
            },
            tenantBilling: {
                subscriptionUsagePort: { findForTenant: async () => null },
                subscriptionWritePort: {},
            },
            adminResources: { resources: tenants },
        },
        tenantBilling: tenantBilling
            ? {
                  authGuards: [],
                  notices: { port: sendingPort(), record: noticeRecord() },
                  subscriptionEnds: { export: anExport(), deletion: aDeletion() },
              }
            : undefined,
        adminResources,
    });
    const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
    const manifest = await moduleRef.get(AdminManifestService).getManifest();
    const handlers = controllersIn(root).flatMap(handlersOf);
    const served = (route) => handlers.find((handler) => handler.route === route);
    /** Asks `route` the way Nest dispatches to it. */
    const ask = (route, parameter) => {
        const { controller, name } = served(route);
        return moduleRef.get(controller, { strict: false })[name](parameter);
    };
    return {
        moduleRef,
        manifest,
        reads,
        served,
        deletionOf: (slug) => ask(TENANT_ROUTE, slug),
        deletionsOf: (subscriberId) => ask(SUBSCRIBER_ROUTE, subscriberId),
    };
}

/** Northwind's deletion as the operator reads it: begun, held by the unmarked database. */
const NORTHWINDS_STATUS = {
    kind: 'halted',
    deletesOn: '2026-12-01',
    heldBy: [{ reason: 'installation-unmarked', expected: THIS_INSTALLATION }],
};

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
describe("a tenant's deletion is served on its page and in its subscriber's record", () => {
    test('with the tenants and their billing, both routes answer and the manifest announces them', async () => {
        const platform = await aPlatform();

        const { deletion } = await platform.deletionOf(NORTHWIND.slug);
        const { deletions } = await platform.deletionsOf(HOLDER.id);

        assert.equal(platform.manifest.capabilities[TENANT_DELETION_CAPABILITY], true);
        assert.equal(deletion.tenantId, NORTHWIND.id);
        assert.deepEqual(deletion.status, NORTHWINDS_STATUS);
        assert.equal(deletion.record.startedAt, STARTED_AT.toISOString());
        assert.deepEqual(deletions, [deletion]);
        await platform.moduleRef.close();
    });

    test('a tenant whose subscription never ended has no deletion', async () => {
        const platform = await aPlatform();

        assert.deepEqual(await platform.deletionOf(CONTOSO.slug), { deletion: null });
        await platform.moduleRef.close();
    });

    test('a tenant the application does not have is answered as not found, by code, and no deletion is read', async () => {
        const platform = await aPlatform();

        await assert.rejects(
            () => platform.deletionOf('nowhere'),
            (error) => {
                assert.ok(error instanceof NotFoundException);
                assert.equal(error.getResponse().code, 'TENANT_NOT_FOUND');
                return true;
            },
        );
        assert.deepEqual(
            platform.reads.map(({ read }) => read),
            ['tenant nowhere'],
        );
        await platform.moduleRef.close();
    });

    test('a subscriber there is not is answered as not found, by code, and no deletion is read', async () => {
        const platform = await aPlatform();

        await assert.rejects(
            () => platform.deletionsOf('nobody'),
            (error) => {
                assert.ok(error instanceof NotFoundException);
                assert.equal(error.getResponse().code, 'SUBSCRIBER_NOT_FOUND');
                return true;
            },
        );
        assert.deepEqual(
            platform.reads.map(({ read }) => read),
            ['subscriber nobody'],
        );
        await platform.moduleRef.close();
    });

    test("the tenant, the subscriber and the deletions are read outside the tenants' row-level policy", async () => {
        const platform = await aPlatform();

        await platform.deletionOf(NORTHWIND.slug);
        await platform.deletionsOf(HOLDER.id);

        assert.deepEqual(platform.reads, [
            { read: 'tenant northwind', bypassed: true },
            { read: 'deletions of t-northwind', bypassed: true },
            { read: 'subscriber subscriber-1', bypassed: true },
            { read: 'deletions of subscriber-1', bypassed: true },
        ]);
        await platform.moduleRef.close();
    });

    for (const [without, options] of [
        ['the tenants', { adminResources: false }],
        ["the tenants' billing", { tenantBilling: false }],
    ]) {
        test(`without ${without}, neither route nor the capability exists`, async () => {
            const platform = await aPlatform(options);

            assert.equal(platform.served(TENANT_ROUTE), undefined);
            assert.equal(platform.served(SUBSCRIBER_ROUTE), undefined);
            assert.equal(platform.manifest.capabilities[TENANT_DELETION_CAPABILITY], undefined);
            await platform.moduleRef.close();
        });
    }
});

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
describe("who reads a tenant's deletion", () => {
    const deletionRoutes = controllersIn(everythingOn())
        .flatMap(handlersOf)
        .filter(({ route }) => route === TENANT_ROUTE || route === SUBSCRIBER_ROUTE);

    test('both routes are mounted where everything is on', () => {
        assert.deepEqual(deletionRoutes.map(({ route }) => route).sort(), [
            SUBSCRIBER_ROUTE,
            TENANT_ROUTE,
        ]);
    });

    test("a signed-in tenant user is refused by name, the platform's administrator passes", async () => {
        for (const { controller, route } of deletionRoutes) {
            await assert.rejects(
                () => passes(controller, { role: 'TENANT_ADMIN', tenantId: NORTHWIND.id }),
                (error) => {
                    assert.equal(
                        error.getResponse?.().code,
                        AUTH_ERROR_CODES.SUPER_ADMIN_REQUIRED,
                        route,
                    );
                    return true;
                },
            );
            assert.equal(await passes(controller, { role: 'SUPER_ADMIN' }), true, route);
        }
    });
});

// @requirement SC-ADM-058 — The operator sees where a tenant's deletion stands
describe('mounted by hand', () => {
    /** The services the routes need, from a module standing in for the platform's. */
    const services = {
        module: class PlatformServices {},
        providers: [
            { provide: AdminResourcesService, useValue: {} },
            { provide: TenantDeletionReadingService, useValue: {} },
        ],
        exports: [AdminResourcesService, TenantDeletionReadingService],
    };

    test('without the bypass port, it refuses to start rather than read in a tenant scope', async () => {
        await assert.rejects(
            () =>
                Test.createTestingModule({
                    imports: [
                        TenantDeletionAdminModule.forRoot({ guards: [], imports: [services] }),
                    ],
                }).compile(),
            /RlsBypassPort/,
        );
    });
});
