import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Logger } from '@nestjs/common';

import { SaasPlatformModule } from '../dist/platform/index.js';

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

describe('SaasPlatformModule.forRoot — enforcement-chain warnings', () => {
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
        SaasPlatformModule.forRoot(baseOptions());

        const hit = warnings.find((w) => w.includes('INERT'));
        assert.ok(hit, `expected an inert-enforcement warning, got: ${JSON.stringify(warnings)}`);
        // The message has to name the way out, not just the symptom.
        assert.match(hit, /adapters\.planResolver/);
        assert.match(hit, /defaultPlanId/);
        assert.match(hit, /tenantBilling/);
    });

    test('stays silent once defaultPlanId activates the static entitlement stack', () => {
        SaasPlatformModule.forRoot(baseOptions({ defaultPlanId: 'STARTER' }));

        assert.deepEqual(
            warnings.filter((w) => w.includes('INERT')),
            [],
        );
    });

    test('registers the coverage check instead of warning on the option alone', () => {
        // `forRoot()` runs before any controller exists, so the only thing it
        // could say here is the option read back — which it did, at
        // applications that had every annotated route guarded correctly. The
        // question is asked after bootstrap now, by FeatureGuardCoverageCheck,
        // against the routes that are actually there.
        const moduleDef = SaasPlatformModule.forRoot(
            baseOptions({ defaultPlanId: 'STARTER', globalFeatureGuard: false }),
        );

        assert.deepEqual(
            warnings.filter((w) => w.includes('globalFeatureGuard')),
            [],
            'the option alone is not evidence of an open route',
        );
        assert.ok(
            (moduleDef.providers ?? []).some(
                (p) => typeof p === 'function' && p.name === 'FeatureGuardCoverageCheck',
            ),
            'the check has to be registered, or nothing asks the question at all',
        );
    });

    test('stays silent on the default path with the guard bound', () => {
        SaasPlatformModule.forRoot(baseOptions({ defaultPlanId: 'STARTER' }));

        assert.deepEqual(
            warnings.filter((w) => w.includes('globalFeatureGuard')),
            [],
        );
    });
});
