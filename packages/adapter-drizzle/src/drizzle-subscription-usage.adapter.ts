import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { SubscriptionUsagePort, SubscriptionUsageRecord } from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { planVersions, subscriptions } from './schema.js';

type PlanVersionTableRow = typeof planVersions.$inferSelect;

/**
 * What the tenant's own billing page reads: the subscription in display form,
 * with the plan version it is bound to and the one waiting to take over.
 *
 * Richer than `SubscriptionRecord`, which is the aggregation form entitlement
 * uses. This one carries the dates and the pending-change state a person is
 * shown before they decide anything, so every field is one somebody reads
 * rather than one the platform computes with.
 */
@Injectable()
export class DrizzleSubscriptionUsageAdapter implements SubscriptionUsagePort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async findForTenant(tenantId: string): Promise<SubscriptionUsageRecord | null> {
        const [subscription] = await this.db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.tenantId, tenantId))
            .limit(1);
        if (!subscription) return null;

        const [planVersion] = await this.db
            .select()
            .from(planVersions)
            .where(eq(planVersions.id, subscription.planVersionId))
            .limit(1);
        if (!planVersion) {
            // Not a missing-optional case: the column is NOT NULL and points at
            // the version whose features the tenant is being billed for. A page
            // rendered without it would quote a plan nobody is on.
            //
            // Unreachable against the canonical schema, where
            // `subscriptions_planVersionId_fkey` is RESTRICT and refuses to
            // orphan the row — which is what the integration test asserts,
            // rather than deleting the version to reach this line. It stays for
            // a consumer schema without that constraint, where the alternative
            // is a page quoting nothing.
            throw new Error(
                `Subscription ${subscription.id} references missing PlanVersion ` +
                    `${subscription.planVersionId}.`,
            );
        }

        const [pendingPlanVersion] = subscription.pendingPlanVersionId
            ? await this.db
                  .select()
                  .from(planVersions)
                  .where(eq(planVersions.id, subscription.pendingPlanVersionId))
                  .limit(1)
            : [];

        return {
            id: subscription.id,
            plan: planVersion.planId,
            billingCycle: subscription.billingCycle,
            status: subscription.status,
            isPilot: subscription.isPilot,
            pilotEndsAt: subscription.pilotEndsAt,
            trialEndsAt: subscription.trialEndsAt,
            startedAt: subscription.startedAt,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            minimumTermUntil: subscription.minimumTermUntil,
            canceledAt: subscription.canceledAt,
            canceledEffectiveAt: subscription.canceledEffectiveAt,
            billingAnchorDay: subscription.billingAnchorDay,
            pendingPlan: subscription.pendingPlan,
            pendingBillingCycle: subscription.pendingBillingCycle,
            pendingEffectiveAt: subscription.pendingEffectiveAt,
            planVersion: toUsagePlanVersion(planVersion),
            pendingPlanVersion: pendingPlanVersion
                ? {
                      ...toUsagePlanVersion(pendingPlanVersion),
                      // The two fields a tenant is shown before accepting: does
                      // the change take anything away, and what changed.
                      nonRegressive: pendingPlanVersion.nonRegressive,
                      publishedChanges: pendingPlanVersion.publishedChanges,
                  }
                : null,
            pendingPlanVersionEffectiveAt: subscription.pendingPlanVersionEffectiveAt,
            pendingPlanVersionAccepted: subscription.pendingPlanVersionAccepted,
            pendingPlanVersionAcceptedAt: subscription.pendingPlanVersionAcceptedAt,
            packageSnapshot: subscription.packageSnapshot,
            checkoutOfferId: subscription.checkoutOfferId,
        };
    }
}

function toUsagePlanVersion(row: PlanVersionTableRow): SubscriptionUsageRecord['planVersion'] {
    return {
        id: row.id,
        // The canonical schema stores the plan key here, which is what the
        // record's `planId` means too.
        planId: row.planId,
        version: row.version,
        publishedAt: row.publishedAt,
        supersededAt: row.supersededAt,
        changeNote: row.changeNote,
    };
}
