import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
    PlanCatalogImportSink,
    UpsertFeatureCatalogEntryInput,
    UpsertPlanInput,
    UpsertPlanVersionInput,
    UpsertResult,
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
    type PrismaSchemaOptions,
} from './prisma-plan-binding.js';

/** Root-client fields used directly; the PlanVersion delegate is configurable. */
interface PlanCatalogImportClient {
    plan: unknown;
    featureCatalogEntry: unknown;
}

/** Narrow view used for the two fixed catalog delegates. */
interface PlanCatalogImportPrisma {
    plan: PrismaModelDelegateLike<PlanRowLike>;
    featureCatalogEntry: PrismaModelDelegateLike<FeatureCatalogEntryRowLike>;
}

/**
 * `PlanCatalogImportSink` against the canonical catalog tables — the
 * one-shot `saas.yaml → DB` import at boot.
 *
 * Idempotency per the port contract: existing rows (identity match) are
 * skipped without error; only the created/skipped flags are reported. In
 * normalized mode the semantic `planKey` input is resolved to `Plan.id`.
 */
@Injectable()
export class PrismaPlanCatalogImportSink implements PlanCatalogImportSink {
    private readonly binding: PrismaPlanBindingResolver;
    private readonly delegateName: string;

    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PlanCatalogImportClient,
        @Optional()
        @Inject(PRISMA_SCHEMA_OPTIONS_TOKEN)
        options?: PrismaSchemaOptions,
    ) {
        const schema = resolvePrismaSchemaOptions(options);
        this.binding = createPrismaPlanBindingResolver(options?.planBinding);
        this.delegateName = schema.delegates.catalogPlanVersion;
    }

    private db(): PlanCatalogImportPrisma {
        return this.prisma as unknown as PlanCatalogImportPrisma;
    }

    async upsertPlan(input: UpsertPlanInput): Promise<UpsertResult> {
        if (
            this.binding.mode === 'normalized-plan-id' &&
            this.binding.projectKey !== input.projectKey
        ) {
            throw new Error(
                `Prisma plan binding is configured for project '${this.binding.projectKey}', ` +
                    `not '${input.projectKey}'.`,
            );
        }
        const db = this.db();
        const existing = await db.plan.findFirst({
            where: { projectKey: input.projectKey, planKey: input.planKey },
        });
        if (existing) return { created: false, skipReason: 'exists' };
        await db.plan.create({
            data: {
                projectKey: input.projectKey,
                planKey: input.planKey,
                label: input.label,
                description: input.description ?? null,
                sortOrder: input.sortOrder ?? 0,
            },
        });
        return { created: true };
    }

    async upsertPlanVersion(input: UpsertPlanVersionInput): Promise<UpsertResult> {
        const planVersion = this.planVersions();
        const storedPlanId = await this.binding.toStoragePlanId(this.prisma, input.planKey);
        const existing = await planVersion.findFirst({
            where: { planId: storedPlanId, version: input.version },
        });
        if (existing) return { created: false, skipReason: 'exists' };

        const now = new Date();
        if (input.publish) {
            // "At most one live version per plan" — supersede older live
            // versions before the new one goes live.
            await planVersion.updateMany({
                where: {
                    planId: storedPlanId,
                    publishedAt: { not: null },
                    supersededAt: null,
                    version: { lt: input.version },
                },
                data: { supersededAt: now },
            });
        }
        await planVersion.create({
            data: {
                planId: storedPlanId,
                version: input.version,
                features: input.features,
                quotas: input.quotas,
                monthlyNet: input.monthlyNet,
                yearlyNet: input.yearlyNet,
                marketed: input.marketed,
                publishedAt: input.publish ? now : null,
                changeNote: input.changeNote,
            },
        });
        return { created: true };
    }

    private planVersions(): PrismaModelDelegateLike<PlanVersionRowLike> {
        return getPrismaDelegate(this.prisma, this.delegateName);
    }

    async upsertFeatureCatalogEntry(input: UpsertFeatureCatalogEntryInput): Promise<UpsertResult> {
        const db = this.db();
        const existing = await db.featureCatalogEntry.findFirst({
            where: { projectKey: input.projectKey, featureKey: input.featureKey },
        });
        if (existing) return { created: false, skipReason: 'exists' };
        await db.featureCatalogEntry.create({
            data: {
                projectKey: input.projectKey,
                featureKey: input.featureKey,
                label: input.label ?? input.featureKey,
                icon: input.icon ?? null,
                tier: input.tier ?? null,
                plannedOnly: input.plannedOnly ?? false,
                core: input.core ?? false,
            },
        });
        return { created: true };
    }
}
