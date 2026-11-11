// The tenant's billing routes as `TenantBillingModule` composes them, over the
// ports a test names: the controller, and the cancellation service it projects
// and declares cancellations through, built from the same ports.

import {
    SubscriptionCancellationService,
    TenantBillingController,
} from '../../dist/billing/index.js';

/**
 * The cancellation service over `ports`, each named as the module provides it.
 * A port left out is absent, as where the application wires none;
 * `noticeDays` left out is no notice period.
 */
export function cancellationsOver(ports) {
    return new SubscriptionCancellationService(
        ports.subscriptionUsage,
        ports.subscriptionWrite,
        ports.entitlements,
        ports.noticeDays,
        ports.contractFreeze,
        ports.auditService,
        ports.retirements,
        ports.contracts,
        ports.settings,
        ports.subscriptionEnds,
    );
}

/**
 * The controller over `ports`, as `cancellationsOver` reads them, and over
 * `ports.cancellations` where a test holds the service it projects and
 * declares through.
 */
export function tenantBillingRoutes(ports) {
    const cancellations = ports.cancellations ?? cancellationsOver(ports);
    return new TenantBillingController(
        ports.entitlements,
        ports.planPreview,
        ports.subscriptionUsage,
        ports.usageSnapshot,
        ports.subscriptionWrite,
        ports.tenantIdResolver,
        ports.userIdResolver,
        ports.blockedPlans,
        ports.promoCodes,
        ports.auditService,
        ports.userEmailResolver,
        ports.auditContextResolver,
        ports.subscriptionBundles,
        ports.contractFreeze,
        ports.trialProjection,
        ports.charges,
        ports.versionOffers,
        ports.versionSwitches,
        ports.retirementSwitches,
        ports.settings,
        cancellations,
    );
}
