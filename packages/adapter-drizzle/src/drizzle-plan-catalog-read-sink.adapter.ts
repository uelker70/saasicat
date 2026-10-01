import { Inject, Injectable } from '@nestjs/common';
import { and, asc, inArray, isNull } from 'drizzle-orm';
import type {
    CatalogEntryI18n,
    DiscoveryStatus,
    FeatureCatalogEntryRow,
    PlanCatalogReadSink,
    PlanCatalogReadSnapshot,
} from '@saasicat/core';
import { toPlanRow, toPlanVersionRow } from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { ON_SALE_ORDER, onSaleAt } from './plan-version-on-sale.js';
import { featureCatalogEntries, plans, planVersions } from './schema.js';

/**
 * `PlanCatalogReadSink` against the canonical `plans`, `plan_versions` and
 * `feature_catalog_entries` tables — the plan catalogue as it stands at the
 * moment asked for, read each time an operation needs it.
 */
@Injectable()
export class DrizzlePlanCatalogReadSink implements PlanCatalogReadSink {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async loadSnapshot(asOf: Date): Promise<PlanCatalogReadSnapshot> {
        const planRows = await this.db
            .select()
            .from(plans)
            .where(isNull(plans.deletedAt))
            .orderBy(asc(plans.sortOrder));
        const planKeys = planRows.map((plan) => plan.planKey);
        // Every version on sale at `asOf`, in one read, in the order
        // `findActivePlanVersion` picks from: the first row of each plan is
        // the one a booking at that moment binds.
        const candidates =
            planKeys.length === 0
                ? []
                : ((await this.db
                      .select()
                      .from(planVersions)
                      .where(and(inArray(planVersions.planId, planKeys), onSaleAt(asOf)))
                      .orderBy(asc(planVersions.planId), ...ON_SALE_ORDER)) as Array<
                      typeof planVersions.$inferSelect
                  >);
        const onSale = new Map<string, typeof planVersions.$inferSelect>();
        for (const row of candidates) {
            if (!onSale.has(row.planId)) onSale.set(row.planId, row);
        }
        const featureRows = await this.db
            .select()
            .from(featureCatalogEntries)
            .where(isNull(featureCatalogEntries.deletedAt))
            .orderBy(asc(featureCatalogEntries.sortOrder));
        return {
            plans: (planRows as Array<typeof plans.$inferSelect>).map((row) => toPlanRow(row)),
            versionsOnSale: [...onSale.values()].map((row) => toPlanVersionRow(row, row.planId)),
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
