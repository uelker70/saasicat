// The installation a test's process runs in, for a test that has to wire one:
// every installation that keeps the ends of subscriptions names the identifier
// of its environment, and refuses to start without it (`SC-PRIV-021`).

/** The identifier the environment of a test's process names. */
export const THIS_INSTALLATION = 'probe';

/** `subscriptionEnds.deletion` as an application passes it from its environment. */
export function aDeletion() {
    return { installation: THIS_INSTALLATION };
}
