// The configuration rules `SaaSiCatModule.forRoot` holds its options to,
// written as data rather than as fifteen `if`/`throw` pairs.
//
// Two things follow from the shape that did not follow from the code.
//
// An integrator gets ALL of them at once. As a sequence of throws, the first
// missing binding ends the boot; you fix it, boot again, and the next one ends
// it. Five missing adapters cost five boots and five readings of a stack
// trace. As a table they are one list, and the list is the shape of the work
// left to do.
//
// And each rule can say where it is documented. A message that ends in a link
// is the difference between "adminResources is enabled, but
// persistence.adminResources is missing" — true, and no help if you do not
// already know what a persistence bundle is — and a sentence with somewhere to
// go next.
//
// A rule is deliberately allowed to be silent: `when` decides whether it has
// anything to say about this configuration at all, so "not enabled" and
// "enabled and satisfied" never look alike.

import { assertPersistenceCapabilities, type SaaSiCatPersistenceAdapter } from '@saasicat/core';

import type { SaaSiCatAdapters, SaaSiCatModuleOptions } from '../module-options.js';
import { resolveBundleRepository } from '../compose/bundle-repository-source.js';

/** Everything a rule may look at: the options as given, the adapters as resolved. */
export interface PlatformConfiguration {
    readonly options: SaaSiCatModuleOptions;
    /** After the bundle slices and the explicit entries have been merged. */
    readonly adapters: SaaSiCatAdapters;
}

export interface PlatformRule {
    /** Stable id — `<area>.<what-it-requires>`. Appears in the boot error. */
    readonly id: string;
    /** Whether this rule has anything to say about this configuration. */
    readonly when: (c: PlatformConfiguration) => boolean;
    /** True when the configuration satisfies it. */
    readonly assert: (c: PlatformConfiguration) => boolean;
    /**
     * What is wrong and what to do about it.
     *
     * A function only where it has to be: several of these name which of a set
     * is missing, and "adapters are missing: subscriptionRepository,
     * transactionRunner" is worth more than "adapters are missing". The rest
     * are the same sentence every time, and a closure that ignores its argument
     * is one more thing a reader has to check for.
     */
    readonly message: string | ((c: PlatformConfiguration) => string);
    /**
     * Where the option is documented.
     *
     * Derived from the id rather than written beside it — see `docsUrlFor`.
     */
    readonly docs: string;
    /**
     * The typed error this rule threw before the table existed, when it has
     * one.
     *
     * Used only when this rule is the ONLY violation — and that is not a
     * compromise, it is the exact set of cases where the typed error was ever
     * observable. A configuration with two problems used to throw whichever
     * check ran first and stop, so nothing could catch the second one by type
     * either. Where a consumer could see `PersistenceCapabilityError`, it still
     * sees it; where it could not, it now gets the full list instead of one
     * arbitrary problem.
     */
    readonly error?: (c: PlatformConfiguration) => Error;
}

const DOCS_BASE = 'https://github.com/uelker70/saasicat/blob/main/docs/reference/options.md';

/**
 * GitHub's heading slug for `text`: lowercased, punctuation dropped, spaces
 * hyphenated.
 *
 * Written out because the anchor has to match a heading nobody types — the
 * page is generated. `tests/options-reference-is-generated.test.js` asserts
 * every rule's anchor is a heading in the file, so a wrong slug fails the build
 * rather than producing a link that lands at the top of the page.
 */
export const headingSlug = (text: string): string =>
    text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/ /g, '-');

/**
 * The documentation link for a rule.
 *
 * Derived from the id, so the two cannot disagree. They did, on the first
 * attempt: eleven hand-written anchors against headings the generator names
 * after the ids, and every one of them landed at the top of the page.
 */
export const docsUrlFor = (id: string): string => `${DOCS_BASE}#${headingSlug(id)}`;

/**
 * The option object of a `false | true | Options` slot, or `undefined`.
 *
 * Every feature slot on `SaaSiCatModuleOptions` spells "on" three ways —
 * absent, a boolean, or an object — and only the object carries settings. Four
 * rules had to unpack that, so it is unpacked once.
 */
function optionsOf<T extends object>(slot: false | true | T | undefined): T | undefined {
    return typeof slot === 'object' ? slot : undefined;
}

/** The persistence bundle, or `undefined` when the app binds ports one by one. */
const bundle = (c: PlatformConfiguration): SaaSiCatPersistenceAdapter | undefined =>
    c.options.persistence;

/**
 * Whether the full entitlement stack has to be wired.
 *
 * Not only `entitlement: true`: tenant billing and subscription bundles both
 * resolve entitlements, so enabling either one requires the same repositories.
 */
export const requiresFullEntitlement = (c: PlatformConfiguration): boolean =>
    Boolean(c.options.entitlement || c.options.tenantBilling || c.options.subscriptionBundles);

/** Whether anything can answer "which plan is this tenant on?". */
export const resolvesPlans = (c: PlatformConfiguration): boolean =>
    Boolean(
        c.adapters.planResolver ||
        c.options.defaultPlanId ||
        (c.options.tenantBilling && c.adapters.subscriptionRepository),
    );

/** Names the entries of `required` that are absent, in declaration order. */
function absent<T extends Record<string, unknown>>(required: T): string[] {
    return Object.keys(required).filter((key) => !required[key]);
}

const list = (names: string[]): string => names.join(', ');

/** The rules, without the field every one of them derives from its own id. */
type RuleSpec = Omit<PlatformRule, 'docs'>;

const RULE_SPECS: readonly RuleSpec[] = [
    {
        id: 'core.adapters-bound',
        when: () => true,
        assert: (c) => absent(coreAdapters(c)).length === 0,
        message: (c) =>
            `the core adapters are missing: ${list(absent(coreAdapters(c)))}. ` +
            'Bind them through `persistence: prismaPersistence({ client })` or one by one ' +
            'through `adapters`.',
    },
    {
        id: 'catalog.identity-or-sink',
        when: (c) => !c.options.planCatalog,
        assert: (c) => Boolean(c.adapters.planCatalogReadSink && c.options.dbCatalog),
        message:
            'no plan catalogue is reachable. Either set `planCatalog` (the quickstart YAML ' +
            'path) or, for DB hydration, BOTH a `planCatalogReadSink` (via `adapters` or ' +
            '`persistence`) AND `dbCatalog` ({ app, currency, vatRate }). Without the ' +
            'identity the app boots with a silently empty catalogue.',
    },
    {
        id: 'catalog.requires-persistence',
        when: (c) => Boolean(c.options.catalog),
        assert: (c) => Boolean(bundle(c)?.catalog),
        message:
            'catalog is enabled, but `persistence.catalog` is missing. Use a complete ' +
            'persistence bundle, or wire `CatalogModule` directly.',
    },
    {
        id: 'admin-resources.requires-persistence',
        when: (c) => {
            if (!c.options.adminResources) return false;
            // An app that passes its own `resources` implementation has said it
            // does not want the bundle's.
            return !optionsOf(c.options.adminResources)?.resources;
        },
        assert: (c) => Boolean(bundle(c)?.adminResources),
        message:
            'adminResources is enabled, but `persistence.adminResources` is missing. Use a ' +
            'complete persistence bundle, or pass your own `adminResources.resources`.',
    },
    {
        id: 'promo-codes.requires-persistence-and-transactions',
        when: (c) => Boolean(c.options.promoCodes),
        assert: (c) => Boolean(bundle(c)?.promo && c.adapters.transactionRunner),
        message: (c) =>
            'promoCodes requires `persistence.promo` and a transactionRunner; missing: ' +
            `${list(
                absent({
                    'persistence.promo': bundle(c)?.promo,
                    transactionRunner: c.adapters.transactionRunner,
                }),
            )}. Redeeming a code writes two rows and must not half-apply.`,
    },
    {
        id: 'setup.requires-provisioning-port',
        when: (c) => Boolean(c.options.setup),
        assert: (c) =>
            Boolean(
                optionsOf(c.options.setup)?.provisioningPort ??
                bundle(c)?.core.superAdminProvisioning,
            ),
        message:
            'setup is enabled, but no provisioningPort is available. Set ' +
            '`setup.provisioningPort` or use a bundle providing ' +
            '`persistence.core.superAdminProvisioning`.',
    },
    {
        id: 'admin-stats.requires-audit-stats-port',
        when: (c) => Boolean(c.options.adminStats),
        assert: (c) =>
            Boolean(optionsOf(c.options.adminStats)?.auditStatsPort ?? bundle(c)?.core.auditStats),
        message:
            'adminStats is enabled, but no auditStatsPort is available. Set ' +
            '`adminStats.auditStatsPort` or use a bundle providing ' +
            '`persistence.core.auditStats`.',
    },
    {
        id: 'subscription-contract.requires-repository',
        when: (c) => Boolean(c.options.subscriptionContract),
        assert: (c) =>
            Boolean(
                optionsOf(c.options.subscriptionContract)?.subscriptionContractRepository ??
                bundle(c)?.entitlement?.subscriptionContractRepository,
            ),
        message:
            'subscriptionContract is enabled, but no repository is available. Set ' +
            '`subscriptionContract.subscriptionContractRepository` or use a compatible ' +
            'persistence bundle.',
    },
    {
        id: 'promo-codes.public-preview-requires-first-time-check',
        when: (c) => {
            const config = optionsOf(c.options.promoCodes);
            // `true` and `undefined` do not reach here: the option object is
            // where a public controller is asked for, and where the check that
            // makes it useful would be passed.
            return config !== undefined && config.includePublicController !== false;
        },
        assert: (c) => Boolean(optionsOf(c.options.promoCodes)?.firstTimeCustomerCheck),
        message:
            'the public promo preview is mounted but has no `firstTimeCustomerCheck`, so every ' +
            'first-time-only code would preview as unavailable. Pass one, or set ' +
            '`promoCodes.includePublicController: false`.',
    },
    {
        id: 'tenant-billing.requires-ports',
        when: (c) => Boolean(c.options.tenantBilling) && !bundle(c)?.tenantBilling,
        assert: (c) => absent(tenantBillingPorts(c)).length === 0,
        message: (c) =>
            'tenantBilling is enabled without a `persistence.tenantBilling` slice, and these ' +
            `adapters are missing: ${list(absent(tenantBillingPorts(c)))}.`,
    },
    {
        id: 'subscription-bundles.requires-tenant-billing',
        when: (c) => Boolean(c.options.subscriptionBundles),
        assert: (c) => Boolean(c.options.tenantBilling),
        message:
            'subscriptionBundles requires tenantBilling, so the two share authentication and ' +
            'subscription usage rather than resolving them twice.',
    },
    {
        id: 'subscription-bundles.requires-repositories',
        when: (c) => Boolean(c.options.subscriptionBundles),
        assert: (c) => absent(bundleRepositories(c)).length === 0,
        message: (c) =>
            'subscriptionBundles is enabled, but these persistence adapters are missing: ' +
            `${list(absent(bundleRepositories(c)))}.`,
    },
    {
        id: 'entitlement.requires-adapters',
        when: requiresFullEntitlement,
        assert: (c) => absent(entitlementAdapters(c)).length === 0,
        message: (c) =>
            'entitlement active or required by the standard stack, but adapters are missing: ' +
            `${list(absent(entitlementAdapters(c)))}.`,
    },
    {
        id: 'entitlement.requires-transactional-persistence',
        when: (c) => requiresFullEntitlement(c) && Boolean(bundle(c)),
        assert: (c) => absent(entitlementCapabilities(c)).length === 0,
        message: (c) =>
            'the entitlement stack needs a store that can do ' +
            `${list(absent(entitlementCapabilities(c)))}, and the persistence bundle declares ` +
            'it cannot. `enforceLimit()` reads a counter and writes it back; without a ' +
            'transaction and a row lock two concurrent requests both pass the limit.',
        // `PersistenceCapabilityError` carries `code:
        // 'PERSISTENCE_CAPABILITY_MISSING'`, which is a machine-readable part
        // of the published contract rather than prose. Raising it through the
        // shared helper keeps the class, the code and the wording identical to
        // what a consumer catches today.
        error: (c) => {
            assertPersistenceCapabilities(
                bundle(c)!.capabilities,
                { transactions: true, pessimisticLocking: true },
                'SaaSiCatModule entitlement (transactional enforceLimit)',
            );
            // Unreachable: `assert` returned false, so the call above throws.
            throw new Error('persistence capabilities check did not fail as expected');
        },
    },
    {
        id: 'tenant-manifest.requires-plan-resolution',
        when: (c) => Boolean(c.options.tenantManifest),
        assert: resolvesPlans,
        message:
            'tenantManifest is enabled but nothing can resolve a tenant to a plan, so it could ' +
            'not filter features. Set `defaultPlanId`, `adapters.planResolver`, or enable ' +
            '`tenantBilling`.',
    },
];

export const PLATFORM_RULES: readonly PlatformRule[] = RULE_SPECS.map((spec) => ({
    ...spec,
    docs: docsUrlFor(spec.id),
}));

// The per-rule detail sets. Separate functions because each is read twice —
// once to decide whether the rule holds, once to name what is missing — and a
// rule whose message re-derives its own condition is a rule that can disagree
// with itself.

const coreAdapters = (c: PlatformConfiguration) => ({
    mfa: c.adapters.mfa,
    audit: c.adapters.audit,
    rlsBypass: c.adapters.rlsBypass,
});

const tenantBillingPorts = (c: PlatformConfiguration) => {
    const config = optionsOf(c.options.tenantBilling);
    return {
        subscriptionUsagePort: config?.subscriptionUsagePort,
        subscriptionWritePort: config?.subscriptionWritePort,
    };
};

const bundleRepositories = (c: PlatformConfiguration) => ({
    subscriptionBundleRepository: bundle(c)?.entitlement?.subscriptionBundleRepository,
    bundleRepository: resolveBundleRepository(bundle(c)),
});

const entitlementAdapters = (c: PlatformConfiguration) => ({
    subscriptionRepository: c.adapters.subscriptionRepository,
    planVersionRepository: c.adapters.planVersionRepository,
    transactionRunner: c.adapters.transactionRunner,
});

const entitlementCapabilities = (c: PlatformConfiguration) => ({
    transactions: bundle(c)?.capabilities.transactions,
    'pessimistic locking': bundle(c)?.capabilities.pessimisticLocking,
});
