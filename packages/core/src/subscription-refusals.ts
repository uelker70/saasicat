import { BILLING_ERROR_CODES } from './error-codes.js';
import type { PersistenceRefusal } from './errors.js';
import { refusal } from './refusal.js';

// What a subscription write finds when the subscription is no longer what its
// caller read. The platform reads first and answers these cases itself; an
// adapter meets them when a concurrent request changed the row in between.

/** The tenant has no subscription to write to. */
export function subscriptionGone(tenantId: string): PersistenceRefusal {
    return refusal(BILLING_ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 'gone', { tenantId });
}

/** The subscription moved between the caller's read and this write. */
export function subscriptionChanged(tenantId: string): PersistenceRefusal {
    return refusal(BILLING_ERROR_CODES.SUBSCRIPTION_CHANGED, 'moved', { tenantId });
}

/** The pending plan version to accept was cleared in the meantime. */
export function noPendingPlanVersion(tenantId: string): PersistenceRefusal {
    return refusal(BILLING_ERROR_CODES.NO_PENDING_PLAN_VERSION, 'moved', { tenantId });
}

/** The plan to bind has no version in effect at `asOf`. */
export function noActivePlanVersion(planId: string, asOf: Date): PersistenceRefusal {
    return refusal(BILLING_ERROR_CODES.NO_ACTIVE_PLAN_VERSION, 'gone', {
        planId,
        asOf: asOf.toISOString().slice(0, 10),
    });
}

/** The plan to bind is not in the catalogue, or was retired in the meantime. */
export function planNotInCatalog(planKey: string): PersistenceRefusal {
    return refusal(BILLING_ERROR_CODES.PLAN_NOT_IN_CATALOG, 'gone', { planKey });
}

/** The booking to cancel does not exist. */
export function subscriptionBundleGone(subscriptionBundleId: string): PersistenceRefusal {
    return refusal(BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_NOT_FOUND, 'gone', {
        subscriptionBundleId,
    });
}

/** The booking to cancel was cancelled first, by another request. */
export function subscriptionBundleAlreadyCancelled(
    subscriptionBundleId: string,
): PersistenceRefusal {
    return refusal(BILLING_ERROR_CODES.SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED, 'moved', {
        subscriptionBundleId,
    });
}
