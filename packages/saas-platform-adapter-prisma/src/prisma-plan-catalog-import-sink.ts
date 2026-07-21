import { Inject, Injectable } from '@nestjs/common';
import type {
    PlanCatalogImportSink,
    UpsertFeatureCatalogEntryInput,
    UpsertPlanInput,
    UpsertPlanVersionInput,
    UpsertResult,
} from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaLike } from './prisma-client-token.js';

/**
 * `PlanCatalogImportSink` against the canonical catalog tables — the
 * one-shot `saas.yaml → DB` import at boot.
 *
 * Idempotency per the port contract: existing rows (identity match) are
 * skipped without error; only the created/skipped flags are reported.
 */
@Injectable()
export class PrismaPlanCatalogImportSink implements PlanCatalogImportSink {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async upsertPlan(input: UpsertPlanInput): Promise<UpsertResult> {
        const existing = await this.prisma.plan.findFirst({
            where: { projectKey: input.projectKey, planKey: input.planKey },
        });
        if (existing) return { created: false, skipReason: 'exists' };
        await this.prisma.plan.create({
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
        const existing = await this.prisma.planVersion.findFirst({
            where: { planId: input.planKey, version: input.version },
        });
        if (existing) return { created: false, skipReason: 'exists' };

        const now = new Date();
        if (input.publish) {
            // "At most one live version per plan" — supersede older live
            // versions before the new one goes live.
            await this.prisma.planVersion.updateMany({
                where: {
                    planId: input.planKey,
                    publishedAt: { not: null },
                    supersededAt: null,
                    version: { lt: input.version },
                },
                data: { supersededAt: now },
            });
        }
        await this.prisma.planVersion.create({
            data: {
                planId: input.planKey,
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

    async upsertFeatureCatalogEntry(input: UpsertFeatureCatalogEntryInput): Promise<UpsertResult> {
        const existing = await this.prisma.featureCatalogEntry.findFirst({
            where: { projectKey: input.projectKey, featureKey: input.featureKey },
        });
        if (existing) return { created: false, skipReason: 'exists' };
        await this.prisma.featureCatalogEntry.create({
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
