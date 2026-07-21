// Self-service block policy for plan changes and bundle bookings.
//
// `asTarget`: plans that may not be selected via self-service
// (typically: ENTERPRISE — only activatable via a special contract).
// `asSource`: plans that may not be left via self-service
// (typically: an active ENTERPRISE special contract → plan change via sales).

export interface SelfServiceBlockedPlans {
    asTarget?: string[];
    asSource?: string[];
}

export const SELF_SERVICE_BLOCKED_PLANS_TOKEN = Symbol.for('saas-platform/SelfServiceBlockedPlans');

/**
 * Bundle counterpart (#37): `bundleKeys` lists bundles that are not
 * bookable via self-service (only via sales/special contract).
 * Applies in `SubscriptionBundlesService.addBundleToSubscription`
 * (enforcement, 422) and in the bundle preview (blocker indication).
 */
export interface SelfServiceBlockedBundles {
    bundleKeys?: string[];
}

// Symbol.for — the CJS bundle duplicates shared modules across entry points;
// only globally registered symbols stay identical cross-entry.
export const SELF_SERVICE_BLOCKED_BUNDLES_TOKEN = Symbol.for(
    'saas-platform/SelfServiceBlockedBundles',
);
