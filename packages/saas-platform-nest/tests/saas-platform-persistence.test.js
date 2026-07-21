import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SaasPlatformModule } from '../dist/platform/index.js';

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
