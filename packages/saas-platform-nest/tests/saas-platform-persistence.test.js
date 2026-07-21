import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { SaasPlatformModule, StaticEntitlementService } from '../dist/platform/index.js';

// forRoot wiring of the `persistence` bundle option (adapter bundles from
// e.g. @saasicat/adapter-prisma) incl. the capability fail-fast.

const planCatalog = {
    schemaVersion: 1,
    projectKey: 'app',
    currency: 'EUR',
    vatRate: 19,
    plans: [],
};

function fakeBundle(capabilityOverrides = {}) {
    const spec = { useFactory: () => ({}), inject: [] };
    return {
        capabilities: {
            transactions: true,
            pessimisticLocking: true,
            rowLevelSecurity: false,
            advisoryLocks: false,
            ...capabilityOverrides,
        },
        core: {
            mfa: spec,
            audit: spec,
            rlsBypass: spec,
            transactionRunner: spec,
        },
        entitlement: {
            subscriptionRepository: spec,
            planVersionRepository: spec,
        },
        planCatalogReadSink: spec,
    };
}

describe('SaasPlatformModule persistence bundle', () => {
    test('forRoot wires from a bundle without individual adapters', () => {
        const mod = SaasPlatformModule.forRoot({
            planCatalog,
            controller: { guards: [] },
            persistence: fakeBundle(),
        });
        assert.ok(mod.module);
        assert.ok(Array.isArray(mod.imports));
    });

    test('missing core adapters are reported by name', () => {
        assert.throws(
            () => SaasPlatformModule.forRoot({ planCatalog, controller: { guards: [] } }),
            /mfa, audit, rlsBypass/,
        );
    });

    test('entitlement pulls repositories + transaction runner from the bundle', () => {
        const mod = SaasPlatformModule.forRoot({
            planCatalog,
            controller: { guards: [] },
            persistence: fakeBundle(),
            entitlement: {},
        });
        assert.ok(mod.imports.length >= 5, 'EntitlementModule must be included');
    });

    test('entitlement without required capabilities fails fast at boot', () => {
        assert.throws(
            () =>
                SaasPlatformModule.forRoot({
                    planCatalog,
                    controller: { guards: [] },
                    persistence: fakeBundle({ pessimisticLocking: false }),
                    entitlement: {},
                }),
            (err) => {
                assert.equal(err.code, 'PERSISTENCE_CAPABILITY_MISSING');
                assert.match(err.message, /pessimisticLocking/);
                assert.match(err.message, /enforceLimit/);
                return true;
            },
        );
    });

    test('explicit adapters combine with a bundle', () => {
        const explicitMfa = { getSecret: async () => null };
        const mod = SaasPlatformModule.forRoot({
            planCatalog,
            controller: { guards: [] },
            persistence: fakeBundle(),
            adapters: { mfa: explicitMfa },
        });
        assert.ok(mod.module);
    });

    test('DB hydration forwards the dbCatalog identity to the plan-catalog factory', async () => {
        const seenProjectKeys = [];
        const sink = {
            loadSnapshot: async (projectKey) => {
                seenProjectKeys.push(projectKey);
                return { plans: [], livePlanVersions: [], featureEntries: [] };
            },
        };
        const mod = SaasPlatformModule.forRoot({
            controller: { guards: [] },
            persistence: fakeBundle(),
            adapters: { planCatalogReadSink: sink },
            dbCatalog: { projectKey: 'notesapp', currency: 'EUR', vatRate: 19 },
        });

        const planCatalogModule = mod.imports[0];
        const catalogFactory = planCatalogModule.providers.find(
            (provider) => typeof provider.useFactory === 'function',
        );
        const catalog = await catalogFactory.useFactory(sink);

        assert.deepEqual(seenProjectKeys, ['notesapp']);
        assert.equal(catalog.projectKey, 'notesapp');
        assert.equal(catalog.currency, 'EUR');
        assert.equal(catalog.vatRate, 19);
    });

    test('DB hydration without dbCatalog fails fast instead of loading an empty catalog', () => {
        assert.throws(
            () =>
                SaasPlatformModule.forRoot({
                    controller: { guards: [] },
                    persistence: fakeBundle(), // provides a read sink, but no identity
                }),
            /dbCatalog/,
        );
    });

    test('the mega module COMPILES through Nest DI with a bundle (boot smoke)', async () => {
        // forRoot() is a pure function — only a real compile catches DI wiring
        // bugs like exporting an imported module's token (UnknownExportException).
        const instanceBundle = {
            capabilities: {
                transactions: true,
                pessimisticLocking: true,
                rowLevelSecurity: false,
                advisoryLocks: false,
            },
            core: {
                mfa: { getSecret: async () => null, setSecret: async () => {}, isEnabled: async () => false },
                audit: { write: async () => {} },
                rlsBypass: { runWithBypass: (fn) => fn() },
                transactionRunner: { run: (fn) => fn({}) },
            },
        };
        const moduleRef = await Test.createTestingModule({
            imports: [
                SaasPlatformModule.forRoot({
                    planCatalog: {
                        ...planCatalog,
                        plans: [{ id: 'STARTER', features: ['NOTES'], quotas: { notesMax: 25 } }],
                    },
                    controller: { guards: [] },
                    persistence: instanceBundle,
                    defaultPlanId: 'STARTER',
                }),
            ],
        }).compile();

        const entitlement = moduleRef.get(StaticEntitlementService);
        const snapshot = await entitlement.snapshot('tenant-a');
        assert.equal(snapshot.planId, 'STARTER');
        assert.ok(snapshot.features.includes('NOTES'));
        await moduleRef.close();
    });

    test('bundle without entitlement slice still requires repositories for entitlement', () => {
        const bundle = fakeBundle();
        delete bundle.entitlement;
        assert.throws(
            () =>
                SaasPlatformModule.forRoot({
                    planCatalog,
                    controller: { guards: [] },
                    persistence: bundle,
                    entitlement: {},
                }),
            /subscriptionRepository, planVersionRepository/,
        );
    });
});
