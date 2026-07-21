import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type {
    CatalogEntryI18n,
    DiscoveryStatus,
    FeatureCatalogEntryRow,
    PlanCatalogReadSink,
    PlanCatalogReadSnapshot,
    PlanRow,
    PlanVersionRow,
    VersionChange,
} from '@saasicat/types';
import { DRIZZLE_DB_TOKEN, toQuotaMap, toStringArray, type DrizzleClient } from './client.js';
import { featureCatalogEntries, plans, planVersions } from './schema.js';

/**
 * `PlanCatalogReadSink` against the canonical `plans`, `plan_versions` and
 * `feature_catalog_entries` tables — DB hydration of the plan catalog at
 * boot. `validFrom`/`validUntil` are reported as null: the canonical schema
 * does not persist booking windows yet (see docs/data-model.md, Known gaps).
 */
@Injectable()
export class DrizzlePlanCatalogReadSink implements PlanCatalogReadSink {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async loadSnapshot(projectKey: string): Promise<PlanCatalogReadSnapshot> {
        const planRows = await this.db
            .select()
            .from(plans)
            .where(and(eq(plans.projectKey, projectKey), isNull(plans.deletedAt)))
            .orderBy(asc(plans.sortOrder));
        const planKeys = planRows.map((plan) => plan.planKey);
        const liveVersionRows =
            planKeys.length === 0
                ? []
                : await this.db
                      .select()
                      .from(planVersions)
                      .where(
                          and(
                              inArray(planVersions.planId, planKeys),
                              isNotNull(planVersions.publishedAt),
                              isNull(planVersions.supersededAt),
                          ),
                      );
        const featureRows = await this.db
            .select()
            .from(featureCatalogEntries)
            .where(
                and(
                    eq(featureCatalogEntries.projectKey, projectKey),
                    isNull(featureCatalogEntries.deletedAt),
                ),
            )
            .orderBy(asc(featureCatalogEntries.sortOrder));
        return {
            plans: (planRows as Array<typeof plans.$inferSelect>).map(toPlanRow),
            livePlanVersions: (liveVersionRows as Array<typeof planVersions.$inferSelect>).map(
                toPlanVersionRow,
            ),
            featureEntries: (
                featureRows as Array<typeof featureCatalogEntries.$inferSelect>
            ).map(toFeatureCatalogEntryRow),
        };
    }
}

function toPlanRow(row: typeof plans.$inferSelect): PlanRow {
    return {
        id: row.id,
        projectKey: row.projectKey,
        planKey: row.planKey,
        label: row.label,
        description: row.description,
        icon: row.icon,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
}

function toPlanVersionRow(row: typeof planVersions.$inferSelect): PlanVersionRow {
    return {
        id: row.id,
        planId: row.planId,
        version: row.version,
        baseVersionId: row.baseVersionId,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
        publishedChanges: (row.publishedChanges as VersionChange[] | null) ?? null,
        changeNote: row.changeNote,
        nonRegressive: row.nonRegressive,
        validFrom: null,
        validUntil: null,
        createdByUserId: row.createdByUserId,
        publishedByUserId: row.publishedByUserId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        features: toStringArray(row.features),
        quotas: toQuotaMap(row.quotas),
        monthlyNet: String(row.monthlyNet),
        yearlyNet: String(row.yearlyNet),
        marketed: row.marketed,
    };
}

function toFeatureCatalogEntryRow(
    row: typeof featureCatalogEntries.$inferSelect,
): FeatureCatalogEntryRow {
    return {
        id: row.id,
        projectKey: row.projectKey,
        featureKey: row.featureKey,
        label: row.label,
        description: row.description,
        marketingLabel: row.marketingLabel,
        marketingDescription: row.marketingDescription,
        icon: row.icon,
        tier: row.tier,
        discoveryStatus: row.discoveryStatus as DiscoveryStatus,
        requires: row.requires ?? [],
        replaces: row.replaces ?? [],
        successorKey: row.successorKey,
        approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
        approvedBy: row.approvedBy,
        approvedSignature: row.approvedSignature,
        plannedOnly: row.plannedOnly,
        core: row.core,
        i18n: (row.i18n ?? {}) as CatalogEntryI18n,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
}
