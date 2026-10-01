import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
    CatalogEntryI18n,
    DiscoveryStatus,
    FeatureCatalogEntryRow,
    PlanCatalogReadSink,
    PlanCatalogReadSnapshot,
} from '@saasicat/core';
import { buildActivePlanVersionWhere, toPlanRow, toPlanVersionRow } from '@saasicat/core';
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
    type PrismaSchemaOptions,
} from './prisma-plan-binding.js';

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
 * `feature_catalog_entries` tables — the plan catalogue as it stands at the
 * moment asked for, read each time an operation needs it. A schema can point
 * this sink at a catalogue-specific plan-version delegate.
 */
@Injectable()
export class PrismaPlanCatalogReadSink implements PlanCatalogReadSink {
    private readonly binding: PrismaPlanBindingResolver;
    private readonly delegateName: string;

    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PlanCatalogReadClient,
        @Optional()
        @Inject(PRISMA_SCHEMA_OPTIONS_TOKEN)
        options?: PrismaSchemaOptions,
    ) {
        const schema = resolvePrismaSchemaOptions(options);
        this.binding = createPrismaPlanBindingResolver(options?.planBinding);
        this.delegateName = schema.delegates.catalogPlanVersion;
    }

    private db(): PlanCatalogReadPrisma {
        return this.prisma as unknown as PlanCatalogReadPrisma;
    }

    async loadSnapshot(asOf: Date): Promise<PlanCatalogReadSnapshot> {
        const db = this.db();
        // `sortOrder` alone is not a total order — rows sharing a value come
        // back in whatever order Postgres picks, which differs between reads.
        // The snapshot feeds the admin-manifest hash, so an unstable order
        // makes two processes reading identical data disagree on the hash.
        const plans = await db.plan.findMany({
            where: { deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { planKey: 'asc' }],
        });
        const planKeysByStoredId = new Map(
            plans.map((plan) => [
                this.binding.mode === 'normalized-plan-id' ? plan.id : plan.planKey,
                plan.planKey,
            ]),
        );
        const storedPlanIds = [...planKeysByStoredId.keys()];
        // Every version on sale at `asOf`, in one read, in the order
        // `findActivePlanVersion` picks from: the first row of each plan is
        // the one a booking at that moment binds.
        const candidates =
            storedPlanIds.length === 0
                ? []
                : await this.planVersions().findMany({
                      where: {
                          planId: { in: storedPlanIds },
                          ...buildActivePlanVersionWhere(asOf, { withEndsAt: true }),
                      },
                      orderBy: [
                          { planId: 'asc' },
                          { validFrom: { sort: 'desc', nulls: 'last' } },
                          { version: 'desc' },
                      ],
                  });
        const onSale = new Map<string, PlanVersionRowLike>();
        for (const row of candidates) {
            if (!onSale.has(row.planId)) onSale.set(row.planId, row);
        }
        const featureEntries = await db.featureCatalogEntry.findMany({
            where: { deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { featureKey: 'asc' }],
        });
        return {
            plans: plans.map(toPlanRow),
            versionsOnSale: [...onSale.values()].map((row) => {
                const planKey = planKeysByStoredId.get(row.planId);
                if (!planKey) {
                    throw new Error(
                        `PlanVersion ${row.id} references a plan that does not exist: ` +
                            `'${row.planId}'.`,
                    );
                }
                return toPlanVersionRow(row, planKey);
            }),
            featureEntries: featureEntries.map(toFeatureCatalogEntryRow),
        };
    }

    private planVersions(): PrismaModelDelegateLike<PlanVersionRowLike> {
        return getPrismaDelegate(this.prisma, this.delegateName);
    }
}

function toFeatureCatalogEntryRow(row: FeatureCatalogEntryRowLike): FeatureCatalogEntryRow {
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
