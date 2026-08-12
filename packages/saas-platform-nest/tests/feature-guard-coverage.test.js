import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { MetadataScanner } from '@nestjs/core';

import { FeatureGuardCoverageCheck } from '../dist/platform/index.js';
import { REQUIRE_FEATURE_KEY, FEATURE_GUARD_MARKER } from '../dist/billing/index.js';

// `globalFeatureGuard: false` is a legitimate setup — the app binds a feature
// guard per controller, behind its own auth guard. Both consumers we know of
// do it, and both do it correctly on every annotated route.
//
// The warning this replaced fired on the option alone, from `forRoot()`, where
// no route exists yet. It therefore told correctly-configured applications
// that they were serving unlicensed traffic. That is worse than silence: a
// warning that cries wolf teaches people to scroll past warnings, including
// the ones that mean something.
//
// Both directions are asserted here. Silence has to mean "checked, nothing
// open", which is only worth anything while the other test proves the check
// still speaks up when something IS open.

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
    }
    return ctor;
}

/** Runs the check over `controllers` and returns what it warned. */
function warningsFor(controllers) {
    const warnings = [];
    const original = Logger.prototype.warn;
    Logger.prototype.warn = function capture(message) {
        warnings.push(String(message));
    };

    try {
        const discoveryService = {
            getControllers: () => controllers.map((ctor) => ({ instance: new ctor() })),
        };
        const check = new FeatureGuardCoverageCheck(discoveryService, new MetadataScanner());
        check.onApplicationBootstrap();
    } finally {
        Logger.prototype.warn = original;
    }

    return warnings.filter((w) => w.includes('globalFeatureGuard'));
}

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

describe('FeatureGuardCoverageCheck', () => {
    test('says nothing when every annotated route has a feature guard', () => {
        assert.deepEqual(
            warningsFor([COVERED, COVERED_ON_HANDLER, CLASS_LEVEL_WITH_HELPER, UNANNOTATED]),
            [],
            'a correct configuration must not be warned at — that is what made the old one useless',
        );
    });

    test('names the route when one is annotated and unguarded', () => {
        const warnings = warningsFor([COVERED, UNCOVERED]);

        assert.equal(warnings.length, 1, 'expected exactly one warning');
        assert.match(warnings[0], /UncoveredController\.list/);
        assert.match(warnings[0], /reports\.export or reports\.legacy/);
        assert.doesNotMatch(
            warnings[0],
            /CoveredController/,
            'the covered route must not be listed as open',
        );
    });

    test('is not fooled by a guard that merely shares the name', () => {
        // The dangerous direction. `FeatureGuard` is a name any application
        // might use; treating it as ours would silence the warning while
        // nothing enforces the entitlement.
        const warnings = warningsFor([NAME_COLLISION]);

        assert.equal(warnings.length, 1, 'a same-named foreign guard must not count as coverage');
        assert.match(warnings[0], /NameCollisionController\.list/);
    });

    test('ignores helper methods that inherit a class-level requirement', () => {
        // `buildQuery` is not a route. Judging it by its guards would report it
        // as open while every real endpoint is covered — the false positive
        // this check exists to remove.
        const warnings = warningsFor([CLASS_LEVEL_WITH_HELPER]);

        assert.deepEqual(warnings, []);
    });

    test('reports an unrecognised wrapper rather than assuming it is safe', () => {
        // A guard of the app's own that wraps ours cannot be recognised from
        // here. Naming the route is cheap to check, and the message says as
        // much; staying silent about a genuinely open route is not
        // recoverable.
        const warnings = warningsFor([WRAPPED]);

        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /WrappedGuardController\.list/);
        assert.match(warnings[0], /wraps either one is not recognised/);
    });
});
