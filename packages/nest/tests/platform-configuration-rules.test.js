import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
    PLATFORM_RULES,
    SaaSiCatConfigurationError,
    SaasPlatformModule,
    assertConfiguration,
    findViolations,
} from '../dist/platform/index.js';

// What the rule table is for: an integrator learns everything that is wrong in
// one boot, not one problem per restart.
//
// The old shape was fifteen `if`/`throw` pairs. Five missing bindings cost five
// boots, five stack traces, and no way to know how many were left. Nothing was
// incorrect about it — it just answered a smaller question than the one being
// asked.

const MINIMAL_CATALOG = {
    projectKey: 'demo',
    currency: 'EUR',
    vatRate: 19,
    plans: [],
    features: [],
};

const CORE_ADAPTERS = {
    mfa: { getSecret: async () => null },
    audit: { record: async () => {} },
    rlsBypass: { run: async (fn) => fn() },
};

/** The error `fn` threw. `assert.throws` returns nothing, so it cannot be used. */
function thrownBy(fn) {
    try {
        fn();
    } catch (err) {
        return err;
    }
    assert.fail('expected a throw, got none');
}

/** A configuration that satisfies every rule, as the starting point to break. */
function sound() {
    return {
        options: { planCatalog: MINIMAL_CATALOG, controller: { guards: [] } },
        adapters: CORE_ADAPTERS,
    };
}

describe('the rule table', () => {
    test('a sound configuration violates nothing', () => {
        assert.deepEqual(findViolations(sound()), []);
    });

    test('every rule has a distinct id, a message and a docs link', () => {
        const ids = PLATFORM_RULES.map((r) => r.id);
        assert.deepEqual([...new Set(ids)], ids, 'duplicate rule id');
        for (const rule of PLATFORM_RULES) {
            assert.match(rule.id, /^[a-z-]+\.[a-z-]+$/, `${rule.id} is not <area>.<what>`);
            assert.match(rule.docs, /^https:\/\/.+#.+$/, `${rule.id} has no anchored docs link`);
        }
    });

    test('a rule that does not apply stays silent', () => {
        // "Not enabled" and "enabled and satisfied" must not look alike, or the
        // table would report every optional feature nobody switched on.
        const quiet = findViolations(sound());
        assert.equal(quiet.length, 0);
        const applicable = PLATFORM_RULES.filter((r) => r.when(sound()));
        assert.ok(applicable.length > 0, 'no rule applies at all — the probe is wrong');
        assert.ok(
            applicable.length < PLATFORM_RULES.length,
            'every rule applies to a minimal configuration — `when` is not narrowing anything',
        );
    });
});

describe('all of them at once', () => {
    test('four independent mistakes are reported together', () => {
        const violations = findViolations({
            options: {
                planCatalog: MINIMAL_CATALOG,
                controller: { guards: [] },
                // Each of these needs something the configuration does not have.
                catalog: {},
                adminResources: true,
                setup: true,
                subscriptionBundles: true,
            },
            adapters: CORE_ADAPTERS,
        });

        const ids = violations.map((v) => v.id).sort();
        assert.deepEqual(ids, [
            'admin-resources.requires-persistence',
            'catalog.requires-persistence',
            'entitlement.requires-adapters',
            'setup.requires-provisioning-port',
            'subscription-bundles.requires-repositories',
            'subscription-bundles.requires-tenant-billing',
        ]);
    });

    test('the error names every one of them, numbered, each with its link', () => {
        const broken = {
            options: { planCatalog: MINIMAL_CATALOG, controller: { guards: [] }, catalog: {} },
            adapters: {},
        };
        const error = thrownBy(() => assertConfiguration(broken));

        assert.ok(error instanceof SaaSiCatConfigurationError);
        assert.equal(error.violations.length, 2);
        assert.match(error.message, /2 configuration problems/);
        assert.match(error.message, /1\. \[core\.adapters-bound\]/);
        assert.match(error.message, /2\. \[catalog\.requires-persistence\]/);
        // Two links, one per violation — not one link for the set.
        assert.equal(error.message.match(/→ https:/g).length, 2);
    });

    test('one problem is still phrased as one', () => {
        const error = thrownBy(() =>
            assertConfiguration({
                options: { planCatalog: MINIMAL_CATALOG, controller: { guards: [] } },
                adapters: { audit: {}, rlsBypass: {} },
            }),
        );
        assert.match(error.message, /1 configuration problem:/);
        assert.match(error.message, /core adapters are missing: mfa/);
    });

    test('a message names which of a set is missing, not that some are', () => {
        const [violation] = findViolations({
            options: { planCatalog: MINIMAL_CATALOG, controller: { guards: [] } },
            adapters: { audit: {} },
        });
        assert.match(violation.message, /mfa, rlsBypass/);
    });
});

describe('the typed errors that predate the table', () => {
    test('a lone capability failure still raises PersistenceCapabilityError', () => {
        // `code` is machine-readable and published; the table must not turn it
        // into prose. See `PlatformRule.error`.
        const bundle = {
            core: { mfa: {}, audit: {}, rlsBypass: {}, transactionRunner: {} },
            entitlement: { subscriptionRepository: {}, planVersionRepository: {} },
            capabilities: { transactions: true, pessimisticLocking: false },
        };
        const error = thrownBy(() =>
            assertConfiguration({
                options: {
                    planCatalog: MINIMAL_CATALOG,
                    controller: { guards: [] },
                    persistence: bundle,
                    entitlement: {},
                },
                adapters: {
                    ...CORE_ADAPTERS,
                    subscriptionRepository: {},
                    planVersionRepository: {},
                    transactionRunner: {},
                },
            }),
        );
        assert.equal(error.code, 'PERSISTENCE_CAPABILITY_MISSING');
        assert.match(error.message, /pessimisticLocking/);
    });

    test('the same failure alongside another is reported as one of two', () => {
        // The carve-out is "sole violation", and this is the case it excludes:
        // before the table this configuration threw whichever check ran first,
        // so no consumer could have caught the capability error here either.
        const bundle = {
            core: { mfa: {}, audit: {}, rlsBypass: {}, transactionRunner: {} },
            entitlement: { subscriptionRepository: {}, planVersionRepository: {} },
            capabilities: { transactions: true, pessimisticLocking: false },
        };
        const error = thrownBy(() =>
            assertConfiguration({
                options: {
                    planCatalog: MINIMAL_CATALOG,
                    controller: { guards: [] },
                    persistence: bundle,
                    entitlement: {},
                    catalog: {},
                },
                adapters: {
                    ...CORE_ADAPTERS,
                    subscriptionRepository: {},
                    planVersionRepository: {},
                    transactionRunner: {},
                },
            }),
        );
        assert.ok(error instanceof SaaSiCatConfigurationError);
        assert.deepEqual(error.violations.map((v) => v.id).sort(), [
            'catalog.requires-persistence',
            'entitlement.requires-transactional-persistence',
        ]);
    });
});

describe('forRoot runs the table', () => {
    test('the same configuration fails through the module', () => {
        // The rules are only worth anything where they are actually consulted.
        const error = thrownBy(() =>
            SaasPlatformModule.forRoot({
                planCatalog: MINIMAL_CATALOG,
                controller: { guards: [] },
                adapters: CORE_ADAPTERS,
                catalog: {},
                adminResources: true,
            }),
        );
        assert.match(error.message, /2 configuration problems/);
    });

    test('tenantManifest without plan resolution fails before anything is assembled', () => {
        // It used to be checked at the very end of `forRoot`, after twelve
        // modules had been constructed. Same verdict, less work, and it is now
        // reported together with whatever else is wrong.
        const error = thrownBy(() =>
            SaasPlatformModule.forRoot({
                planCatalog: MINIMAL_CATALOG,
                controller: { guards: [] },
                adapters: CORE_ADAPTERS,
                tenantManifest: true,
            }),
        );
        assert.match(error.message, /tenant-manifest\.requires-plan-resolution/);
    });
});

describe('every rule can actually fail', () => {
    // A rule nothing can trigger is not a rule, and a table makes that easy to
    // acquire: `when` narrowed a little too far, and the entry sits there
    // looking like enforcement forever. So rather than fifteen hand-written
    // "make this one fail" cases — the same defect one level up — one
    // configuration turns every feature on and binds nothing, and the
    // expectation is derived: whatever `when` admits must also fail here.

    /** Everything enabled, nothing bound. */
    const EVERYTHING_ON = {
        options: {
            controller: { guards: [] },
            catalog: {},
            tenantBilling: {},
            subscriptionBundles: {},
            adminResources: true,
            promoCodes: {},
            setup: true,
            adminStats: {},
            subscriptionContract: true,
            tenantManifest: true,
            entitlement: {},
        },
        adapters: {},
    };

    /**
     * Probes, not per-rule expectations.
     *
     * One configuration cannot fail every rule, because some rules fail on an
     * option being ABSENT — `subscriptionBundles` without `tenantBilling` is
     * satisfied by the first probe precisely because it turns both on. So the
     * claim is "each rule fails in at least one of these", and what is derived
     * is which rule that turns out to be.
     */
    const PROBES = [
        EVERYTHING_ON,
        // Bundles without the billing they share auth and usage with.
        {
            options: { controller: { guards: [] }, subscriptionBundles: true },
            adapters: CORE_ADAPTERS,
        },
        // A bundle that says it cannot do what the entitlement stack needs.
        {
            options: {
                planCatalog: MINIMAL_CATALOG,
                controller: { guards: [] },
                entitlement: {},
                persistence: {
                    core: {},
                    entitlement: {},
                    capabilities: { transactions: false, pessimisticLocking: false },
                },
            },
            adapters: CORE_ADAPTERS,
        },
    ];

    test('every rule fails in at least one probe', () => {
        const reported = new Set(PROBES.flatMap((p) => findViolations(p).map((v) => v.id)));
        const unreachable = PLATFORM_RULES.map((r) => r.id).filter((id) => !reported.has(id));
        assert.deepEqual(
            unreachable,
            [],
            'a rule no configuration can trigger is enforcement in name only',
        );
    });

    /** A rule's message, whichever of the two forms it carries. */
    const messageOf = (rule, c) =>
        typeof rule.message === 'string' ? rule.message : rule.message(c);

    for (const rule of PLATFORM_RULES) {
        test(`${rule.id} renders a message a reader can act on`, () => {
            const message = messageOf(rule, EVERYTHING_ON);
            assert.ok(message.length > 40, `${rule.id}: "${message}" says too little`);
            assert.doesNotMatch(
                message,
                /undefined|\[object Object\]/,
                `${rule.id} interpolated a value it did not have`,
            );
            // Ends in a full stop, so the boot error reads as sentences rather
            // than as fragments glued to a URL.
            assert.match(message.trim(), /\.$/, `${rule.id} does not end in a full stop`);
        });
    }

    test('the capability rule names both capabilities it is missing', () => {
        const [rule] = PLATFORM_RULES.filter(
            (r) => r.id === 'entitlement.requires-transactional-persistence',
        );
        assert.match(messageOf(rule, PROBES[2]), /transactions, pessimistic locking/);
    });
});

describe('the rules answer the same through CJS', () => {
    // The package ships ESM and CommonJS, and the CJS side is a separately
    // built bundle — the arrangement `cjs-entry-identity.test.js` exists to
    // keep honest. Everything above drives the ESM copy.
    //
    // The rules are pure functions over plain objects, so there is no class
    // identity to lose here; what there is to lose is a build that stops
    // including them, or a table that ends up differently ordered in one
    // output. Both would reach a consumer as "my app booted fine in dev".

    const requireCjs = createRequire(import.meta.url);
    const cjs = requireCjs('../dist/platform/index.cjs');

    const BROKEN = {
        options: {
            controller: { guards: [] },
            catalog: {},
            adminResources: true,
            setup: true,
            subscriptionBundles: true,
        },
        adapters: {},
    };

    test('the same table, in the same order', () => {
        assert.deepEqual(
            cjs.PLATFORM_RULES.map((r) => r.id),
            PLATFORM_RULES.map((r) => r.id),
        );
    });

    test('the same violations, with the same messages and links', () => {
        assert.deepEqual(cjs.findViolations(BROKEN), findViolations(BROKEN));
    });

    test('and the same error when it throws', () => {
        const viaCjs = thrownBy(() => cjs.assertConfiguration(BROKEN));
        const viaEsm = thrownBy(() => assertConfiguration(BROKEN));
        assert.equal(viaCjs.message, viaEsm.message);
        assert.equal(viaCjs.name, viaEsm.name);
    });
});
