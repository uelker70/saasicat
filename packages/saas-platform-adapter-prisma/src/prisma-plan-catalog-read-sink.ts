import { Inject, Injectable, Optional } from '@nestjs/common';
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
    type PrismaModelDelegateLike,
} from './prisma-client-token.js';
import {
    PRISMA_SCHEMA_OPTIONS_TOKEN,
    createPrismaPlanBindingResolver,
    getPrismaDelegate,
    resolvePrismaSchemaOptions,
    type PrismaPlanBindingResolver,
    type PrismaPlanVersionFieldCapabilities,
    type PrismaSchemaOptions,
} from './prisma-plan-binding.js';
import { toQuotaMap, toStringArray } from './tx.js';

/** Root-client fields used directly; the PlanVersion delegate is configurable. */
interface PlanCatalogReadClient {
    plan: unknown;
    featureCatalogEntry: unknown;
}

/** Narrow view used for the two fixed catalog delegates. */
interface PlanCatalogReadPrisma {
    plan: PrismaModelDelegateLike<PlanRowLike>;
    featureCatalogEntry: PrismaModelDelegateLike<FeatureCatalogEntryRowLike>;
}

/**
 * `PlanCatalogReadSink` against the canonical `plans`, `plan_versions` and
 * `feature_catalog_entries` tables — DB hydration of the plan catalog at
 * boot (`PlanCatalogModule.forRoot({ sink })`).
 *
 * The canonical 0.6 defaults report validity fields as null. Extended schemas
 * can opt into validity/termination fields and can point this sink at a
 * catalog-specific plan-version delegate.
 */
@Injectable()
export class PrismaPlanCatalogReadSink implements PlanCatalogReadSink {
    private readonly binding: PrismaPlanBindingResolver;
    private readonly delegateName: string;
    private readonly fields: Required<PrismaPlanVersionFieldCapabilities>;

    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PlanCatalogReadClient,
        @Optional()
        @Inject(PRISMA_SCHEMA_OPTIONS_TOKEN)
        options?: PrismaSchemaOptions,
    ) {
        const schema = resolvePrismaSchemaOptions(options);
        this.binding = createPrismaPlanBindingResolver(options?.planBinding);
        this.delegateName = schema.delegates.catalogPlanVersion;
        this.fields = schema.planVersionFields.catalog;
    }

    private db(): PlanCatalogReadPrisma {
        return this.prisma as unknown as PlanCatalogReadPrisma;
    }

    async loadSnapshot(projectKey: string): Promise<PlanCatalogReadSnapshot> {
        if (this.binding.mode === 'normalized-plan-id' && this.binding.projectKey !== projectKey) {
            throw new Error(
                `Prisma plan binding is configured for project '${this.binding.projectKey}', ` +
                    `not '${projectKey}'.`,
            );
        }
        const db = this.db();
        const plans = await db.plan.findMany({
            where: { projectKey, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
        });
        const planKeysByStoredId = new Map(
            plans.map((plan) => [
                this.binding.mode === 'normalized-plan-id' ? plan.id : plan.planKey,
                plan.planKey,
            ]),
        );
        const storedPlanIds = [...planKeysByStoredId.keys()];
        const livePlanVersions =
            storedPlanIds.length === 0
                ? []
                : await this.planVersions().findMany({
                      where: {
                          planId: { in: storedPlanIds },
                          publishedAt: { not: null },
                          supersededAt: null,
                      },
                  });
        const featureEntries = await db.featureCatalogEntry.findMany({
            where: { projectKey, deletedAt: null },
            orderBy: { sortOrder: 'asc' },
        });
        return {
            plans: plans.map(toPlanRow),
            livePlanVersions: livePlanVersions.map((row) => {
                const planKey = planKeysByStoredId.get(row.planId);
                if (!planKey) {
                    throw new Error(
                        `PlanVersion ${row.id} references plan '${row.planId}' outside project ` +
                            `'${projectKey}'.`,
                    );
                }
                return toPlanVersionRow(row, planKey, this.fields);
            }),
            featureEntries: featureEntries.map(toFeatureCatalogEntryRow),
        };
    }

    private planVersions(): PrismaModelDelegateLike<PlanVersionRowLike> {
        return getPrismaDelegate(this.prisma, this.delegateName);
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

function toPlanVersionRow(
    row: PlanVersionRowLike,
    planKey: string,
    fields: Required<PrismaPlanVersionFieldCapabilities>,
): PlanVersionRow {
    const mapped: PlanVersionRow = {
        id: row.id,
        planId: planKey,
        version: row.version,
        baseVersionId: row.baseVersionId,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
        publishedChanges: (row.publishedChanges as VersionChange[] | null) ?? null,
        changeNote: row.changeNote,
        nonRegressive: row.nonRegressive,
        validFrom: fields.validityWindows && row.validFrom ? row.validFrom.toISOString() : null,
        validUntil: fields.validityWindows && row.validUntil ? row.validUntil.toISOString() : null,
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
    if (fields.endsAt) {
        mapped.endsAt = row.endsAt?.toISOString() ?? null;
    }
    return mapped;
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
