import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';
import { DiscoveryModule as NestDiscoveryModule } from '@nestjs/core';

import { SaaSiCatModule } from '../dist/platform/index.js';

// A configuration that leaves `@RequireFeature`/`@EnforceQuota` inert breaks
// nothing visibly: annotated routes keep answering, quotas read as unlimited,
// and the app looks healthy. The module documented a boot warning for exactly
// this, but never emitted one — the first real signal was a customer using a
// feature they had not bought.
//
// These tests exist so that gap cannot come back silently.

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

function baseOptions(extra = {}) {
    return {
        planCatalog: MINIMAL_CATALOG,
        controller: { guards: [FakeJwtGuard] },
        adapters: {
            mfa: new FakeMfaPort(),
            audit: new FakeAuditPort(),
            rlsBypass: new FakeRlsBypassPort(),
        },
        ...extra,
    };
}

describe('SaaSiCatModule.forRoot — enforcement-chain warnings', () => {
    let warnings;
    let originalWarn;

    beforeEach(() => {
        warnings = [];
        originalWarn = Logger.prototype.warn;
        Logger.prototype.warn = function collect(message) {
            warnings.push(String(message));
        };
    });

    afterEach(() => {
        Logger.prototype.warn = originalWarn;
    });

    test('warns when no plan resolver and no fallback plan are configured', () => {
        SaaSiCatModule.forRoot(baseOptions());

        const hit = warnings.find((w) => w.includes('INERT'));
        assert.ok(hit, `expected an inert-enforcement warning, got: ${JSON.stringify(warnings)}`);
        // The message has to name the way out, not just the symptom.
        assert.match(hit, /adapters\.planResolver/);
        assert.match(hit, /defaultPlanId/);
        assert.match(hit, /tenantBilling/);
    });

    test('stays silent once defaultPlanId activates the static entitlement stack', () => {
        SaaSiCatModule.forRoot(baseOptions({ defaultPlanId: 'STARTER' }));

        assert.deepEqual(
            warnings.filter((w) => w.includes('INERT')),
            [],
        );
    });

    test('registers the coverage check instead of warning on the option alone', () => {
        // `forRoot()` runs before any controller exists, so the only thing it
        // could say here is the option read back — which it did, at
        // applications that had every annotated route guarded correctly. The
        // question is asked after bootstrap now, by EnforcementChainCheck,
        // against the routes that are actually there — and answered by
        // refusing the boot, not by another line in a log.
        const moduleDef = SaaSiCatModule.forRoot(
            baseOptions({ defaultPlanId: 'STARTER', globalFeatureGuard: false }),
        );

        assert.deepEqual(
            warnings.filter((w) => w.includes('globalFeatureGuard')),
            [],
            'the option alone is not evidence of an open route',
        );
        assert.ok(
            (moduleDef.providers ?? []).some(
                (p) => typeof p === 'function' && p.name === 'EnforcementChainCheck',
            ),
            'the check has to be registered, or nothing asks the question at all',
        );

        // ...and it has to be constructible. The check injects Nest's
        // DiscoveryService and MetadataScanner, which only exist once
        // @nestjs/core's DiscoveryModule is imported. Registering the provider
        // without it takes the whole application down at boot with "Nest can't
        // resolve dependencies" — found by a consumer's test suite, not by
        // ours, because the first test for this check constructed the class
        // directly and never went through DI.
        // By IDENTITY, not by name: the platform ships a DiscoveryModule of its
        // own, so a name comparison here passes whether or not Nest's is
        // present — it would assert nothing. (That is the same mistake this
        // package already made once, matching guards by class name.)
        assert.ok(
            (moduleDef.imports ?? []).includes(NestDiscoveryModule),
            "@nestjs/core's DiscoveryModule must be imported, or the check cannot be constructed",
        );
    });

    test('stays silent on the default path with the guard bound', () => {
        SaaSiCatModule.forRoot(baseOptions({ defaultPlanId: 'STARTER' }));

        assert.deepEqual(
            warnings.filter((w) => w.includes('globalFeatureGuard')),
            [],
        );
    });

    test('the inert branch registers the check too, with the state that says so', () => {
        // Without this the boot error for case 1 could never fire: `forRoot`
        // used to register the check ONLY in the `globalFeatureGuard: false`
        // branch, which the inert configuration never reaches. A guard nobody
        // constructs is the failure mode this whole file exists for, one level
        // up.
        const moduleDef = SaaSiCatModule.forRoot(baseOptions());

        assert.ok(
            (moduleDef.providers ?? []).some(
                (p) => typeof p === 'function' && p.name === 'EnforcementChainCheck',
            ),
            'nothing asks the question when no plan resolver exists',
        );

        const state = (moduleDef.providers ?? []).find(
            (p) =>
                typeof p === 'object' &&
                p !== null &&
                'useValue' in p &&
                p.useValue?.featureEnforcementActive === false,
        );
        assert.ok(state, 'the check has no way to tell it is in the inert case');
        assert.equal(state.useValue.globalGuardBound, false);

        assert.ok(
            (moduleDef.imports ?? []).includes(NestDiscoveryModule),
            "and it has to be constructible — Nest's DiscoveryModule must be imported",
        );
    });
});
