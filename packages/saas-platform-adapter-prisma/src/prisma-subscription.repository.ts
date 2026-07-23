import { Inject, Injectable } from '@nestjs/common';
import type {
    SubscriptionRecord,
    SubscriptionRepository,
    TransactionContext,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type PrismaLike,
    type PrismaTxLike,
    type SubscriptionRowLike,
} from './prisma-client-token.js';
import { resolveClient, toQuotaMap, toStringArray } from './tx.js';

const ACTIVE_STATUSES = ['ACTIVE', 'TRIAL'];

/**
 * `SubscriptionRepository` against the canonical `subscriptions` +
 * `plan_versions` tables.
 *
 * Limitation: subscriptions that bind ONLY a `businessTypeVersionId` (no
 * `planVersionId`) are not supported by this shipped adapter — the
 * BusinessType composition needs app-specific aggregation. Such rows raise a
 * descriptive error instead of returning wrong entitlements.
 *
 * `countByBundleVersionId` is deliberately not implemented (the
 * `subscription_bundles` junction is not part of this adapter's slice);
 * the platform then treats affected bundle versions as frozen (fail-closed).
 */
@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async findByTenantId(tenantId: string): Promise<SubscriptionRecord | null> {
        return this.loadByTenantId(this.prisma, tenantId);
    }

    async findByTenantIdLocked(
        tenantId: string,
        tx: TransactionContext,
    ): Promise<SubscriptionRecord | null> {
        const db = resolveClient(this.prisma, tx);
        // Row lock first — serializes concurrent enforceLimit() transactions
        // on the same tenant for the rest of the transaction.
        await db.$queryRaw`SELECT id FROM subscriptions WHERE "tenantId" = ${tenantId} FOR UPDATE`;
        return this.loadByTenantId(db, tenantId);
    }

    async countByPlanVersionId(planVersionId: string): Promise<number> {
        // Single COUNT over both FK columns — two separate queries would race.
        return this.prisma.subscription.count({
            where: { OR: [{ planVersionId }, { pendingPlanVersionId: planVersionId }] },
        });
    }

    async countActiveByPlanKey(_projectKey: string): Promise<Record<string, number>> {
        const rows = await this.prisma.subscription.findMany({
            where: { status: { in: ACTIVE_STATUSES } },
        });
        const counts: Record<string, number> = {};
        for (const row of rows) {
            counts[row.plan] = (counts[row.plan] ?? 0) + 1;
        }
        return counts;
    }

    private async loadByTenantId(
        db: PrismaTxLike,
        tenantId: string,
    ): Promise<SubscriptionRecord | null> {
        const row = await db.subscription.findUnique({ where: { tenantId } });
        if (!row) return null;
        return this.toRecord(db, row);
    }

    private async toRecord(
        db: PrismaTxLike,
        row: SubscriptionRowLike,
    ): Promise<SubscriptionRecord> {
        if (!row.planVersionId) {
            throw new Error(
                `Subscription ${row.id} binds no planVersionId (businessType-only composition). ` +
                    'The shipped @saasicat/adapter-prisma SubscriptionRepository does not support ' +
                    'BusinessType aggregation — provide a custom SubscriptionRepository adapter.',
            );
        }
        const planVersion = await db.planVersion.findUnique({ where: { id: row.planVersionId } });
        if (!planVersion) {
            throw new Error(
                `Subscription ${row.id} references missing PlanVersion ${row.planVersionId}.`,
            );
        }
        return {
            id: row.id,
            tenantId: row.tenantId,
            plan: row.plan,
            status: row.status,
            isPilot: row.isPilot,
            trialEntitlementPlan: row.trialEntitlementPlan,
            pendingPlan: row.pendingPlan,
            pendingEffectiveAt: row.pendingEffectiveAt,
            customLimits: (row.customLimits ?? null) as SubscriptionRecord['customLimits'],
            planVersionId: row.planVersionId,
            planVersion: {
                planId: planVersion.planId,
                quotas: toQuotaMap(planVersion.quotas),
                features: toStringArray(planVersion.features),
            },
        };
    }
}
