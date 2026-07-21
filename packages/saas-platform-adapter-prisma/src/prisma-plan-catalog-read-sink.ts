import { Inject, Injectable } from '@nestjs/common';
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
import {
    PRISMA_CLIENT_TOKEN,
    type FeatureCatalogEntryRowLike,
    type PlanRowLike,
    type PlanVersionRowLike,
    type PrismaLike,
} from './prisma-client-token.js';
import { toQuotaMap, toStringArray } from './tx.js';

/**
 * `PlanCatalogReadSink` against the canonical `plans`, `plan_versions` and
 * `feature_catalog_entries` tables — DB hydration of the plan catalog at
 * boot (`PlanCatalogModule.forRoot({ sink })`).
 *
 * `validFrom`/`validUntil` are reported as null: the canonical schema does
 * not persist booking windows yet (see docs/data-model.md, "Known gaps").
 */
@Injectable()
export class PrismaPlanCatalogReadSink implements PlanCatalogReadSink {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async loadSnapshot(projectKey: string): Promise<PlanCatalogReadSnapshot> {
        const plans = await this.prisma.plan.findMany({
            where: { projectKey, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
        });
        const planKeys = plans.map((plan) => plan.planKey);
        const livePlanVersions =
            planKeys.length === 0
                ? []
                : await this.prisma.planVersion.findMany({
                      where: {
                          planId: { in: planKeys },
                          publishedAt: { not: null },
                          supersededAt: null,
                      },
                  });
        const featureEntries = await this.prisma.featureCatalogEntry.findMany({
            where: { projectKey, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
        });
        return {
            plans: plans.map(toPlanRow),
            livePlanVersions: livePlanVersions.map(toPlanVersionRow),
            featureEntries: featureEntries.map(toFeatureCatalogEntryRow),
        };
    }
}

function toPlanRow(row: PlanRowLike): PlanRow {
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

function toPlanVersionRow(row: PlanVersionRowLike): PlanVersionRow {
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

function toFeatureCatalogEntryRow(row: FeatureCatalogEntryRowLike): FeatureCatalogEntryRow {
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
        requires: row.requires,
        replaces: row.replaces,
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
