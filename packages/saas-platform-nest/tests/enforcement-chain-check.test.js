import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { MetadataScanner } from '@nestjs/core';

import { EnforcementChainCheck } from '../dist/platform/index.js';
import { REQUIRE_FEATURE_KEY, FEATURE_GUARD_MARKER } from '../dist/billing/index.js';
import { ENFORCE_QUOTA_KEY } from '../dist/discovery/index.js';

// The check refuses the boot rather than warning about it, and that is the
// point: a warning about unlicensed traffic is read once, by whoever happened
// to be watching the deploy. The application it describes bills nobody and
// looks healthy.
//
// It is deliberately narrow. `globalFeatureGuard: false` is a legitimate setup
// — the app binds a feature guard per controller, behind its own auth guard.
// Both consumers we know of do it, and both do it correctly on every annotated
// route; none of them may be stopped from booting. So silence has to mean
// "checked, nothing open", which is only worth anything while the other cases
// prove the check still speaks up when something IS open.
//
// The predecessor warned from `forRoot()`, where no route exists yet, so it
// fired on the option alone and told correctly-configured applications they
// were serving unlicensed traffic. A warning that cries wolf teaches people to
// scroll past warnings, including the ones that mean something.

const GUARDS_METADATA = '__guards__';
const METHOD_METADATA = 'method';

class FakeAuthGuard {}

/** Stands in for the real platform guards: recognised by its marker. */
class PlatformGuard {
    static [FEATURE_GUARD_MARKER] = true;
}

/**
 * An application's own guard that merely SHARES the name.
 *
 * `FeatureGuard` is a name anyone might pick. Matching on it would report this
 * route as covered while the platform's enforcement is absent — a false
 * negative, which is the one direction this check must never fail in.
 */
class FeatureGuard {}

/** The app's own guard wrapping ours — deliberately unrecognisable from here. */
class MyOwnFeatureGuard {}

/**
 * Builds a controller class without decorator syntax.
 *
 * The suite runs as plain JS, where `@Controller` is a syntax error — so the
 * decorators are applied the way the compiler would: as metadata on the class
 * and its prototype methods.
 */
function makeController(name, { classGuards = [], classFeatures = null, routes = {} }) {
    const ctor = { [name]: class {} }[name];
    if (classFeatures) {
        Reflect.defineMetadata(REQUIRE_FEATURE_KEY, classFeatures, ctor);
    }
    if (classGuards.length > 0) {
        Reflect.defineMetadata(GUARDS_METADATA, classGuards, ctor);
    }
    for (const [method, spec] of Object.entries(routes)) {
        ctor.prototype[method] = function handler() {};
        // Everything is a route unless the case says otherwise — helpers are
        // exactly what the filter has to skip.
        if (spec.helper !== true) {
            Reflect.defineMetadata(METHOD_METADATA, 0, ctor.prototype[method]);
        }
        if (spec.features) {
            Reflect.defineMetadata(REQUIRE_FEATURE_KEY, spec.features, ctor.prototype[method]);
        }
        if (spec.guards) {
            Reflect.defineMetadata(GUARDS_METADATA, spec.guards, ctor.prototype[method]);
        }
        if (spec.quota) {
            Reflect.defineMetadata(
                ENFORCE_QUOTA_KEY,
                { quotaKey: spec.quota },
                ctor.prototype[method],
            );
        }
    }
    return ctor;
}

/**
 * Boots the check over `controllers` and returns the error, or `null`.
 *
 * `null` is the assertion that matters in half these cases: an application that
 * is wired correctly must reach the end of bootstrap.
 */
function bootWith(controllers, state) {
    const discoveryService = {
        getControllers: () => controllers.map((ctor) => ({ instance: new ctor() })),
    };
    const check = new EnforcementChainCheck(discoveryService, new MetadataScanner(), state);
    try {
        check.onApplicationBootstrap();
        return null;
    } catch (err) {
        return err;
    }
}

/** The chain state of an app that unbound the platform's global guard. */
const OWN_GUARDS = { entitlementActive: true, globalGuardBound: false };

/** The chain state of an app that can resolve no plan at all. */
const INERT = { entitlementActive: false, globalGuardBound: false };

/** The state the platform is in by default: guard bound, nothing to check. */
const PLATFORM_GUARD_BOUND = { entitlementActive: true, globalGuardBound: true };

const COVERED = makeController('CoveredController', {
    classGuards: [FakeAuthGuard, PlatformGuard],
    routes: { list: { features: ['reports.export'] } },
});

const COVERED_ON_HANDLER = makeController('HandlerGuardedController', {
    classGuards: [FakeAuthGuard],
    routes: { list: { features: ['reports.export'], guards: [PlatformGuard] } },
});

/** Class-level requirement, guards per handler, plus an ordinary helper. */
const CLASS_LEVEL_WITH_HELPER = makeController('ClassLevelController', {
    classGuards: [FakeAuthGuard],
    classFeatures: ['reports.export'],
    routes: {
        list: { guards: [PlatformGuard] },
        buildQuery: { helper: true },
    },
});

/** Its own guard, same generic name as ours, no marker. */
const NAME_COLLISION = makeController('NameCollisionController', {
    classGuards: [FakeAuthGuard, FeatureGuard],
    routes: { list: { features: ['reports.export'] } },
});

const UNANNOTATED = makeController('PlainController', {
    routes: { list: {} },
});

const UNCOVERED = makeController('UncoveredController', {
    classGuards: [FakeAuthGuard],
    routes: { list: { features: ['reports.export', 'reports.legacy'] } },
});

const WRAPPED = makeController('WrappedGuardController', {
    classGuards: [FakeAuthGuard, MyOwnFeatureGuard],
    routes: { list: { features: ['reports.export'] } },
});

/** Only a quota annotation — no feature requirement, no guard. */
const QUOTA_ONLY = makeController('QuotaOnlyController', {
    classGuards: [FakeAuthGuard],
    routes: { create: { quota: 'notes.count' } },
});

describe('globalFeatureGuard: false — the app binds its own', () => {
    test('boots when every annotated route has a feature guard', () => {
        assert.equal(
            bootWith(
                [COVERED, COVERED_ON_HANDLER, CLASS_LEVEL_WITH_HELPER, UNANNOTATED],
                OWN_GUARDS,
            ),
            null,
            'a correct configuration must boot — that is what made the old warning useless',
        );
    });

    test('refuses to boot and names the route when one is unguarded', () => {
        const error = bootWith([COVERED, UNCOVERED], OWN_GUARDS);

        assert.ok(error, 'an open route must stop the boot');
        assert.match(error.message, /UncoveredController\.list/);
        assert.match(error.message, /reports\.export or reports\.legacy/);
        assert.doesNotMatch(
            error.message,
            /CoveredController/,
            'the covered route must not be listed as open',
        );
    });

    test('is not fooled by a guard that merely shares the name', () => {
        // The dangerous direction. `FeatureGuard` is a name any application
        // might use; treating it as ours would let the boot through while
        // nothing enforces the entitlement.
        const error = bootWith([NAME_COLLISION], OWN_GUARDS);

        assert.ok(error, 'a same-named foreign guard must not count as coverage');
        assert.match(error.message, /NameCollisionController\.list/);
    });

    test('ignores helper methods that inherit a class-level requirement', () => {
        // `buildQuery` is not a route. Judging it by its guards would stop the
        // boot of an application whose every real endpoint is covered — the
        // false positive this check exists to remove.
        assert.equal(bootWith([CLASS_LEVEL_WITH_HELPER], OWN_GUARDS), null);
    });

    test('reports an unrecognised wrapper rather than assuming it is safe', () => {
        // A guard of the app's own that wraps ours cannot be recognised from
        // here. A named route is cheap to check, and the message says as much;
        // booting past a genuinely open route is not recoverable.
        const error = bootWith([WRAPPED], OWN_GUARDS);

        assert.ok(error);
        assert.match(error.message, /WrappedGuardController\.list/);
        assert.match(error.message, /wraps either one is not recognised/);
    });

    test('a quota-only route is not a guard question', () => {
        // `EnforceQuotaInterceptor` stays global whatever this option says —
        // interceptors run after all guards, so unbinding the guard does not
        // touch it. Reporting a quota route here would be an error about
        // something that is working.
        assert.equal(bootWith([QUOTA_ONLY], OWN_GUARDS), null);
    });
});

describe('nothing can resolve a plan — the annotations are inert', () => {
    test('refuses to boot when a route requires a feature', () => {
        const error = bootWith([UNCOVERED], INERT);

        assert.ok(error, 'inert enforcement with annotated routes must stop the boot');
        assert.match(error.message, /nothing can resolve a tenant to a plan/);
        assert.match(error.message, /UncoveredController\.list/);
        assert.match(error.message, /adapters\.planResolver, defaultPlanId, or tenantBilling/);
    });

    test('refuses to boot for a quota annotation too', () => {
        // The interceptor is not registered either, so `@EnforceQuota` reads as
        // unlimited. The guard question does not arise; the resolver one does.
        const error = bootWith([QUOTA_ONLY], INERT);

        assert.ok(error);
        assert.match(error.message, /enforces quota notes\.count/);
    });

    test('a guard in front of the route does not make it enforceable', () => {
        // The guard is registered by the app, but there is no entitlement
        // service behind it. Counting it as coverage here is the one mistake
        // that would make this whole case silent again.
        const error = bootWith([COVERED], INERT);

        assert.ok(error, 'a guard with nothing behind it is not enforcement');
    });

    test('boots when no route is annotated at all', () => {
        // A catalogue-only application that never enforces anything is a real
        // and supported shape. `forRoot` has already logged that the stack is
        // inert; there is nothing here to add.
        assert.equal(bootWith([UNANNOTATED], INERT), null);
    });
});

describe('the platform bound its own guard', () => {
    test('says nothing, whatever the routes look like', () => {
        // Every annotated route is covered by the global APP_GUARD, so an
        // uncovered-looking controller is not uncovered.
        assert.equal(bootWith([UNCOVERED, QUOTA_ONLY], PLATFORM_GUARD_BOUND), null);
    });
});
