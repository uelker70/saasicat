import { Inject, Injectable } from '@nestjs/common';
import type {
    ImmediatePlanChangeInput,
    ScheduledPlanChangeInput,
    TenantSubscriptionWritePort,
    TransactionContext,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type PrismaLike,
    type PrismaModelDelegateLike,
} from './prisma-client-token.js';
import { resolveClient } from './tx.js';

/** DB columns this adapter reads back from `subscriptions`. */
interface SubscriptionDbRow {
    id: string;
    plan: string;
    billingCycle: string;
    status: string;
    canceledAt: Date | null;
    currentPeriodEnd: Date | null;
    pendingPlanVersionAccepted: boolean;
    pendingPlanVersionAcceptedAt: Date | null;
    pendingPlanVersionEffectiveAt: Date | null;
}

/** Narrow view of the injected client used by this adapter. */
interface SubscriptionWritePrisma {
    subscription: PrismaModelDelegateLike<SubscriptionDbRow>;
}

/**
 * `TenantSubscriptionWritePort` against the canonical `subscriptions` table.
 * Pure persistence: trial carry-over (#17) and contract freeze (#18) are
 * resolved in the platform `changePlan` path and handed down as plain values —
 * this adapter only writes what it receives.
 *
 * The optional `applyOnboardingSelection` is not implemented; the platform
 * service then falls back to sequential `changePlanImmediate` + promo redeem
 * (best-effort, port contract P10.1.1).
 */
@Injectable()
export class PrismaTenantSubscriptionWriteAdapter implements TenantSubscriptionWritePort {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    private db(tx?: TransactionContext): SubscriptionWritePrisma {
        return resolveClient(this.prisma, tx) as unknown as SubscriptionWritePrisma;
    }

    async changePlanImmediate(
        tenantId: string,
        input: ImmediatePlanChangeInput,
    ): Promise<{ plan: string; billingCycle: string }> {
        const updated = await this.db().subscription.update({
            where: { tenantId },
            data: {
                plan: input.planId,
                billingCycle: input.cycle,
                pendingPlan: null,
                pendingBillingCycle: null,
                pendingEffectiveAt: null,
                ...(input.nextStatus ? { status: input.nextStatus } : {}),
                ...(input.periodStart && input.periodEnd
                    ? { currentPeriodStart: input.periodStart, currentPeriodEnd: input.periodEnd }
                    : {}),
                // #17: the platform changePlan path computes the carried-over
                // trial end and passes it through; null/undefined leaves the
                // existing trialEndsAt untouched.
                ...(input.trialEndsAt ? { trialEndsAt: input.trialEndsAt } : {}),
            },
        });
        return { plan: updated.plan, billingCycle: updated.billingCycle };
    }

    async schedulePlanChange(tenantId: string, input: ScheduledPlanChangeInput): Promise<void> {
        await this.db().subscription.update({
            where: { tenantId },
            data: {
                pendingPlan: input.pendingPlan,
                pendingBillingCycle: input.pendingBillingCycle,
                pendingEffectiveAt: input.pendingEffectiveAt,
            },
        });
    }

    async acceptPendingPlanVersion(
        tenantId: string,
        userId: string,
        now: Date,
    ): Promise<{
        accepted: boolean;
        acceptedAt: Date | null;
        effectiveAt: Date | null;
        alreadyAccepted: boolean;
    }> {
        const sub = await this.db().subscription.findUnique({ where: { tenantId } });
        if (!sub) {
            throw new Error(`No subscription for tenant ${tenantId}.`);
        }
        if (sub.pendingPlanVersionAccepted) {
            return {
                accepted: true,
                acceptedAt: sub.pendingPlanVersionAcceptedAt,
                effectiveAt: sub.pendingPlanVersionEffectiveAt,
                alreadyAccepted: true,
            };
        }
        const updated = await this.db().subscription.update({
            where: { id: sub.id },
            data: {
                pendingPlanVersionAccepted: true,
                pendingPlanVersionAcceptedAt: now,
                pendingPlanVersionAcceptedByUserId: userId,
            },
        });
        return {
            accepted: true,
            acceptedAt: updated.pendingPlanVersionAcceptedAt,
            effectiveAt: updated.pendingPlanVersionEffectiveAt,
            alreadyAccepted: false,
        };
    }

    async cancelSubscription(
        tenantId: string,
        immediate: boolean,
        now: Date,
    ): Promise<{ canceledAt: Date | null; status: string }> {
        const sub = await this.db().subscription.findUnique({ where: { tenantId } });
        if (!sub) {
            throw new Error(`No subscription for tenant ${tenantId}.`);
        }
        const canceledAt = immediate ? now : (sub.currentPeriodEnd ?? now);
        const updated = await this.db().subscription.update({
            where: { tenantId },
            data: {
                canceledAt,
                status: immediate ? 'CANCELED' : sub.status,
            },
        });
        return { canceledAt: updated.canceledAt, status: updated.status };
    }
}
