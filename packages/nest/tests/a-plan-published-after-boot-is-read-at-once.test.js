// A plan the operator publishes while the application runs is read at once.
//
// On the database path the plans and features are read each time an operation
// asks for them. These tests boot the module, publish after `app.init()` — the
// moment the application is already serving — and ask again: the source it
// provides, the manifest the plan editor reads, the static entitlements, and
// the two tokens the catalogue is split into.

// @requirement SC-PLAN-026 — A version is sold from the moment it is published, not from the next start

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import {
    PLAN_CATALOG_SETTINGS_TOKEN,
    PLAN_CATALOG_SOURCE_TOKEN,
    PlanCatalogModule,
    buildPlanCatalogFromSnapshot,
} from '../dist/billing/index.js';
import {
    AdminManifestModule,
    AdminManifestService,
    StaticEntitlementService,
    StaticPlanResolver,
} from '../dist/platform/index.js';

const SETTINGS = {
    app: { name: 'Published' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling: {
        cancellationNoticeDays: { monthly: 0, yearly: 0 },
        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
    },
};

/** The rows a database holds, which the test publishes into as an operator would. */
function database() {
    let rows = { plans: [], livePlanVersions: [], featureEntries: [] };
    return {
        sink: {
            async loadSnapshot() {
                return structuredClone(rows);
            },
        },
        publish(planKey, { monthlyNet, features = [], quotas = {} }) {
            const stem = { planKey, label: planKey, description: null, deletedAt: null };
            const version = {
                planId: planKey,
                marketed: true,
                monthlyNet: String(monthlyNet),
                yearlyNet: String(monthlyNet * 10),
                features,
                quotas,
            };
            const others = rows.plans.filter((plan) => plan.planKey !== planKey);
            rows = {
                ...rows,
                plans: [...others, { ...stem, sortOrder: others.length }],
                livePlanVersions: [
                    ...rows.livePlanVersions.filter((live) => live.planId !== planKey),
                    version,
                ],
            };
        },
        retire(planKey) {
            rows = {
                ...rows,
                plans: rows.plans.map((plan) =>
                    plan.planKey === planKey
                        ? { ...plan, deletedAt: '2026-09-21T00:00:00Z' }
                        : plan,
                ),
            };
        },
    };
}

const apps = [];
afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
});

async function boot(db, imports = []) {
    const app = await Test.createTestingModule({
        imports: [PlanCatalogModule.forRoot({ ...SETTINGS, sink: db.sink }), ...imports],
    }).compile();
    await app.init();
    apps.push(app);
    return app;
}

const planIds = (catalog) => (catalog.plans ?? []).map((plan) => plan.id);

describe('the plans a running application reads', () => {
    test('a plan published after the start is there on the next read', async () => {
        const db = database();
        db.publish('BASIC', { monthlyNet: 10 });
        const app = await boot(db);
        const source = app.get(PLAN_CATALOG_SOURCE_TOKEN);

        db.publish('PREMIUM', { monthlyNet: 99 });
        assert.deepEqual(planIds(await source.current()), ['BASIC', 'PREMIUM']);
    });

    test('a price changed after the start is the price read', async () => {
        const db = database();
        db.publish('BASIC', { monthlyNet: 10 });
        const app = await boot(db);

        db.publish('BASIC', { monthlyNet: 12 });
        const [basic] = (await app.get(PLAN_CATALOG_SOURCE_TOKEN).current()).plans;
        assert.equal(basic.monthlyNet, 12);
    });

    test('a plan retired after the start is gone from the next read', async () => {
        const db = database();
        db.publish('BASIC', { monthlyNet: 10 });
        db.publish('LEGACY', { monthlyNet: 5 });
        const app = await boot(db);

        db.retire('LEGACY');
        assert.deepEqual(planIds(await app.get(PLAN_CATALOG_SOURCE_TOKEN).current()), ['BASIC']);
    });

    test('a sink that cannot read stops the start, rather than the first customer', async () => {
        const db = database();
        db.sink.loadSnapshot = async () => {
            throw new Error('relation "plans" does not exist');
        };
        await assert.rejects(() => boot(db), /relation "plans" does not exist/);
    });
});

describe('the two halves of the catalogue', () => {
    test('the settings carry no plans and no features, so nobody reads the start-time ones', async () => {
        const db = database();
        db.publish('BASIC', { monthlyNet: 10 });
        const settings = (await boot(db)).get(PLAN_CATALOG_SETTINGS_TOKEN);

        assert.equal(settings.vatRate, 19);
        assert.equal('plans' in settings, false);
        assert.equal('features' in settings, false);
    });

    test('a catalogue given at start answers both, with the settings split off', async () => {
        const given = { schemaVersion: 1, ...SETTINGS, plans: [{ id: 'FIXED' }], features: [] };
        const app = await Test.createTestingModule({
            imports: [PlanCatalogModule.forRootWithCatalog(given)],
        }).compile();
        apps.push(app);

        assert.equal('plans' in app.get(PLAN_CATALOG_SETTINGS_TOKEN), false);
        assert.deepEqual(planIds(await app.get(PLAN_CATALOG_SOURCE_TOKEN).current()), ['FIXED']);
    });

    test('the key that used to carry both is not provided, so a consumer on it fails at start', async () => {
        const app = await boot(database());
        assert.throws(() => app.get(Symbol.for('saasicat/nest/PLAN_CATALOG')));
    });
});

describe('what reads the plans on behalf of somebody', () => {
    test('the manifest the plan editor reads lists a plan published after the start', async () => {
        const db = database();
        db.publish('BASIC', { monthlyNet: 10 });
        const app = await boot(db, [
            AdminManifestModule.forRoot({
                config: {
                    project: {
                        key: 'published',
                        displayName: 'Published',
                        environment: 'development',
                    },
                    build: { platformPackageVersion: '0.0.0', appVersion: '0.0.0' },
                },
                guards: [],
            }),
        ]);
        const manifests = app.get(AdminManifestService);
        const before = await manifests.getManifest();

        db.publish('PREMIUM', { monthlyNet: 99 });
        const after = await manifests.getManifest();
        assert.deepEqual(
            after.planCatalogSnapshot.plans.map((plan) => plan.id),
            ['BASIC', 'PREMIUM'],
        );
        assert.equal(after.planCatalogSnapshot.source, 'database');
        assert.notEqual(
            after.build.manifestHash,
            before.build.manifestHash,
            'the ETag has to move, or the browser keeps the list it has',
        );
    });

    test('a tenant on a plan published after the start gets its features', async () => {
        const db = database();
        const app = await boot(db);
        const entitlements = new StaticEntitlementService(
            app.get(PLAN_CATALOG_SOURCE_TOKEN),
            new StaticPlanResolver('PREMIUM'),
        );

        db.publish('PREMIUM', { monthlyNet: 99, features: ['EXPORT'], quotas: { users: 5 } });
        const snapshot = await entitlements.snapshot('tenant-1');
        assert.deepEqual(snapshot.features, ['EXPORT']);
        assert.deepEqual(snapshot.quotas, { users: 5 });
    });
});

describe('the order the plans are read in', () => {
    // Read for every operation, so a tie the database breaks differently from
    // one request to the next would reorder the plans between a preview and
    // the change it describes.
    const read = (keys) =>
        buildPlanCatalogFromSnapshot(SETTINGS, {
            plans: keys.map((planKey) => ({
                planKey,
                label: planKey,
                description: null,
                sortOrder: 1,
                deletedAt: null,
            })),
            livePlanVersions: keys.map((planId) => ({
                planId,
                marketed: true,
                monthlyNet: '1',
                yearlyNet: '10',
                features: [],
                quotas: {},
            })),
            featureEntries: keys.map((featureKey) => ({
                featureKey,
                label: featureKey,
                icon: null,
                tier: null,
                plannedOnly: false,
                sortOrder: 1,
                deletedAt: null,
            })),
        });

    test('is the same on every read, whatever order the database returns a tie in', () => {
        const one = read(['PRO', 'BASIC']);
        const other = read(['BASIC', 'PRO']);
        assert.deepEqual(planIds(one), ['BASIC', 'PRO']);
        assert.deepEqual(planIds(other), planIds(one));
        assert.deepEqual(
            other.features.map((feature) => feature.key),
            one.features.map((feature) => feature.key),
        );
    });
});
