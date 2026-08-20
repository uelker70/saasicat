import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Controller, Get, Logger, Module, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { SaasPlatformModule, StaticFeatureGuard } from '../dist/platform/index.js';
import { FeatureGuard, RequireFeature } from '../dist/billing/index.js';

// Does the application actually fail to start?
//
// The unit cases construct `EnforcementChainCheck` directly and call its
// lifecycle hook. That proves the decision; it does not prove that Nest reaches
// the decision, that the check can be constructed through DI, or that a thrown
// hook stops `app.init()` rather than being logged and swallowed.
//
// This repository has already paid for the difference once: the first version
// of the check was tested by construction only, and shipped a provider Nest
// could not resolve — "Nest can't resolve dependencies of the
// FeatureGuardCoverageCheck", found by a consumer's suite rather than ours.
//
// So these boot real applications.

class FakeJwtGuard {
    canActivate() {
        return true;
    }
}

class FakeMfaPort {
    async getSecret() {
        return null;
    }
    async setSecret() {}
    async isEnabled() {
        return false;
    }
}

class FakeAuditPort {
    async write() {}
}

class FakeRlsBypassPort {
    async runWithBypass(fn) {
        return fn();
    }
}

const MINIMAL_CATALOG = {
    schemaVersion: 1,
    projectKey: 'test-app',
    app: { name: 'TestApp', version: '0.0.1' },
    currency: 'EUR',
    vatRate: 19.0,
    plans: [],
};

function platformOptions(extra = {}) {
    return {
        planCatalog: MINIMAL_CATALOG,
        controller: { guards: [FakeJwtGuard] },
        // These boot real applications, and a booted DiscoveryModule writes its
        // snapshot to `var/discovery-snapshot.json` — under the repository root
        // when the suite runs there. `null` is the documented way to ask for no
        // file; the tests are about the enforcement chain, not about discovery.
        discoverySnapshotPath: null,
        adapters: {
            mfa: new FakeMfaPort(),
            audit: new FakeAuditPort(),
            rlsBypass: new FakeRlsBypassPort(),
        },
        ...extra,
    };
}

/**
 * Builds a controller the way the compiler would.
 *
 * This suite runs as plain JS, where `@Controller` is a syntax error, so the
 * decorators are applied as the functions they are. Deliberately the real ones
 * rather than hand-written metadata: what is being checked is that the check
 * reads what Nest's own decorators write.
 */
function makeController(name, path, { method, features, guards }) {
    const ctor = { [name]: class {} }[name];
    ctor.prototype[method] = function handler() {
        return [];
    };
    const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, method);

    Get()(ctor.prototype, method, descriptor);
    if (features) RequireFeature(...features)(ctor.prototype, method, descriptor);
    if (guards) UseGuards(...guards)(ctor.prototype, method, descriptor);
    Controller(path)(ctor);
    return ctor;
}

/** A route that claims a licensed feature and has no guard. */
const UnguardedReportsController = makeController('UnguardedReportsController', 'reports', {
    method: 'list',
    features: ['reports.export'],
});

/** The same route, behind the platform's own guard. */
const GuardedReportsController = makeController('GuardedReportsController', 'guarded-reports', {
    method: 'list',
    features: ['reports.export'],
    guards: [FakeJwtGuard, StaticFeatureGuard],
});

/** A route that claims nothing. */
const PlainController = makeController('PlainController', 'health', { method: 'ping' });

/** The same requirement, behind the V3 entitlement guard. */
const V3GuardedController = makeController('V3GuardedController', 'v3-reports', {
    method: 'list',
    features: ['reports.export'],
    guards: [FakeJwtGuard, FeatureGuard],
});

function appWith(controller, platform) {
    const TestApp = class {};
    Module({ imports: [SaasPlatformModule.forRoot(platform)], controllers: [controller] })(TestApp);
    return TestApp;
}

/**
 * Boots the module and returns the error, or `null`.
 *
 * Nest logs an "Error during bootstrap" line of its own before rethrowing, and
 * a test suite that prints it looks like a failing run. Silenced for the
 * duration, and only for the duration.
 */
async function boot(TestApp) {
    const original = Logger.prototype.error;
    Logger.prototype.error = () => {};
    let app;
    try {
        app = await Test.createTestingModule({ imports: [TestApp] }).compile();
        await app.init();
        return null;
    } catch (err) {
        return err;
    } finally {
        Logger.prototype.error = original;
        await app?.close().catch(() => {});
    }
}

describe('an application whose enforcement chain is broken does not start', () => {
    test('inert entitlement plus an annotated route: boot fails', async () => {
        // No planResolver, no defaultPlanId, no tenantBilling — the static
        // entitlement stack is never registered, so `@RequireFeature` is markup.
        const error = await boot(appWith(UnguardedReportsController, platformOptions()));

        assert.ok(error, 'the application booted with inert licence enforcement');
        assert.match(error.message, /nothing can resolve a tenant to a plan/);
        assert.match(error.message, /UnguardedReportsController\.list/);
    });

    test('globalFeatureGuard: false plus an unguarded annotated route: boot fails', async () => {
        const error = await boot(
            appWith(
                UnguardedReportsController,
                platformOptions({ defaultPlanId: 'STARTER', globalFeatureGuard: false }),
            ),
        );

        assert.ok(error, 'the application booted with an unguarded annotated route');
        assert.match(error.message, /globalFeatureGuard is off/);
        assert.match(error.message, /UnguardedReportsController\.list/);
    });
});

describe('an application whose chain is intact starts', () => {
    // The half that decides whether the check is usable. Each of these is a
    // shape a real consumer ships, and stopping any of them from booting would
    // be worse than the problem being solved.

    test('globalFeatureGuard: false with the guard bound per route', async () => {
        const error = await boot(
            appWith(
                GuardedReportsController,
                platformOptions({ defaultPlanId: 'STARTER', globalFeatureGuard: false }),
            ),
        );
        assert.equal(error, null, error?.message);
    });

    test('the platform binding its own global guard', async () => {
        const error = await boot(
            appWith(UnguardedReportsController, platformOptions({ defaultPlanId: 'STARTER' })),
        );
        assert.equal(error, null, error?.message);
    });

    test('inert entitlement with nothing annotated — a catalogue-only app', async () => {
        const error = await boot(appWith(PlainController, platformOptions()));
        assert.equal(error, null, error?.message);
    });

    test('the V3 entitlement path, with FeatureGuard bound per route', async () => {
        // `entitlement: {}` and no plan resolver leaves the STATIC stack
        // unregistered, and the first version of this check called that inert
        // and refused the boot. It is not inert: `EntitlementService` resolves
        // entitlements from the subscription repository, and `FeatureGuard`
        // from @saasicat/nest/billing enforces them. Refusing a correctly
        // wired application is the one failure this check may not have.
        const error = await boot(
            appWith(
                V3GuardedController,
                platformOptions({
                    entitlement: {},
                    adapters: {
                        mfa: new FakeMfaPort(),
                        audit: new FakeAuditPort(),
                        rlsBypass: new FakeRlsBypassPort(),
                        subscriptionRepository: { findActiveByTenantId: async () => null },
                        planVersionRepository: { findById: async () => null },
                        transactionRunner: { run: async (fn) => fn({}) },
                    },
                }),
            ),
        );
        assert.equal(error, null, error?.message);
    });

    test('…but the same path with no feature guard at all does not', async () => {
        // The other half: V3 binds no global guard either, so an annotated
        // route with nothing in front of it is open, and saying so is the
        // whole point.
        const error = await boot(
            appWith(
                UnguardedReportsController,
                platformOptions({
                    entitlement: {},
                    adapters: {
                        mfa: new FakeMfaPort(),
                        audit: new FakeAuditPort(),
                        rlsBypass: new FakeRlsBypassPort(),
                        subscriptionRepository: { findActiveByTenantId: async () => null },
                        planVersionRepository: { findById: async () => null },
                        transactionRunner: { run: async (fn) => fn({}) },
                    },
                }),
            ),
        );
        assert.ok(error, 'an annotated route with no guard on the V3 path is open');
        assert.match(error.message, /UnguardedReportsController\.list/);
    });
});
