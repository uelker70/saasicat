// The tenant's billing routes as `TenantBillingModule` composes them, over the
// ports a test names: the controller, and the cancellation service it projects
// and declares cancellations through, built from the same ports.

import {
    SubscriptionCancellationService,
    TenantBillingController,
} from '../../dist/billing/index.js';

/**
 * The controller over `ports`, each named as the module provides it. A port
 * left out is absent, as where the application wires none; `noticeDays` left
 * out is no notice period.
 */
export function tenantBillingRoutes(ports) {
    const cancellations = new SubscriptionCancellationService(
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
