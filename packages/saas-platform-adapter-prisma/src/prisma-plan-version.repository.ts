import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    buildActivePlanVersionWhere,
    type PlanVersionRecord,
    type PlanVersionRepository,
    type TransactionContext,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
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

/**
 * Root-client fields needed outside the configurable PlanVersion delegate.
 * `plan` is used by normalized semantic-key ↔ UUID binding.
 */
interface PlanVersionRepositoryClient {
    plan: unknown;
}

/**
 * `PlanVersionRepository` against the canonical `plan_versions` table.
 *
 * `findActive` remains absent with the canonical 0.6 defaults. Extended
 * schemas enable it through `schema.planVersionFields.entitlement`; its query
 * then uses the shared day-inclusive validity semantics.
 */
@Injectable()
export class PrismaPlanVersionRepository implements PlanVersionRepository {
    readonly findActive?: (
        planId: string,
        asOf?: Date,
        tx?: TransactionContext,
    ) => Promise<PlanVersionRecord | null>;

    private readonly binding: PrismaPlanBindingResolver;
    private readonly delegateName: string;
    private readonly fields: Required<PrismaPlanVersionFieldCapabilities>;

    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PlanVersionRepositoryClient,
        @Optional()
        @Inject(PRISMA_SCHEMA_OPTIONS_TOKEN)
        options?: PrismaSchemaOptions,
    ) {
        const schema = resolvePrismaSchemaOptions(options);
        this.binding = createPrismaPlanBindingResolver(options?.planBinding);
        this.delegateName = schema.delegates.entitlementPlanVersion;
        this.fields = schema.planVersionFields.entitlement;
        if (this.fields.validityWindows) {
            this.findActive = (planId, asOf = new Date(), tx) =>
                this.findActivePlanVersion(planId, asOf, tx);
        }
    }

    private db(tx?: TransactionContext): PlanVersionRepositoryClient {
        return (tx ?? this.prisma) as unknown as PlanVersionRepositoryClient;
    }

    async findLatestLive(
        planId: string,
        tx?: TransactionContext,
    ): Promise<PlanVersionRecord | null> {
        const db = this.db(tx);
        const storedPlanId = await this.binding.toStoragePlanId(db, planId);
        const row = await this.versions(db).findFirst({
            where: { planId: storedPlanId, publishedAt: { not: null }, supersededAt: null },
            orderBy: { version: 'desc' },
        });
        if (!row) return null;
        return this.toRecord(db, row);
    }

    private async findActivePlanVersion(
        planId: string,
        asOf: Date,
        tx?: TransactionContext,
    ): Promise<PlanVersionRecord | null> {
        const db = this.db(tx);
        const storedPlanId = await this.binding.toStoragePlanId(db, planId);
        const activeWhere = this.fields.endsAt
            ? buildActivePlanVersionWhere(asOf, { withEndsAt: true })
            : buildActivePlanVersionWhere(asOf);
        const row = await this.versions(db).findFirst({
            where: {
                planId: storedPlanId,
                ...activeWhere,
            },
            orderBy: [{ validFrom: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }],
        });
        if (!row) return null;
        return this.toRecord(db, row);
    }

    private versions(client: unknown): PrismaModelDelegateLike<PlanVersionRowLike> {
        return getPrismaDelegate(client, this.delegateName);
    }

    private async toRecord(client: unknown, row: PlanVersionRowLike): Promise<PlanVersionRecord> {
        return {
            planId: await this.binding.toPlanKey(client, row.planId),
            quotas: toQuotaMap(row.quotas),
            features: toStringArray(row.features),
        };
    }
}
