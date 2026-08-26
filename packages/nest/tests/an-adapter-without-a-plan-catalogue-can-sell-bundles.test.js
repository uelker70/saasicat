import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { SaaSiCatModule } from '../dist/platform/index.js';

// Where a bundle repository may come from.
//
// The composer and the boot-time validation both read it from exactly one
// place: `persistence.catalog.bundleRepository`. That slice also requires a
// `planRepository`, so an adapter that has a bundle catalogue and no plan
// catalogue cannot expose one at all — and `subscriptionBundles: true` then
// fails at startup with "missing bundleRepository", however complete its bundle
// support is.
//
// `adapter-drizzle` is exactly that shape. Its bundle repositories were
// unreachable through the advertised entry point until the two readers learned
// that `entitlement.bundleRepository` is the same answer.

class FakeGuard {
    canActivate() {
        return true;
    }
}

const CATALOG = {
    schemaVersion: 1,
    projectKey: 'app',
    app: { name: 'App', version: '0.0.1' },
    currency: 'EUR',
    vatRate: 19,
    plans: [],
};

/** A persistence bundle shaped the way `adapter-drizzle` ships one. */
function persistenceWithoutPlanCatalogue({ bundleRepository = {} } = {}) {
    const spec = {};
    return {
        capabilities: {
            transactions: true,
            pessimisticLocking: true,
            rowLevelSecurity: false,
            advisoryLocks: false,
        },
        core: { mfa: spec, audit: spec, rlsBypass: spec, transactionRunner: spec },
        entitlement: {
            subscriptionRepository: spec,
            planVersionRepository: spec,
            subscriptionBundleRepository: spec,
            bundleRepository,
        },
        // No `catalog` slice at all: it demands a PlanRepository this adapter
        // does not have.
    };
}

const boot = (persistence) =>
    SaaSiCatModule.forRoot({
        planCatalog: CATALOG,
        controller: { guards: [FakeGuard] },
        discoverySnapshotPath: null,
        persistence,
        tenantBilling: {
            authGuards: { jwt: FakeGuard },
            subscriptionUsagePort: {},
            usageSnapshotPort: {},
            subscriptionWritePort: {},
        },
        subscriptionBundles: {},
        entitlement: { defaultPlanId: 'PRO' },
    });

describe('an adapter with bundles but no plan catalogue', () => {
    test('boots with subscriptionBundles enabled', () => {
        // The whole point of the adapter's bundle support: a consumer on it can
        // sell an add-on. Before this, `forRoot` threw
        // `subscription-bundles.requires-repositories`.
        const module = boot(persistenceWithoutPlanCatalogue());
        assert.ok(module.imports.length > 0);
    });

    test('and the module is handed the repository it found', () => {
        const marker = { findVersionById: async () => null };
        const module = boot(persistenceWithoutPlanCatalogue({ bundleRepository: marker }));
        const bundles = module.imports.find(
            (imported) => (imported?.module?.name ?? '') === 'SubscriptionBundleModule',
        );
        assert.ok(bundles, 'SubscriptionBundleModule must be composed');
        const providesMarker = (bundles.providers ?? []).some(
            (provider) => provider?.useValue === marker,
        );
        assert.ok(providesMarker, 'the repository the adapter offered must be the one bound');
    });

    test('an adapter with neither is still refused, by name', () => {
        // The rule exists for a reason and has to keep firing: a consumer who
        // enables the bundle store without any bundle persistence gets a
        // sentence naming what is missing, not a runtime failure later.
        const persistence = persistenceWithoutPlanCatalogue();
        delete persistence.entitlement.bundleRepository;
        assert.throws(
            () => boot(persistence),
            (err) => {
                assert.match(String(err.message), /bundleRepository/);
                return true;
            },
        );
    });

    test('a plan catalogue still wins where an adapter has one', () => {
        // Two adapters may offer both; the catalogue slice is the more specific
        // statement and stays the first answer.
        const fromCatalogue = { findVersionById: async () => 'catalogue' };
        const fromEntitlement = { findVersionById: async () => 'entitlement' };
        const persistence = persistenceWithoutPlanCatalogue({
            bundleRepository: fromEntitlement,
        });
        persistence.catalog = { planRepository: {}, bundleRepository: fromCatalogue };

        const module = boot(persistence);
        const bundles = module.imports.find(
            (imported) => (imported?.module?.name ?? '') === 'SubscriptionBundleModule',
        );
        assert.ok(
            (bundles.providers ?? []).some((provider) => provider?.useValue === fromCatalogue),
        );
    });
});
