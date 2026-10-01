import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PlanVersionRecord, PlanVersionRepository, TransactionContext } from '@saasicat/core';
import {
    DRIZZLE_DB_TOKEN,
    resolveDb,
    toQuotaMap,
    toStringArray,
    type DrizzleClient,
} from './client.js';
import { ON_SALE_ORDER, onSaleAt } from './plan-version-on-sale.js';
import { planVersions } from './schema.js';

/**
 * `PlanVersionRepository` against the canonical `plan_versions` table: the
 * version of a plan on sale at a moment, by the rule the plan repository and
 * the catalogue read use.
 */
@Injectable()
export class DrizzlePlanVersionRepository implements PlanVersionRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async findActive(
        planId: string,
        asOf: Date = new Date(),
        tx?: TransactionContext,
    ): Promise<PlanVersionRecord | null> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .select()
            .from(planVersions)
            .where(and(eq(planVersions.planId, planId), onSaleAt(asOf)))
            .orderBy(...ON_SALE_ORDER)
            .limit(1);
        const row = rows[0] as typeof planVersions.$inferSelect | undefined;
        if (!row) return null;
        return {
            planId: row.planId,
            quotas: toQuotaMap(row.quotas),
            features: toStringArray(row.features),
        };
    }
}
