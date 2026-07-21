import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { PlanVersionRecord, PlanVersionRepository, TransactionContext } from '@saasicat/types';
import { DRIZZLE_DB_TOKEN, resolveDb, toQuotaMap, toStringArray, type DrizzleClient } from './client.js';
import { planVersions } from './schema.js';

/**
 * `PlanVersionRepository` against the canonical `plan_versions` table.
 * `findActive` is deliberately not implemented — the canonical schema has no
 * `validFrom`/`validUntil` columns yet (see docs/data-model.md, Known gaps).
 */
@Injectable()
export class DrizzlePlanVersionRepository implements PlanVersionRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async findLatestLive(
        planId: string,
        tx?: TransactionContext,
    ): Promise<PlanVersionRecord | null> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .select()
            .from(planVersions)
            .where(
                and(
                    eq(planVersions.planId, planId),
                    isNotNull(planVersions.publishedAt),
                    isNull(planVersions.supersededAt),
                ),
            )
            .orderBy(desc(planVersions.version))
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
