import { Injectable } from '@nestjs/common';
import type { PlanResolverPort } from '@saasicat/nest/platform';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves a tenant's active plan from its Subscription, so `@RequireFeature`
 * / `@EnforceQuota` enforce the plan the tenant actually holds instead of the
 * static `defaultPlanId`. Tenants without a subscription fall back to
 * `defaultPlanId` (the resolver returns null → the platform uses the default).
 *
 * This is what keeps the enforced entitlement in step with what
 * `GET /billing/entitlement` reports to the tenant web app.
 */
@Injectable()
export class NotesPlanResolver implements PlanResolverPort {
    constructor(private readonly prisma: PrismaService) {}

    async getPlanIdForTenant(tenantId: string): Promise<string | null> {
        const subscription = await this.prisma.subscription.findUnique({
            where: { tenantId },
            select: { plan: true, status: true },
        });
        if (!subscription) return null;
        // Suspended/canceled subscriptions lose their plan entitlement.
        if (subscription.status !== 'ACTIVE' && subscription.status !== 'TRIAL') return null;
        return subscription.plan;
    }
}
