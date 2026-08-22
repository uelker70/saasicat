import { Inject, Injectable, Optional } from '@nestjs/common';
import type { SubscriptionUsagePort, SubscriptionUsageRecord } from '@saasicat/types';
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

        const pendingPlanVersion = subscription.pendingPlanVersionId
            ? await this.planVersions().findUnique({
                  where: { id: subscription.pendingPlanVersionId },
              })
            : null;
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
            pendingPlan: subscription.pendingPlan,
            pendingBillingCycle: subscription.pendingBillingCycle ?? null,
            pendingEffectiveAt: subscription.pendingEffectiveAt,
            planVersion: planVersionRecord,
            pendingPlanVersion: pendingPlanVersion
                ? {
                      ...(await this.toPlanVersion(pendingPlanVersion)),
                      nonRegressive: pendingPlanVersion.nonRegressive,
                      publishedChanges: pendingPlanVersion.publishedChanges,
                  }
                : null,
            pendingPlanVersionEffectiveAt: subscription.pendingPlanVersionEffectiveAt ?? null,
            pendingPlanVersionAccepted: subscription.pendingPlanVersionAccepted ?? false,
            pendingPlanVersionAcceptedAt: subscription.pendingPlanVersionAcceptedAt ?? null,
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
