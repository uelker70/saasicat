import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import type {
    SubscriptionRecord,
    SubscriptionRepository,
    TransactionContext,
} from '@saasicat/core';
import {
    DRIZZLE_DB_TOKEN,
    resolveDb,
    toQuotaMap,
    toStringArray,
    type DrizzleClient,
} from './client.js';
import { planVersions, subscriptions } from './schema.js';

const ACTIVE_STATUSES = ['ACTIVE', 'TRIAL'];

type SubscriptionRow = typeof subscriptions.$inferSelect;

/**
 * `SubscriptionRepository` against the canonical `subscriptions` +
 * `plan_versions` tables. `countByBundleVersionId` is not implemented
 * (fail-closed).
 */
@Injectable()
export class DrizzleSubscriptionRepository implements SubscriptionRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async findByTenantId(tenantId: string): Promise<SubscriptionRecord | null> {
        return this.loadByTenantId(this.db, tenantId);
    }

    async findByTenantIdLocked(
        tenantId: string,
        tx: TransactionContext,
    ): Promise<SubscriptionRecord | null> {
        const db = resolveDb(this.db, tx);
        // Row lock first — serializes concurrent enforceLimit() transactions
        // on the same tenant for the rest of the transaction.
        await db
            .select({ id: subscriptions.id })
            .from(subscriptions)
            .where(eq(subscriptions.tenantId, tenantId))
            .for('update');
        return this.loadByTenantId(db, tenantId);
    }

    async countByPlanVersionId(planVersionId: string): Promise<number> {
        // Single query over both FK columns — two separate counts would race.
        const rows = await this.db
            .select({ id: subscriptions.id })
            .from(subscriptions)
            .where(
                or(
                    eq(subscriptions.planVersionId, planVersionId),
                    eq(subscriptions.pendingPlanVersionId, planVersionId),
                ),
            );
        return rows.length;
    }

    async countActiveByPlanKey(): Promise<Record<string, number>> {
        // Status alone answers the wrong question: a cancellation that has
        // taken effect leaves the column at ACTIVE, so the count would carry
        // every customer who ever left.
        const now = new Date();
        const rows = await this.db
            .select({ plan: subscriptions.plan })
            .from(subscriptions)
            .where(
                and(
                    inArray(subscriptions.status, ACTIVE_STATUSES),
                    or(
                        isNull(subscriptions.canceledAt),
                        gt(subscriptions.canceledEffectiveAt, now),
                        // The pre-split row keeps its effective date in the
                        // first column; reading only the second drops that
                        // customer on the day they declare rather than the day
                        // they leave.
                        and(
                            isNull(subscriptions.canceledEffectiveAt),
                            gt(subscriptions.canceledAt, now),
                        ),
                    ),
                ),
            );
        const counts: Record<string, number> = {};
        for (const row of rows) {
            counts[row.plan] = (counts[row.plan] ?? 0) + 1;
        }
        return counts;
    }

    private async loadByTenantId(
        db: DrizzleClient,
        tenantId: string,
    ): Promise<SubscriptionRecord | null> {
        const rows = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.tenantId, tenantId))
            .limit(1);
        const row = rows[0] as SubscriptionRow | undefined;
        if (!row) return null;
        return this.toRecord(db, row);
    }

    private async toRecord(db: DrizzleClient, row: SubscriptionRow): Promise<SubscriptionRecord> {
        const versionRows = await db
            .select()
            .from(planVersions)
            .where(eq(planVersions.id, row.planVersionId))
            .limit(1);
        const planVersion = versionRows[0] as typeof planVersions.$inferSelect | undefined;
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
            canceledAt: row.canceledAt ?? null,
            canceledEffectiveAt: row.canceledEffectiveAt ?? null,
            planVersionId: row.planVersionId,
            planVersion: {
                planId: planVersion.planId,
                quotas: toQuotaMap(planVersion.quotas),
                features: toStringArray(planVersion.features),
            },
        };
    }
}
