import { Inject, Injectable } from '@nestjs/common';
import { and, asc, inArray, isNotNull, isNull } from 'drizzle-orm';
import type {
    CatalogEntryI18n,
    DiscoveryStatus,
    FeatureCatalogEntryRow,
    PlanCatalogReadSink,
    PlanCatalogReadSnapshot,
} from '@saasicat/core';
import { toPlanRow, toPlanVersionRow } from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { featureCatalogEntries, plans, planVersions } from './schema.js';

// The catalogue projection answers neither question: it reads the published
// versions for the marketing catalogue, where a booking window and a
// termination date play no part.
const CATALOG_VERSION_FIELDS = { validityWindows: false, endsAt: false } as const;

/**
 * `PlanCatalogReadSink` against the canonical `plans`, `plan_versions` and
 * `feature_catalog_entries` tables — DB hydration of the plan catalog at
 * boot. `validFrom`/`validUntil` are reported as null: the canonical schema
 * does not persist booking windows yet (see docs/explanation/data-model.md, Known gaps).
 */
@Injectable()
export class DrizzlePlanCatalogReadSink implements PlanCatalogReadSink {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async loadSnapshot(): Promise<PlanCatalogReadSnapshot> {
        const planRows = await this.db
            .select()
            .from(plans)
            .where(isNull(plans.deletedAt))
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
            .where(isNull(featureCatalogEntries.deletedAt))
            .orderBy(asc(featureCatalogEntries.sortOrder));
        return {
            plans: (planRows as Array<typeof plans.$inferSelect>).map((row) => toPlanRow(row)),
            livePlanVersions: (liveVersionRows as Array<typeof planVersions.$inferSelect>).map(
                (row) => toPlanVersionRow(row, row.planId, CATALOG_VERSION_FIELDS),
            ),
            featureEntries: (featureRows as Array<typeof featureCatalogEntries.$inferSelect>).map(
                toFeatureCatalogEntryRow,
            ),
        };
    }
}

function toFeatureCatalogEntryRow(
    row: typeof featureCatalogEntries.$inferSelect,
): FeatureCatalogEntryRow {
    return {
        id: row.id,
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
