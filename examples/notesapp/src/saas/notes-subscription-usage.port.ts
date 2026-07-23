import { Injectable } from '@nestjs/common';
import type { SubscriptionUsagePort, SubscriptionUsageRecord } from '@saasicat/types';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Display-form mapper for `GET /billing/usage`: loads the tenant's subscription
 * with its eager-loaded PlanVersion + pendingPlanVersion and maps it onto the
 * platform `SubscriptionUsageRecord`. `id` is set so the tenant bundle-store
 * controller can list/add SubscriptionBundles.
 *
 * A subscription that binds no PlanVersion (BusinessType-only composition) is
 * not displayable through this simple mapper — NotesApp only books plans, so
 * such a row is treated as "no subscription" (null).
 */
@Injectable()
export class NotesSubscriptionUsagePort implements SubscriptionUsagePort {
    constructor(private readonly prisma: PrismaService) {}

    async findForTenant(tenantId: string): Promise<SubscriptionUsageRecord | null> {
        const sub = await this.prisma.subscription.findUnique({
            where: { tenantId },
            include: { planVersion: true, pendingPlanVersion: true },
        });
        if (!sub || !sub.planVersion) return null;

        return {
            id: sub.id,
            plan: sub.plan,
            billingCycle: sub.billingCycle,
            status: sub.status,
            isPilot: sub.isPilot,
            pilotEndsAt: sub.pilotEndsAt,
            trialEndsAt: sub.trialEndsAt,
            startedAt: sub.startedAt,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            pendingPlan: sub.pendingPlan,
            pendingBillingCycle: sub.pendingBillingCycle,
            pendingEffectiveAt: sub.pendingEffectiveAt,
            planVersion: {
                id: sub.planVersion.id,
                planId: sub.planVersion.planId,
                version: sub.planVersion.version,
                publishedAt: sub.planVersion.publishedAt,
                supersededAt: sub.planVersion.supersededAt,
                changeNote: sub.planVersion.changeNote,
            },
            pendingPlanVersion: sub.pendingPlanVersion
                ? {
                      id: sub.pendingPlanVersion.id,
                      planId: sub.pendingPlanVersion.planId,
                      version: sub.pendingPlanVersion.version,
                      nonRegressive: sub.pendingPlanVersion.nonRegressive,
                      changeNote: sub.pendingPlanVersion.changeNote,
                      publishedChanges: sub.pendingPlanVersion.publishedChanges,
                  }
                : null,
            pendingPlanVersionEffectiveAt: sub.pendingPlanVersionEffectiveAt,
            pendingPlanVersionAccepted: sub.pendingPlanVersionAccepted,
            pendingPlanVersionAcceptedAt: sub.pendingPlanVersionAcceptedAt,
            packageSnapshot: sub.packageSnapshot ?? null,
            checkoutOfferId: sub.checkoutOfferId ?? null,
        };
    }
}
