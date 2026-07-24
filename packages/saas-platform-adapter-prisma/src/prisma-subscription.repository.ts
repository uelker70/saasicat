import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
    SubscriptionRecord,
    SubscriptionRepository,
    TransactionContext,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type PlanRowLike,
    type PlanVersionRowLike,
    type PrismaModelDelegateLike,
    type SubscriptionRowLike,
} from './prisma-client-token.js';
import {
    PRISMA_SCHEMA_OPTIONS_TOKEN,
    createPrismaPlanBindingResolver,
    getPrismaDelegate,
    resolvePrismaSchemaOptions,
    type PrismaPlanBindingResolver,
    type PrismaSchemaOptions,
} from './prisma-plan-binding.js';
import { toQuotaMap, toStringArray } from './tx.js';

const ACTIVE_STATUSES = ['ACTIVE', 'TRIAL'];

interface SubscriptionBundleDbRow {
    bundleVersionId: string;
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
}

/** Root-client fields used directly; subscription and PlanVersion delegates are configurable. */
interface SubscriptionRepositoryClient {
    /** Used by normalized semantic-key ↔ UUID binding. */
    plan: unknown;
}

/** Narrow transaction/root view used by repository operations. */
interface SubscriptionPrisma {
    plan: PrismaModelDelegateLike<PlanRowLike>;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * `SubscriptionRepository` against the canonical `subscriptions` +
 * `plan_versions` tables.
 *
 * BundleVersion booking counts are an optional capability. Configure
 * `tenantSubscription.subscriptionBundleDelegate` for schemas carrying the
 * `subscription_bundles` junction; without it the platform keeps affected
 * versions frozen (fail-closed).
 */
@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
    readonly countByBundleVersionId?: (bundleVersionId: string) => Promise<number>;

    private readonly binding: PrismaPlanBindingResolver;
    private readonly planVersionDelegateName: string;
    private readonly subscriptionDelegateName: string;
    private readonly subscriptionBundleDelegateName: string | false;

    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: SubscriptionRepositoryClient,
        @Optional()
        @Inject(PRISMA_SCHEMA_OPTIONS_TOKEN)
        options?: PrismaSchemaOptions,
    ) {
        const schema = resolvePrismaSchemaOptions(options);
        this.binding = createPrismaPlanBindingResolver(options?.planBinding);
        this.planVersionDelegateName = schema.delegates.entitlementPlanVersion;
        this.subscriptionDelegateName = schema.tenantSubscription.delegate;
        this.subscriptionBundleDelegateName = schema.tenantSubscription.subscriptionBundleDelegate;
        if (this.subscriptionBundleDelegateName) {
            this.countByBundleVersionId = (bundleVersionId) =>
                this.countActiveBundleBindings(bundleVersionId);
        }
    }

    private db(tx?: TransactionContext): SubscriptionPrisma {
        return (tx ?? this.prisma) as unknown as SubscriptionPrisma;
    }

    async findByTenantId(tenantId: string): Promise<SubscriptionRecord | null> {
        return this.loadByTenantId(this.db(), tenantId);
    }

    async findByTenantIdLocked(
        tenantId: string,
        tx: TransactionContext,
    ): Promise<SubscriptionRecord | null> {
        const db = this.db(tx);
        // Row lock first — serializes concurrent enforceLimit() transactions
        // on the same tenant for the rest of the transaction. This intentionally
        // targets the canonical physical `subscriptions` table even when the
        // Prisma model delegate has another name (via @@map("subscriptions")).
        await db.$queryRaw`SELECT id FROM subscriptions WHERE "tenantId" = ${tenantId} FOR UPDATE`;
        return this.loadByTenantId(db, tenantId);
    }

    async countByPlanVersionId(planVersionId: string): Promise<number> {
        // Single COUNT over both FK columns — two separate queries would race.
        return this.subscriptions(this.db()).count({
            where: { OR: [{ planVersionId }, { pendingPlanVersionId: planVersionId }] },
        });
    }

    async countActiveByPlanKey(projectKey: string): Promise<Record<string, number>> {
        const db = this.db();
        const subscriptions = await this.subscriptions(db).findMany({
            where: { status: { in: ACTIVE_STATUSES } },
            select: { planVersionId: true },
        });
        const versionIds = [
            ...new Set(subscriptions.map((subscription) => subscription.planVersionId)),
        ];
        if (versionIds.length === 0) return {};

        const planVersions = await this.planVersions(db).findMany({
            where: { id: { in: versionIds } },
            select: { id: true, planId: true },
        });
        const planVersionById = new Map(
            planVersions.map((planVersion) => [planVersion.id, planVersion]),
        );
        const storedPlanIds = [...new Set(planVersions.map((planVersion) => planVersion.planId))];
        const planKeyByStoredId = await this.planKeysForProject(db, storedPlanIds, projectKey);

        const counts: Record<string, number> = {};
        for (const subscription of subscriptions) {
            const planVersion = planVersionById.get(subscription.planVersionId);
            const planKey = planVersion ? planKeyByStoredId.get(planVersion.planId) : undefined;
            // Missing/cross-project/ambiguous references fail closed. The
            // concrete PlanVersion, not denormalized Subscription.plan, is the
            // authoritative plan identity.
            if (!planKey) continue;
            counts[planKey] = (counts[planKey] ?? 0) + 1;
        }
        return counts;
    }

    private async countActiveBundleBindings(bundleVersionId: string): Promise<number> {
        if (!this.subscriptionBundleDelegateName) {
            throw new Error('SubscriptionBundle counting is not configured.');
        }
        return getPrismaDelegate<SubscriptionBundleDbRow>(
            this.prisma,
            this.subscriptionBundleDelegateName,
        ).count({
            where: {
                bundleVersionId,
                OR: [{ canceledAt: null }, { canceledEffectiveAt: { gt: new Date() } }],
            },
        });
    }

    private async loadByTenantId(
        db: SubscriptionPrisma,
        tenantId: string,
    ): Promise<SubscriptionRecord | null> {
        const row = await this.subscriptions(db).findUnique({ where: { tenantId } });
        if (!row) return null;
        return this.toRecord(db, row);
    }

    private async toRecord(
        db: SubscriptionPrisma,
        row: SubscriptionRowLike,
    ): Promise<SubscriptionRecord> {
        const planVersion = await this.planVersions(db).findUnique({
            where: { id: row.planVersionId },
        });
        if (!planVersion) {
            throw new Error(
                `Subscription ${row.id} references missing PlanVersion ${row.planVersionId}.`,
            );
        }
        const planKey = await this.binding.toPlanKey(db, planVersion.planId);
        return {
            id: row.id,
            tenantId: row.tenantId,
            // The concrete PlanVersion is authoritative. This also normalizes
            // legacy rows whose denormalized `Subscription.plan` drifted.
            plan: planKey,
            status: row.status,
            isPilot: row.isPilot,
            trialEntitlementPlan: row.trialEntitlementPlan,
            pendingPlan: row.pendingPlan,
            pendingEffectiveAt: row.pendingEffectiveAt,
            customLimits: (row.customLimits ?? null) as SubscriptionRecord['customLimits'],
            planVersionId: row.planVersionId,
            planVersion: {
                planId: planKey,
                quotas: toQuotaMap(planVersion.quotas),
                features: toStringArray(planVersion.features),
            },
        };
    }

    private planVersions(client: unknown): PrismaModelDelegateLike<PlanVersionRowLike> {
        return getPrismaDelegate(client, this.planVersionDelegateName);
    }

    private subscriptions(client: unknown): PrismaModelDelegateLike<SubscriptionRowLike> {
        return getPrismaDelegate(client, this.subscriptionDelegateName);
    }

    private async planKeysForProject(
        db: SubscriptionPrisma,
        storedPlanIds: string[],
        projectKey: string,
    ): Promise<Map<string, string>> {
        if (storedPlanIds.length === 0) return new Map();

        if (this.binding.mode === 'normalized-plan-id') {
            if (this.binding.projectKey && this.binding.projectKey !== projectKey) {
                throw new Error(
                    `Prisma plan binding is configured for project '${this.binding.projectKey}', ` +
                        `not '${projectKey}'.`,
                );
            }
            const plans = await db.plan.findMany({
                where: { projectKey, id: { in: storedPlanIds } },
                select: { id: true, planKey: true },
            });
            return new Map(plans.map((plan) => [plan.id, plan.planKey]));
        }

        // A legacy PlanVersion stores only the semantic planKey. If the same
        // key exists in multiple projects, ownership cannot be proven; omit it
        // rather than leaking another project's subscriptions into the count.
        const plans = await db.plan.findMany({
            where: { planKey: { in: storedPlanIds } },
            select: { projectKey: true, planKey: true },
        });
        const projectsByPlanKey = new Map<string, Set<string>>();
        for (const plan of plans) {
            const projects = projectsByPlanKey.get(plan.planKey) ?? new Set<string>();
            projects.add(plan.projectKey);
            projectsByPlanKey.set(plan.planKey, projects);
        }
        return new Map(
            storedPlanIds.flatMap((planKey) => {
                const projects = projectsByPlanKey.get(planKey);
                return projects?.size === 1 && projects.has(projectKey)
                    ? [[planKey, planKey] as const]
                    : [];
            }),
        );
    }
}
