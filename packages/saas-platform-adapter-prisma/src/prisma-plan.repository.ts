import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    buildActivePlanVersionWhere,
    type CreatePlanData,
    type CreatePlanVersionDraftData,
    type PlanListFilter,
    type PlanRepository,
    type PlanRow,
    type PlanVersionRow,
    type TransactionContext,
    type UpdatePlanData,
    type UpdatePlanVersionDraftData,
    type VersionChange,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type DecimalLike,
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

/** DB columns this repository reads from `plans`. */
interface PlanDbRow {
    id: string;
    projectKey: string;
    planKey: string;
    label: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

/** DB columns this repository reads from `plan_versions`. */
interface PlanVersionDbRow {
    id: string;
    planId: string;
    version: number;
    baseVersionId: string | null;
    features: unknown;
    quotas: unknown;
    monthlyNet: DecimalLike;
    yearlyNet: DecimalLike;
    marketed: boolean;
    publishedAt: Date | null;
    supersededAt: Date | null;
    publishedChanges: unknown;
    changeNote: string;
    nonRegressive: boolean;
    createdByUserId: string | null;
    publishedByUserId: string | null;
    validFrom?: Date | null;
    validUntil?: Date | null;
    endsAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

/** Narrow view of the injected client used by this repository. */
interface PlanPrisma {
    plan: PrismaModelDelegateLike<PlanDbRow>;
}

/** Root-client fields used directly; the version delegate is configurable. */
interface PlanRepositoryClient {
    plan: unknown;
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

/**
 * `PlanRepository` against the canonical `plans` + `plan_versions` tables
 * (SPEC_V2 §11.1 M6). Plan stem CRUD (Pack 1) and PlanVersion lifecycle
 * (Pack 2a) live in one adapter. Ports always use the semantic **planKey**;
 * storage defaults to the 0.6 soft binding
 * `PlanVersion.planId === Plan.planKey`. The opt-in normalized binding resolves
 * that key to `Plan.id` for every database operation.
 *
 * The canonical 0.6 schema has neither validity-window nor `endsAt` columns.
 * Both capabilities therefore default off for rolling compatibility; apps
 * that applied the current additive schema opt in through
 * `schema.planVersionFields.catalog`.
 */
@Injectable()
export class PrismaPlanRepository implements PlanRepository {
    private readonly binding: PrismaPlanBindingResolver;
    private readonly delegateName: string;
    private readonly fields: Required<PrismaPlanVersionFieldCapabilities>;

    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PlanRepositoryClient,
        @Optional()
        @Inject(PRISMA_SCHEMA_OPTIONS_TOKEN)
        options?: PrismaSchemaOptions,
    ) {
        const schema = resolvePrismaSchemaOptions(options);
        this.binding = createPrismaPlanBindingResolver(options?.planBinding);
        this.delegateName = schema.delegates.catalogPlanVersion;
        this.fields = schema.planVersionFields.catalog;
    }

    private db(tx?: TransactionContext): PlanPrisma {
        return (tx ?? this.prisma) as unknown as PlanPrisma;
    }

    private versions(client: unknown): PrismaModelDelegateLike<PlanVersionDbRow> {
        return getPrismaDelegate(client, this.delegateName);
    }

    // ─── Stem operations (Pack 1) ───

    async list(filter: PlanListFilter): Promise<PlanRow[]> {
        const excludeDeleted = filter.excludeDeleted ?? true;
        const db = this.db();
        let publishedKeys: string[] | null = null;
        if (filter.onlyPublished) {
            if (this.binding.mode === 'legacy-plan-key') {
                const projectPlans = await db.plan.findMany({
                    where: {
                        projectKey: filter.projectKey,
                        ...(excludeDeleted ? { deletedAt: null } : {}),
                    },
                });
                const candidateKeys = [...new Set(projectPlans.map((plan) => plan.planKey))];
                const allMatchingPlans =
                    candidateKeys.length === 0
                        ? []
                        : await db.plan.findMany({
                              where: { planKey: { in: candidateKeys } },
                          });
                const projectsByKey = new Map<string, Set<string>>();
                for (const plan of allMatchingPlans) {
                    const projects = projectsByKey.get(plan.planKey) ?? new Set<string>();
                    projects.add(plan.projectKey);
                    projectsByKey.set(plan.planKey, projects);
                }
                // A soft PlanVersion.planId contains only the planKey. If the
                // same key exists in more than one project, ownership cannot
                // be proven and `onlyPublished` must fail closed.
                const unambiguousKeys = candidateKeys.filter(
                    (planKey) => projectsByKey.get(planKey)?.size === 1,
                );
                const live = await this.versions(db).findMany({
                    where: {
                        planId: { in: unambiguousKeys },
                        publishedAt: { not: null },
                        supersededAt: null,
                    },
                });
                publishedKeys = [...new Set(live.map((version) => version.planId))];
            } else {
                const projectPlans = await db.plan.findMany({
                    where: {
                        projectKey: filter.projectKey,
                        ...(excludeDeleted ? { deletedAt: null } : {}),
                    },
                });
                const planKeyById = new Map(projectPlans.map((plan) => [plan.id, plan.planKey]));
                const live = await this.versions(db).findMany({
                    where: {
                        planId: { in: [...planKeyById.keys()] },
                        publishedAt: { not: null },
                        supersededAt: null,
                    },
                });
                publishedKeys = [
                    ...new Set(
                        live.flatMap((version) => {
                            const planKey = planKeyById.get(version.planId);
                            return planKey ? [planKey] : [];
                        }),
                    ),
                ];
            }
        }
        const rows = await db.plan.findMany({
            where: {
                projectKey: filter.projectKey,
                ...(excludeDeleted ? { deletedAt: null } : {}),
                ...(publishedKeys ? { planKey: { in: publishedKeys } } : {}),
            },
            orderBy: [{ sortOrder: 'asc' }, { planKey: 'asc' }],
        });
        return rows.map(toPlanRow);
    }

    async findById(planId: string): Promise<PlanRow | null> {
        const row = await this.db().plan.findUnique({ where: { id: planId } });
        return row ? toPlanRow(row) : null;
    }

    async findByKey(projectKey: string, planKey: string): Promise<PlanRow | null> {
        const row = await this.db().plan.findFirst({
            where: { projectKey, planKey, deletedAt: null },
        });
        return row ? toPlanRow(row) : null;
    }

    async create(data: CreatePlanData): Promise<PlanRow> {
        const created = await this.db().plan.create({
            data: {
                projectKey: data.projectKey,
                planKey: data.planKey,
                label: data.label,
                description: data.description ?? null,
                icon: data.icon ?? null,
                sortOrder: data.sortOrder ?? 0,
            },
        });
        return toPlanRow(created);
    }

    async update(planId: string, data: UpdatePlanData): Promise<PlanRow> {
        const updated = await this.db().plan.update({
            where: { id: planId },
            data: {
                ...(data.label !== undefined ? { label: data.label } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.icon !== undefined ? { icon: data.icon } : {}),
                ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
            },
        });
        return toPlanRow(updated);
    }

    async softDelete(planId: string): Promise<void> {
        await this.db().plan.update({
            where: { id: planId },
            data: { deletedAt: new Date() },
        });
    }

    async hardDelete(planId: string): Promise<void> {
        // deleteMany avoids a "record not found" throw — hard delete is idempotent.
        await this.db().plan.deleteMany({ where: { id: planId } });
    }

    // ─── Lifecycle operations (Pack 2a) — keyed by planKey ───

    async listVersions(planKey: string): Promise<PlanVersionRow[]> {
        const db = this.db();
        const storedPlanId = await this.binding.toStoragePlanId(db, planKey);
        const rows = await this.versions(db).findMany({
            where: { planId: storedPlanId },
            orderBy: { version: 'asc' },
        });
        return rows.map((row) => this.toPlanVersionRow(row, planKey));
    }

    async findVersionById(versionId: string): Promise<PlanVersionRow | null> {
        const db = this.db();
        const row = await this.versions(db).findUnique({ where: { id: versionId } });
        return row
            ? this.toPlanVersionRow(row, await this.binding.toPlanKey(db, row.planId))
            : null;
    }

    async findCurrentDraft(planKey: string): Promise<PlanVersionRow | null> {
        const db = this.db();
        const storedPlanId = await this.binding.toStoragePlanId(db, planKey);
        const row = await this.versions(db).findFirst({
            where: { planId: storedPlanId, publishedAt: null },
        });
        return row ? this.toPlanVersionRow(row, planKey) : null;
    }

    async findLatestLivePlanVersion(
        planKey: string,
        tx?: TransactionContext,
    ): Promise<PlanVersionRow | null> {
        const db = this.db(tx);
        const storedPlanId = await this.binding.toStoragePlanId(db, planKey);
        const row = await this.versions(db).findFirst({
            where: {
                planId: storedPlanId,
                publishedAt: { not: null },
                supersededAt: null,
                ...(this.fields.endsAt
                    ? { OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }
                    : {}),
            },
            orderBy: { version: 'desc' },
        });
        return row ? this.toPlanVersionRow(row, planKey) : null;
    }

    async findActivePlanVersion(
        planKey: string,
        asOf: Date = new Date(),
        tx?: TransactionContext,
    ): Promise<PlanVersionRow | null> {
        if (!this.fields.validityWindows) {
            throw new Error(
                'findActivePlanVersion requires ' +
                    'schema.planVersionFields.catalog.validityWindows=true and the current ' +
                    '@saasicat/spec PlanVersion validity columns. Apply the additive schema first, ' +
                    'or use findLatestLivePlanVersion for a 0.6-compatible newest-live lookup.',
            );
        }
        const db = this.db(tx);
        const storedPlanId = await this.binding.toStoragePlanId(db, planKey);
        const activeWhere = this.fields.endsAt
            ? buildActivePlanVersionWhere(asOf, { withEndsAt: true })
            : buildActivePlanVersionWhere(asOf);
        const row = await this.versions(db).findFirst({
            where: { planId: storedPlanId, ...activeWhere },
            orderBy: [{ validFrom: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }],
        });
        return row ? this.toPlanVersionRow(row, planKey) : null;
    }

    async createPlanVersionDraft(data: CreatePlanVersionDraftData): Promise<PlanVersionRow> {
        const planKey = data.planId;
        const db = this.db();
        const planVersion = this.versions(db);
        const storedPlanId = await this.binding.toStoragePlanId(db, planKey);
        const latest = await planVersion.findFirst({
            where: { planId: storedPlanId },
            orderBy: { version: 'desc' },
        });
        const nextVersion = (latest?.version ?? 0) + 1;
        const created = await planVersion.create({
            data: {
                planId: storedPlanId,
                version: nextVersion,
                baseVersionId: data.baseVersionId ?? null,
                features: data.features,
                quotas: data.quotas,
                monthlyNet: data.monthlyNet,
                yearlyNet: data.yearlyNet,
                marketed: data.marketed ?? true,
                changeNote: data.changeNote ?? '',
                createdByUserId: data.createdByUserId ?? null,
                ...(this.fields.validityWindows
                    ? {
                          validFrom: data.validFrom ? new Date(data.validFrom) : null,
                          validUntil: data.validUntil ? new Date(data.validUntil) : null,
                      }
                    : {}),
                // publishedAt defaults to null (draft). `bundles` remains
                // app-specific and is intentionally not persisted here.
            },
        });
        return this.toPlanVersionRow(created, planKey);
    }

    async updatePlanVersionDraft(
        versionId: string,
        data: UpdatePlanVersionDraftData,
    ): Promise<PlanVersionRow> {
        const updated = await this.versions(this.db()).update({
            where: { id: versionId },
            data: {
                ...(data.features !== undefined ? { features: data.features } : {}),
                ...(data.quotas !== undefined ? { quotas: data.quotas } : {}),
                ...(data.monthlyNet !== undefined ? { monthlyNet: data.monthlyNet } : {}),
                ...(data.yearlyNet !== undefined ? { yearlyNet: data.yearlyNet } : {}),
                ...(data.marketed !== undefined ? { marketed: data.marketed } : {}),
                ...(data.changeNote !== undefined ? { changeNote: data.changeNote } : {}),
                ...(this.fields.validityWindows && data.validFrom !== undefined
                    ? { validFrom: data.validFrom ? new Date(data.validFrom) : null }
                    : {}),
                ...(this.fields.validityWindows && data.validUntil !== undefined
                    ? { validUntil: data.validUntil ? new Date(data.validUntil) : null }
                    : {}),
                // `bundles` remains app-specific and is intentionally ignored.
            },
        });
        const planKey = await this.binding.toPlanKey(this.db(), updated.planId);
        return this.toPlanVersionRow(updated, planKey);
    }

    async publishPlanVersionDraft(
        versionId: string,
        publishMeta: {
            publishedByUserId: string | null;
            publishedChanges: VersionChange[];
            nonRegressive: boolean;
            validFrom: Date;
            validUntil: Date | null;
        },
        tx?: TransactionContext,
    ): Promise<PlanVersionRow> {
        const operationDb = this.db(tx);
        const draft = await this.versions(operationDb).findUnique({
            where: { id: versionId },
        });
        if (!draft) {
            throw new Error(`PlanVersion ${versionId} not found.`);
        }
        const storedPlanId = draft.planId;

        const publish = async (db: PlanPrisma): Promise<PlanVersionDbRow> => {
            const planVersion = this.versions(db);
            const previous = await planVersion.findFirst({
                where: {
                    planId: storedPlanId,
                    publishedAt: { not: null },
                    supersededAt: null,
                    id: { not: versionId },
                },
                orderBy: { version: 'desc' },
            });
            const now = new Date();
            if (previous) {
                const predecessorValidUntil = new Date(
                    publishMeta.validFrom.getTime() - 24 * 60 * 60 * 1000,
                );
                await planVersion.update({
                    where: { id: previous.id },
                    data: {
                        supersededAt: now,
                        ...(this.fields.validityWindows
                            ? { validUntil: predecessorValidUntil }
                            : {}),
                    },
                });
            }
            return planVersion.update({
                where: { id: versionId },
                data: {
                    publishedAt: now,
                    publishedChanges: publishMeta.publishedChanges,
                    nonRegressive: publishMeta.nonRegressive,
                    publishedByUserId: publishMeta.publishedByUserId,
                    ...(this.fields.validityWindows
                        ? {
                              validFrom: publishMeta.validFrom,
                              validUntil: publishMeta.validUntil,
                          }
                        : {}),
                },
            });
        };

        const published = tx
            ? await publish(this.db(tx))
            : await this.prisma.$transaction((txClient) =>
                  publish(txClient as unknown as PlanPrisma),
              );
        const planKey = await this.binding.toPlanKey(operationDb, storedPlanId);
        return this.toPlanVersionRow(published, planKey);
    }

    async deletePlanVersionDraft(versionId: string): Promise<void> {
        const planVersion = this.versions(this.db());
        const row = await planVersion.findUnique({ where: { id: versionId } });
        if (!row) return; // no-op — the draft is already gone
        if (row.publishedAt !== null) {
            throw new Error(
                `PlanVersion ${versionId} is already published and cannot be discarded ` +
                    '(published versions are immutable — contract protection P1).',
            );
        }
        await planVersion.deleteMany({ where: { id: versionId, publishedAt: null } });
    }

    async terminate(versionId: string, endsAt: Date): Promise<PlanVersionRow> {
        if (!this.fields.endsAt) {
            throw new Error(
                'terminate requires schema.planVersionFields.catalog.endsAt=true and the current ' +
                    '@saasicat/spec PlanVersion.endsAt column. Apply the additive schema before ' +
                    'enabling SuperAdmin-initiated plan-version termination.',
            );
        }
        const db = this.db();
        const updated = await this.versions(db).update({
            where: { id: versionId },
            data: { endsAt },
        });
        const planKey = await this.binding.toPlanKey(db, updated.planId);
        return this.toPlanVersionRow(updated, planKey);
    }

    private toPlanVersionRow(row: PlanVersionDbRow, planKey: string): PlanVersionRow {
        return toPlanVersionRow(row, planKey, this.fields);
    }
}

function toPlanRow(row: PlanDbRow): PlanRow {
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
        deletedAt: row.deletedAt?.toISOString() ?? null,
    };
}

function toPlanVersionRow(
    row: PlanVersionDbRow,
    planKey: string,
    fields: Required<PrismaPlanVersionFieldCapabilities>,
): PlanVersionRow {
    const mapped: PlanVersionRow = {
        id: row.id,
        version: row.version,
        baseVersionId: row.baseVersionId,
        planId: planKey,
        features: toStringArray(row.features),
        quotas: toQuotaMap(row.quotas),
        monthlyNet: row.monthlyNet.toString(),
        yearlyNet: row.yearlyNet.toString(),
        marketed: row.marketed,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        supersededAt: row.supersededAt?.toISOString() ?? null,
        publishedChanges: Array.isArray(row.publishedChanges)
            ? (row.publishedChanges as VersionChange[])
            : null,
        changeNote: row.changeNote,
        nonRegressive: row.nonRegressive,
        validFrom: fields.validityWindows && row.validFrom ? row.validFrom.toISOString() : null,
        validUntil: fields.validityWindows && row.validUntil ? row.validUntil.toISOString() : null,
        createdByUserId: row.createdByUserId,
        publishedByUserId: row.publishedByUserId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
    if (fields.endsAt) {
        mapped.endsAt = row.endsAt?.toISOString() ?? null;
    }
    return mapped;
}
