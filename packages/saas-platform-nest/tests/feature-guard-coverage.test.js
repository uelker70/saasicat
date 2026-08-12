import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { MetadataScanner } from '@nestjs/core';

import { FeatureGuardCoverageCheck } from '../dist/platform/index.js';
import { REQUIRE_FEATURE_KEY } from '../dist/billing/index.js';

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

class FakeAuthGuard {}
class FeatureGuard {}
class StaticFeatureGuard {}
/** The app's own guard wrapping ours — deliberately unrecognisable from here. */
class MyOwnFeatureGuard {}

/**
 * Builds a controller class without decorator syntax.
 *
 * The suite runs as plain JS, where `@Controller` is a syntax error — so the
 * decorators are applied the way the compiler would: as metadata on the class
 * and its prototype methods.
 */
function makeController(name, { classGuards = [], routes = {} }) {
    const ctor = { [name]: class {} }[name];
    if (classGuards.length > 0) {
        Reflect.defineMetadata(GUARDS_METADATA, classGuards, ctor);
    }
    for (const [method, spec] of Object.entries(routes)) {
        ctor.prototype[method] = function handler() {};
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
    classGuards: [FakeAuthGuard, FeatureGuard],
    routes: { list: { features: ['reports.export'] } },
});

const COVERED_ON_HANDLER = makeController('HandlerGuardedController', {
    classGuards: [FakeAuthGuard],
    routes: { list: { features: ['reports.export'], guards: [StaticFeatureGuard] } },
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
            warningsFor([COVERED, COVERED_ON_HANDLER, UNANNOTATED]),
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
