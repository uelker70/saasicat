import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
    FEATURE_COMPOSERS,
    MOUNTED_BUT_NOT_EXPORTED,
    SaaSiCatModule,
    composeFeatures,
    composeModuleExports,
} from '../dist/platform/index.js';
import { DISCOVERY_APP_INFO_TOKEN } from '../dist/discovery/index.js';

// Two properties the decomposition exists to keep, asked as behaviour.
//
// `forRoot` used to be one ~600-line procedure. Every feature touched four
// places in it: the `if` that mounts the module, the `exports` arm two hundred
// lines further down, the option type, and the validation. The two that could
// silently disagree were the first and the second — a module mounted and not
// exported is an `UnknownDependenciesException` in somebody else's application,
// at boot, naming a class they never wrote.
//
// Nothing about splitting the file fixes that by itself. This is what does.

const MINIMAL_CATALOG = {
    schemaVersion: 1,
    app: { name: 'TestApp', version: '0.0.1' },
    currency: 'EUR',
    vatRate: 19,
    plans: [],
};

const PORT = {};
const REPO = {};

/** The persistence bundle the probe binds, shared by both places it appears. */
const PERSISTENCE = {
    core: {},
    catalog: {
        planRepository: REPO,
        bundleRepository: REPO,
        catalogEntryRepository: REPO,
        marketingProjectionRepository: REPO,
        promotionRepository: REPO,
        marketingSettingsRepository: REPO,
    },
    entitlement: { subscriptionBundleRepository: REPO },
    adminResources: { resources: REPO },
    promo: {
        promoCodeRepository: REPO,
        redemptionRepository: REPO,
        validationLogRepository: REPO,
        subscriptionLookup: REPO,
        revenueAggregator: REPO,
    },
    tenantBilling: { subscriptionWritePort: PORT, usageSnapshotPort: PORT },
    capabilities: { transactions: true, pessimisticLocking: true },
};

/** A configuration with every optional feature on and every port bound. */
function everythingOn() {
    return {
        options: {
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [] },
            entitlement: {},
            catalog: {},
            tenantBilling: { authGuards: [], subscriptionUsagePort: PORT },
            subscriptionBundles: true,
            adminResources: true,
            promoCodes: true,
            setup: true,
            adminStats: {},
            checkoutOffer: {},
            subscriptionContract: true,
            tenantManifest: true,
            defaultPlanId: 'STARTER',
            persistence: PERSISTENCE,
        },
        adapters: {
            mfa: PORT,
            audit: PORT,
            rlsBypass: PORT,
            subscriptionRepository: REPO,
            planVersionRepository: REPO,
            transactionRunner: REPO,
        },
        // The context carries it separately from the options, the way
        // `forRoot` hands it over.
        persistence: PERSISTENCE,
        appInfo: { key: 'test-app', version: '0.0.1' },
        requiresFullEntitlement: true,
        shared: { quotaProvidersHostedByTenantBilling: false },
    };
}

// @requirement SC-SCOPE-007 — The platform is a NestJS application, and a foreign backend mounts it
describe('every module a composer mounts is also exported', () => {
    test('with every feature on', () => {
        const ctx = everythingOn();
        const mounted = composeFeatures(ctx).map((m) => m.module);
        const exported = new Set(composeModuleExports(ctx, []));

        const unexported = mounted
            .filter((m) => !exported.has(m))
            .map((m) => m.name)
            // The deliberate ones are declared beside the export table, with
            // their reason — not listed here, where a reader of the guard would
            // have to take it on trust.
            .filter((name) => !MOUNTED_BUT_NOT_EXPORTED.includes(name));

        assert.deepEqual(
            unexported,
            [],
            'a module mounted but not exported is an UnknownDependenciesException in a ' +
                'consumer, at boot, naming a class they never wrote',
        );
    });

    test('every declared exception is actually mounted', () => {
        // The other half of an exception list: one that outlives the thing it
        // excuses turns into a hole nobody notices.
        const mounted = new Set(composeFeatures(everythingOn()).map((m) => m.module.name));
        for (const name of MOUNTED_BUT_NOT_EXPORTED) {
            assert.ok(mounted.has(name), `${name} is excused from exporting but is never mounted`);
        }
    });

    test('the probe actually mounts something', () => {
        // Without this the check above is green on a configuration where every
        // composer returned nothing — the exact shape of a vacuous guard.
        const mounted = composeFeatures(everythingOn());
        assert.ok(mounted.length >= 10, `only ${mounted.length} modules mounted`);
    });

    test('a feature that is off is neither mounted nor exported', () => {
        // The other direction: exporting a module nobody mounted is an
        // UnknownExportException, which fails at boot just as hard.
        const ctx = everythingOn();
        ctx.options.promoCodes = false;
        ctx.options.setup = false;

        const mounted = new Set(composeFeatures(ctx).map((m) => m.module.name));
        const exported = composeModuleExports(ctx, []).map((m) => m.name);

        assert.ok(!mounted.has('PromoCodesModule'));
        assert.ok(!exported.includes('PromoCodesModule'));
        assert.ok(!exported.includes('SetupModule'));
    });
});

// @requirement SC-SCOPE-007 — The platform is a NestJS application, and a foreign backend mounts it
describe('features are added as composers, not as edits to the assembler', () => {
    const ASSEMBLER = fileURLToPath(new URL('../src/platform/saasicat.module.ts', import.meta.url));

    test('the assembler imports no domain module of its own', () => {
        // The structural half. Mounting a feature from here again would work,
        // and would put the decision back where the export arm cannot see it.
        // `NestDiscoveryModule` is Nest's own and not a domain of ours.
        const source = readFileSync(ASSEMBLER, 'utf8');
        const domainModuleImports = [...source.matchAll(/^import .*from '\.\.\/(\w[\w-]*)\//gm)]
            .map((m) => m[0])
            .filter((line) => /\bimport \{[^}]*\b\w+Module\b/.test(line));

        assert.deepEqual(domainModuleImports, [], 'the assembler mounts a feature itself again');
    });

    test('there are composers to speak for', () => {
        assert.ok(FEATURE_COMPOSERS.length >= 10, `only ${FEATURE_COMPOSERS.length} composers`);
    });
});

describe('the assembled module is the same one as before', () => {
    test('a minimal configuration still produces a global DynamicModule', () => {
        const dyn = SaaSiCatModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [] },
            adapters: { mfa: PORT, audit: PORT, rlsBypass: PORT },
        });
        assert.equal(dyn.module.name, 'SaaSiCatModule');
        assert.equal(dyn.global, true);
        assert.ok(Array.isArray(dyn.imports));
        assert.ok(Array.isArray(dyn.exports));
    });
});

// @requirement SC-SCOPE-001 — SaaSiCat runs inside the integrator's application
describe('the base modules', () => {
    test('the DB-hydration path builds the catalogue from the sink', () => {
        // The branch a consumer takes once operators manage plans in the UI.
        // The identity cannot come from the database — branding, currency and
        // VAT are `dbCatalog`, and `catalog.identity-or-sink` refuses a
        // configuration without it.
        const dyn = SaaSiCatModule.forRoot({
            dbCatalog: { app: { name: 'TestApp' }, currency: 'EUR', vatRate: 19 },
            controller: { guards: [] },
            adapters: { mfa: PORT, audit: PORT, rlsBypass: PORT, planCatalogReadSink: REPO },
        });
        assert.ok(dyn.imports.some((m) => m?.module?.name === 'PlanCatalogModule'));
    });

    // The identity the DiscoveryModule was actually handed. Both tests below
    // used to assert only that the module was mounted, which is true of every
    // configuration — including the one that mounts it with an empty name.
    const identityOf = (dyn) =>
        dyn.imports
            .find((m) => m?.module?.name === 'DiscoveryModule')
            ?.providers?.find((p) => p.provide === DISCOVERY_APP_INFO_TOKEN)?.useValue;

    test('the app identity comes from the catalogue that is configured', () => {
        // `app.name` is the one place an installation names itself, and both
        // catalogue paths require it — so there is nothing left to fall back to.
        const fromYaml = SaaSiCatModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            controller: { guards: [] },
            adapters: { mfa: PORT, audit: PORT, rlsBypass: PORT },
        });
        assert.deepEqual(identityOf(fromYaml), { key: 'TestApp', version: '0.0.1' });

        const fromDb = SaaSiCatModule.forRoot({
            dbCatalog: { app: { name: 'FromDb' }, currency: 'EUR', vatRate: 19 },
            controller: { guards: [] },
            adapters: { mfa: PORT, audit: PORT, rlsBypass: PORT, planCatalogReadSink: REPO },
        });
        assert.deepEqual(identityOf(fromDb), { key: 'FromDb', version: '0.0.0' });
    });

    test('an explicit app identity wins over the catalogue', () => {
        const dyn = SaaSiCatModule.forRoot({
            planCatalog: MINIMAL_CATALOG,
            app: { key: 'explicit', version: '9.9.9' },
            controller: { guards: [] },
            adapters: { mfa: PORT, audit: PORT, rlsBypass: PORT },
        });
        assert.deepEqual(identityOf(dyn), { key: 'explicit', version: '9.9.9' });
    });
});

describe('the catalogue composer', () => {
    test('publicCatalog: false mounts the admin catalogue alone', () => {
        const ctx = everythingOn();
        ctx.options.catalog = { publicCatalog: false };
        const names = composeFeatures(ctx).map((m) => m.module.name);
        assert.ok(names.includes('CatalogModule'));
        assert.ok(!names.includes('PublicCatalogModule'));
    });

    test('and by default mounts both', () => {
        const names = composeFeatures(everythingOn()).map((m) => m.module.name);
        assert.ok(names.includes('PublicCatalogModule'));
    });
});

// @requirement SC-COMP-001 — All packages carry one version number and move together
describe('the seam is in the CJS build too', () => {
    // The package ships ESM and a separately built CommonJS bundle. What has to
    // hold is that the seam EXISTS there and names the same things.
    //
    // Deliberately not composing through it. `cjs-entry-identity.test.js`
    // already proves every export of `./platform` resolves to one object across
    // all twelve entries, and `dist-is-self-contained.test.js` that nothing is
    // missing from the build — so running twelve module factories a second time
    // would re-prove that, and it costs something real: it surfaces several
    // hundred branches nothing takes, which moves the coverage ratchet without
    // anything being better tested.
    //
    // Not class identity across ESM and CJS either. `CONTRIBUTING.md` says
    // plainly that the two outputs are separate files and an app reaching the
    // package through both sees two copies; a test asserting otherwise would be
    // claiming something the project documents as false. It was written that
    // way first, and failed.

    const cjs = createRequire(import.meta.url)('../dist/platform/index.cjs');

    test('the composers are there, in the same order', () => {
        assert.deepEqual(
            cjs.FEATURE_COMPOSERS.map((c) => c.name),
            FEATURE_COMPOSERS.map((c) => c.name),
        );
    });

    test('and so is the export table and its one exception', () => {
        assert.equal(typeof cjs.composeModuleExports, 'function');
        assert.deepEqual(cjs.MOUNTED_BUT_NOT_EXPORTED, MOUNTED_BUT_NOT_EXPORTED);
    });
});
