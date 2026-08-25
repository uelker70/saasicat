import type { SubscriptionRepository } from '@saasicat/core';

import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import type { PlanResolverPort } from './plan-resolver.port.js';

const DEFAULT_ACTIVE_STATUSES = new Set(['ACTIVE', 'TRIAL']);

/**
 * Standard `tenantId → planId` resolver backed by the canonical subscription
 * repository. This removes the identical resolver class most applications
 * previously had to write themselves.
 *
 * It answers for the DEFAULT enforcement stack — `StaticFeatureGuard` and
 * `EnforceQuotaInterceptor` — which reaches its plan through here rather than
 * through `EntitlementService`. Two paths, one rule, and the rule has to be
 * written in both: an app that never registers tenant billing enforces
 * entitlements entirely through this one.
 */
export class SubscriptionPlanResolver implements PlanResolverPort {
    constructor(
        private readonly subscriptions: SubscriptionRepository,
        private readonly activeStatuses: ReadonlySet<string> = DEFAULT_ACTIVE_STATUSES,
        /** The plan a subscription falls back to once its cancellation lands. */
        private readonly canceledEntitlementPlan: string | null = null,
    ) {}

    async getPlanIdForTenant(tenantId: string): Promise<string | null> {
        const subscription = await this.subscriptions.findByTenantId(tenantId);
        if (!subscription) return null;
        // Before the status check, not after: nothing transitions that column
        // when a cancellation lands, so a subscription that ended last January
        // is still ACTIVE there and would resolve to the plan it no longer has.
        if (cancellationHasLanded(subscription, new Date())) {
            return this.canceledEntitlementPlan;
        }
        if (!this.activeStatuses.has(subscription.status)) return null;
        return subscription.plan;
    }
}
