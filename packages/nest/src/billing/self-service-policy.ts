// Self-service block policy for plan changes and bundle bookings.
//
// `SelfServiceBlockedPlans` is defined by the catalogue, not here: it is a
// section of `config/saas.yaml` and the platform only reads it. Re-exported so
// the billing entry point stays the one import for everything a plan change
// needs.

export type { SelfServiceBlockedPlans } from '@saasicat/core';

export const SELF_SERVICE_BLOCKED_PLANS_TOKEN = Symbol.for('saasicat/nest/SelfServiceBlockedPlans');

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
    'saasicat/nest/SelfServiceBlockedBundles',
);
