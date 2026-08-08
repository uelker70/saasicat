import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import * as platformEntry from '../dist/platform/index.js';
import { SaasPlatformModule, StaticFeatureGuard } from '../dist/platform/index.js';
import * as rootEntry from '../dist/index.js';

// The mega-module composes a lot for the app. These tests cover the seams an
// app needs when its shape does not match the defaults — each one is a real
// consumer blocker that had no way out before.

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

const baseOptions = () => ({
    planCatalog: MINIMAL_CATALOG,
    controller: { guards: [FakeJwtGuard] },
    adapters: {
        mfa: new FakeMfaPort(),
        audit: new FakeAuditPort(),
        rlsBypass: new FakeRlsBypassPort(),
    },
    defaultPlanId: 'starter',
});

const tokensOf = (dyn) => (dyn.providers ?? []).map((p) => p.provide ?? p);

describe('globalFeatureGuard', () => {
    test('defaults to binding StaticFeatureGuard as APP_GUARD', () => {
        const dyn = SaasPlatformModule.forRoot(baseOptions());
        const appGuards = (dyn.providers ?? []).filter((p) => p.provide === APP_GUARD);
        assert.equal(appGuards.length, 1, 'exactly one APP_GUARD by default');
        assert.equal(appGuards[0].useExisting, StaticFeatureGuard);
    });

    test('false removes the global APP_GUARD binding', () => {
        const dyn = SaasPlatformModule.forRoot({ ...baseOptions(), globalFeatureGuard: false });
        assert.equal(
            tokensOf(dyn).filter((t) => t === APP_GUARD).length,
            0,
            'no global guard when the app binds feature enforcement itself',
        );
    });

    test('false keeps the guard class available as a provider to bind manually', () => {
        // Apps that opt out still need the class — they bind it behind their
        // own auth guard: @UseGuards(JwtAuthGuard, StaticFeatureGuard).
        const dyn = SaasPlatformModule.forRoot({ ...baseOptions(), globalFeatureGuard: false });
        assert.ok(tokensOf(dyn).includes(StaticFeatureGuard));
        assert.ok((dyn.exports ?? []).includes(StaticFeatureGuard));
    });

    test('false does not disable the quota interceptor', () => {
        // Interceptors run after ALL guards, so the global interceptor does see
        // an authenticated request. Only the guard has the ordering problem.
        const dyn = SaasPlatformModule.forRoot({ ...baseOptions(), globalFeatureGuard: false });
        const interceptors = (dyn.providers ?? []).filter((p) => p.provide === APP_INTERCEPTOR);
        assert.equal(interceptors.length, 1, 'EnforceQuotaInterceptor stays global');
    });
});

describe('includeManifestController', () => {
    const manifestModuleOf = (dyn) =>
        (dyn.imports ?? []).find((imported) => imported?.module?.name === 'AdminManifestModule');

    // AdminPublicBootController is always mounted; only the manifest
    // controller is governed by the flag.
    const manifestControllers = (dyn) =>
        (manifestModuleOf(dyn).controllers ?? []).filter(
            (c) => c.name !== 'AdminPublicBootController',
        );

    test('is passed through to AdminManifestModule', () => {
        const dyn = SaasPlatformModule.forRoot({
            ...baseOptions(),
            includeManifestController: false,
        });
        assert.ok(manifestModuleOf(dyn), 'AdminManifestModule is always imported');
        assert.deepEqual(
            manifestControllers(dyn),
            [],
            'no platform manifest controller when the app serves that route itself — ' +
                'two controllers on one path abort the boot',
        );
    });

    test('defaults to mounting the manifest controller', () => {
        assert.equal(manifestControllers(SaasPlatformModule.forRoot(baseOptions())).length, 1);
    });
});

describe('platform entry class identity', () => {
    // The CJS builds do not share code between entries, so every class an app
    // may inject must be reachable from the entry that registers it. A class
    // exported only from ./admin or ./entitlement is a different object there
    // and fails to resolve at boot. See platform/index.ts for the full rule.
    const MUST_EXPORT = [
        'AdminAuditService',
        'AdminBypassRlsInterceptor',
        'AdminManifestService',
        'AdminResourcesService',
        'BundlesService',
        'CatalogEntriesService',
        'ComposedTenantAuthGuard',
        'DiscoveryScanner',
        'EntitlementService',
        'MarketingProjectionsService',
        'MarketingSettingsService',
        'MfaGuard',
        'MfaService',
        'PendingPlanMaterializationService',
        'PlanChangePreviewService',
        'PlanVersionsService',
        'PlansService',
        'PromoCodeRateLimitGuard',
        'PromoCodesService',
        'PromotionsService',
        'PublicMarketingCatalogService',
        'SubscriptionBundlePreviewService',
        'SubscriptionBundlesService',
        'SuperAdminGuard',
        'TenantAdminGuard',
    ];

    for (const name of MUST_EXPORT) {
        test(`${name} is re-exported from @saasicat/nest/platform`, () => {
            assert.equal(
                typeof platformEntry[name],
                'function',
                `${name} must be re-exported from the platform entry — an app injecting ` +
                    'it from another entry gets a different class object and fails at boot',
            );
        });
    }
});

describe('root entry incremental migration', () => {
    test('root SaaSiCatModule composes the same root-entry module classes', () => {
        const dyn = rootEntry.SaaSiCatModule.forRoot({
            ...baseOptions(),
            setup: {
                provisioningPort: {},
            },
        });
        const adminModule = dyn.imports.find(
            (imported) => imported?.module?.name === 'AdminModule',
        );
        const setupModule = dyn.imports.find(
            (imported) => imported?.module?.name === 'SetupModule',
        );

        assert.equal(adminModule.module, rootEntry.AdminModule);
        assert.equal(setupModule.module, rootEntry.SetupModule);
    });
});
