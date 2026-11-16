// The installation a test's process runs in, for a test that has to wire one:
// every installation that keeps the ends of subscriptions names the identifier
// of its environment, and refuses to start without it (`SC-PRIV-021`) — and
// the application's stores a tenant is erased from on its deletion day, with
// what a tenant keeps itself (`SC-PRIV-022`).

import {
    FakeInstallationMarkRepository,
    FakeTenantDeletionRepository,
    FakeTransactionRunner,
} from '../../dist/testing/index.js';

/** The identifier the environment of a test's process names. */
export const THIS_INSTALLATION = 'probe';

/** One store that holds nothing for any tenant, and erases nothing. */
export function anEraser(name = 'data') {
    return { name, count: async () => [], erase: async () => {} };
}

/** A report of what a tenant keeps itself, for a tenant that keeps nothing. */
export function aKeepReport() {
    return { keep: async () => [] };
}

/** `subscriptionEnds.deletion` as an application passes it to `SaaSiCatModule`. */
export function aDeletion() {
    return { installation: THIS_INSTALLATION, erasers: [anEraser()], keep: aKeepReport() };
}

/**
 * `subscriptionEnds.deletion` as `TenantBillingModule` wired by hand takes it:
 * with the stores the bundle would otherwise supply, and `subscribers`, which
 * the test names, the subscribers a deletion is recorded with.
 */
export function aHandWiredDeletion(subscribers = { findByTenantId: async () => null }) {
    return {
        ...aDeletion(),
        marks: new FakeInstallationMarkRepository(),
        records: new FakeTenantDeletionRepository(),
        subscribers,
        transactionRunner: new FakeTransactionRunner(),
    };
}
