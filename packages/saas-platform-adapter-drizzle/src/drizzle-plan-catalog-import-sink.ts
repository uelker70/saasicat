import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import type {
    PlanCatalogImportSink,
    UpsertFeatureCatalogEntryInput,
    UpsertPlanInput,
    UpsertPlanVersionInput,
    UpsertResult,
} from '@saasicat/types';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { featureCatalogEntries, plans, planVersions } from './schema.js';

/**
 * `PlanCatalogImportSink` against the canonical catalog tables — the
 * one-shot `saas.yaml → DB` import at boot. Idempotency per the port
 * contract: existing rows (identity match) are skipped without error.
 */
@Injectable()
export class DrizzlePlanCatalogImportSink implements PlanCatalogImportSink {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async upsertPlan(input: UpsertPlanInput): Promise<UpsertResult> {
        const existing = await this.db
            .select({ id: plans.id })
            .from(plans)
            .where(and(eq(plans.projectKey, input.projectKey), eq(plans.planKey, input.planKey)))
            .limit(1);
        if (existing[0]) return { created: false, skipReason: 'exists' };
        await this.db.insert(plans).values({
            id: randomUUID(),
            projectKey: input.projectKey,
            planKey: input.planKey,
            label: input.label,
            description: input.description ?? null,
            sortOrder: input.sortOrder ?? 0,
            updatedAt: new Date(),
        });
        return { created: true };
    }

    async upsertPlanVersion(input: UpsertPlanVersionInput): Promise<UpsertResult> {
        const existing = await this.db
            .select({ id: planVersions.id })
            .from(planVersions)
            .where(
                and(eq(planVersions.planId, input.planKey), eq(planVersions.version, input.version)),
            )
            .limit(1);
        if (existing[0]) return { created: false, skipReason: 'exists' };

        const now = new Date();
        if (input.publish) {
            // "At most one live version per plan" — supersede older live
            // versions before the new one goes live.
            await this.db
                .update(planVersions)
                .set({ supersededAt: now, updatedAt: now })
                .where(
                    and(
                        eq(planVersions.planId, input.planKey),
                        isNotNull(planVersions.publishedAt),
                        isNull(planVersions.supersededAt),
                        lt(planVersions.version, input.version),
                    ),
                );
        }
        await this.db.insert(planVersions).values({
            id: randomUUID(),
            planId: input.planKey,
            version: input.version,
            features: input.features,
            quotas: input.quotas,
            monthlyNet: input.monthlyNet,
            yearlyNet: input.yearlyNet,
            marketed: input.marketed,
            publishedAt: input.publish ? now : null,
            changeNote: input.changeNote,
            updatedAt: now,
        });
        return { created: true };
    }

    async upsertFeatureCatalogEntry(input: UpsertFeatureCatalogEntryInput): Promise<UpsertResult> {
        const existing = await this.db
            .select({ id: featureCatalogEntries.id })
            .from(featureCatalogEntries)
            .where(
                and(
                    eq(featureCatalogEntries.projectKey, input.projectKey),
                    eq(featureCatalogEntries.featureKey, input.featureKey),
                ),
            )
            .limit(1);
        if (existing[0]) return { created: false, skipReason: 'exists' };
        await this.db.insert(featureCatalogEntries).values({
            id: randomUUID(),
            projectKey: input.projectKey,
            featureKey: input.featureKey,
            label: input.label ?? input.featureKey,
            icon: input.icon ?? null,
            tier: input.tier ?? null,
            plannedOnly: input.plannedOnly ?? false,
            core: input.core ?? false,
            updatedAt: new Date(),
        });
        return { created: true };
    }
}
