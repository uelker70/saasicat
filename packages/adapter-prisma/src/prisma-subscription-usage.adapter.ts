import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
    TenantSubscriptionUsage,
} from '@saasicat/core';
import {
    PRISMA_CLIENT_TOKEN,
    type PlanVersionRowLike,
    type PrismaModelDelegateLike,
    type SubscriptionRowLike,
} from './prisma-client-token.js';
import {
    PRISMA_SCHEMA_OPTIONS_TOKEN,
    createPrismaPlanBindingResolver,
    getPrismaDelegate,
    resolvePrismaSchemaOptions,
    type PrismaPlanBindingResolver,
    type PrismaSchemaOptions,
} from './prisma-plan-binding.js';

interface SubscriptionUsageClient {
    plan: unknown;
}

/**
 * Rich subscription read adapter for `GET /billing/usage`.
 *
 * It uses flat delegate reads instead of Prisma `include`, so it stays
 * structurally compatible with consumer-generated clients and with the
 * configurable subscription/PlanVersion delegate names.
 */
@Injectable()
export class PrismaSubscriptionUsageAdapter implements SubscriptionUsagePort {
    private readonly binding: PrismaPlanBindingResolver;
    private readonly planVersionDelegateName: string;
    private readonly subscriptionDelegateName: string;

    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: SubscriptionUsageClient,
        @Optional()
        @Inject(PRISMA_SCHEMA_OPTIONS_TOKEN)
        options?: PrismaSchemaOptions,
    ) {
        const schema = resolvePrismaSchemaOptions(options);
        this.binding = createPrismaPlanBindingResolver(options?.planBinding);
        this.planVersionDelegateName = schema.delegates.entitlementPlanVersion;
        this.subscriptionDelegateName = schema.tenantSubscription.delegate;
    }

    async findForTenant(tenantId: string): Promise<SubscriptionUsageRecord | null> {
        const subscription = await this.subscriptions().findUnique({ where: { tenantId } });
        if (!subscription) return null;

        const planVersion = await this.planVersions().findUnique({
            where: { id: subscription.planVersionId },
        });
        if (!planVersion) {
            throw new Error(
                `Subscription ${subscription.id} references missing PlanVersion ${subscription.planVersionId}.`,
            );
        }

        return this.toRecord(subscription, planVersion);
    }

    /**
     * Two reads whatever the number of subscriptions: the plan's earlier
     * versions, and the subscriptions bound to them.
     */
    async listBoundToEarlierVersions(
        planKey: string,
        version: number,
    ): Promise<TenantSubscriptionUsage[]> {
        const storedPlanId = await this.binding.findStoragePlanId(this.prisma, planKey);
        if (storedPlanId === null) return [];
        const earlier = await this.planVersions().findMany({
            where: { planId: storedPlanId, version: { lt: version } },
        });
        if (earlier.length === 0) return [];
        const bound = new Map(earlier.map((row) => [row.id, row]));
        const subscriptions = await this.subscriptions().findMany({
            where: { planVersionId: { in: [...bound.keys()] } },
            orderBy: { id: 'asc' },
        });
        return Promise.all(
            subscriptions.map(async (subscription) => ({
                tenantId: subscription.tenantId,
                subscription: await this.toRecord(
                    subscription,
                    bound.get(subscription.planVersionId)!,
                ),
            })),
        );
    }

    private async toRecord(
        subscription: SubscriptionRowLike,
        planVersion: PlanVersionRowLike,
    ): Promise<SubscriptionUsageRecord & { id: string }> {
        const planVersionRecord = await this.toPlanVersion(planVersion);

        return {
            id: subscription.id,
            // The concrete PlanVersion is authoritative and also normalizes
            // UUID-backed plan bindings to their public plan key.
            plan: planVersionRecord.planId,
            billingCycle: subscription.billingCycle,
            status: subscription.status,
            isPilot: subscription.isPilot,
            pilotEndsAt: subscription.pilotEndsAt ?? null,
            trialEndsAt: subscription.trialEndsAt ?? null,
            startedAt: subscription.startedAt,
            currentPeriodStart: subscription.currentPeriodStart ?? null,
            currentPeriodEnd: subscription.currentPeriodEnd ?? null,
            // Without these three the cancellation rules read a term that is
            // always null and the tenant page shows a cancelled subscription as
            // running: the fields exist on the record, the shipped adapter did
            // not map them, and every consumer using it got the defaults.
            minimumTermUntil: subscription.minimumTermUntil ?? null,
            canceledAt: subscription.canceledAt ?? null,
            canceledEffectiveAt: subscription.canceledEffectiveAt ?? null,
            billingAnchorDay: subscription.billingAnchorDay ?? null,
            pendingPlan: subscription.pendingPlan,
            pendingBillingCycle: subscription.pendingBillingCycle ?? null,
            pendingEffectiveAt: subscription.pendingEffectiveAt,
            planVersion: planVersionRecord,
            packageSnapshot: subscription.packageSnapshot ?? null,
            checkoutOfferId: subscription.checkoutOfferId ?? null,
        };
    }

    private async toPlanVersion(
        row: PlanVersionRowLike,
    ): Promise<SubscriptionUsageRecord['planVersion']> {
        return {
            id: row.id,
            planId: await this.binding.toPlanKey(this.prisma, row.planId),
            version: row.version,
            publishedAt: row.publishedAt,
            supersededAt: row.supersededAt,
            changeNote: row.changeNote,
        };
    }

    private subscriptions(): PrismaModelDelegateLike<SubscriptionRowLike> {
        return getPrismaDelegate(this.prisma, this.subscriptionDelegateName);
    }

    private planVersions(): PrismaModelDelegateLike<PlanVersionRowLike> {
        return getPrismaDelegate(this.prisma, this.planVersionDelegateName);
    }
}
