import { Inject, Injectable } from '@nestjs/common';
import type { PlanVersionRecord, PlanVersionRepository, TransactionContext } from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaLike } from './prisma-client-token.js';
import { resolveClient, toQuotaMap, toStringArray } from './tx.js';

/**
 * `PlanVersionRepository` against the canonical `plan_versions` table.
 *
 * `findActive` is deliberately not implemented: the canonical schema carries
 * no `validFrom`/`validUntil` columns yet, so time-aware resolution is not
 * expressible — consumers fall back to `findLatestLive` (documented port
 * behavior).
 */
@Injectable()
export class PrismaPlanVersionRepository implements PlanVersionRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async findLatestLive(
        planId: string,
        tx?: TransactionContext,
    ): Promise<PlanVersionRecord | null> {
        const db = resolveClient(this.prisma, tx);
        const row = await db.planVersion.findFirst({
            where: { planId, publishedAt: { not: null }, supersededAt: null },
            orderBy: { version: 'desc' },
        });
        if (!row) return null;
        return {
            planId: row.planId,
            quotas: toQuotaMap(row.quotas),
            features: toStringArray(row.features),
        };
    }
}
