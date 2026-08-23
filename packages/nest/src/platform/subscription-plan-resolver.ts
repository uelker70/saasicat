import type { SubscriptionRepository } from '@saasicat/core';
import type { PlanResolverPort } from './plan-resolver.port.js';

const DEFAULT_ACTIVE_STATUSES = new Set(['ACTIVE', 'TRIAL']);

/**
 * Standard `tenantId → planId` resolver backed by the canonical subscription
 * repository. This removes the identical resolver class most applications
 * previously had to write themselves.
 */
export class SubscriptionPlanResolver implements PlanResolverPort {
    constructor(
        private readonly subscriptions: SubscriptionRepository,
        private readonly activeStatuses: ReadonlySet<string> = DEFAULT_ACTIVE_STATUSES,
    ) {}

    async getPlanIdForTenant(tenantId: string): Promise<string | null> {
        const subscription = await this.subscriptions.findByTenantId(tenantId);
        if (!subscription || !this.activeStatuses.has(subscription.status)) return null;
        return subscription.plan;
    }
}
