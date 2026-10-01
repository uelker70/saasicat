import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    buildActivePlanVersionWhere,
    catalogVersionAlreadyPublished,
    catalogDraftExists,
    catalogVersionGone,
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
    definedFields,
} from '@saasicat/core';
import { planKeyTaken, previousUtcDay, toPlanRow, toPlanVersionRow } from '@saasicat/core';
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
    type PrismaSchemaOptions,
} from './prisma-plan-binding.js';
import { refusalOfSkippedInsert } from './skipped-insert.js';

/** DB columns this repository reads from `plans`. */
interface PlanDbRow {
    id: string;
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
    validFrom: Date | null;
    validUntil: Date | null;
    endsAt: Date | null;
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
 *. Plan stem CRUD (Pack 1) and PlanVersion lifecycle
 * (Pack 2a) live in one adapter. Ports always use the semantic **planKey**;
 * storage defaults to the 0.6 soft binding
 * `PlanVersion.planId === Plan.planKey`. The opt-in normalized binding resolves
 * that key to `Plan.id` for every database operation.
 *
 * A version's `validFrom`, `validUntil` and `endsAt` are always written and
 * read: they decide which version is on sale (`findActivePlanVersion`).
 */
@Injectable()
export class PrismaPlanRepository implements PlanRepository {
    private readonly binding: PrismaPlanBindingResolver;
    private readonly delegateName: string;

    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PlanRepositoryClient,
        @Optional()
        @Inject(PRISMA_SCHEMA_OPTIONS_TOKEN)
        options?: PrismaSchemaOptions,
    ) {
        const schema = resolvePrismaSchemaOptions(options);
        this.binding = createPrismaPlanBindingResolver(options?.planBinding);
        this.delegateName = schema.delegates.catalogPlanVersion;
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
                // `PlanVersion.planId` holds the plan key, and a key names one
                // plan for the whole installation — so the live versions say
                // which keys are published without a lookup on `plans`.
                const live = await this.versions(db).findMany({
                    where: { publishedAt: { not: null }, supersededAt: null },
                });
                publishedKeys = [...new Set(live.map((version) => version.planId))];
            } else {
                const plans = await db.plan.findMany({
                    where: { ...(excludeDeleted ? { deletedAt: null } : {}) },
                });
                const planKeyById = new Map(plans.map((plan) => [plan.id, plan.planKey]));
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

    /**
     * Whether this installation already uses this plan key — **including
     * retired plans**.
     *
     * The same reasoning as `PrismaBundleRepository.findByKey`: the unique
     * index is unconditional, so a soft delete does not free the key, and the
     * duplicate check in `createPlan` needs the database's answer rather than
     * the active catalogue's. `list` is that other lookup.
     */
    async findByKey(planKey: string): Promise<PlanRow | null> {
        const row = await this.db().plan.findFirst({ where: { planKey } });
        return row ? toPlanRow(row) : null;
    }

    async create(data: CreatePlanData): Promise<PlanRow> {
        // `ON CONFLICT DO NOTHING`: a key taken by a create that raced past the
        // platform's check is refused, and a caller's transaction stays usable.
        const [created] = await this.db().plan.createManyAndReturn({
            skipDuplicates: true,
            data: [
                {
                    planKey: data.planKey,
                    label: data.label,
                    description: data.description ?? null,
                    icon: data.icon ?? null,
                    sortOrder: data.sortOrder ?? 0,
                },
            ],
        });
        if (!created) {
            throw await refusalOfSkippedInsert(
                async () => (await this.findByKey(data.planKey)) !== null,
                () => planKeyTaken(data.planKey),
                `Plan '${data.planKey}'`,
            );
        }
        return toPlanRow(created);
    }

    async update(planId: string, data: UpdatePlanData): Promise<PlanRow> {
        const updated = await this.db().plan.update({
            where: { id: planId },
            data: definedFields(data, ['label', 'description', 'icon', 'sortOrder']),
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
        const storedPlanId = await this.binding.findStoragePlanId(db, planKey);
        if (storedPlanId === null) return [];
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
        const storedPlanId = await this.binding.findStoragePlanId(db, planKey);
        if (storedPlanId === null) return null;
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
        const storedPlanId = await this.binding.findStoragePlanId(db, planKey);
        if (storedPlanId === null) return null;
        const row = await this.versions(db).findFirst({
            where: {
                planId: storedPlanId,
                publishedAt: { not: null },
                supersededAt: null,
                OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
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
        const db = this.db(tx);
        const storedPlanId = await this.binding.findStoragePlanId(db, planKey);
        if (storedPlanId === null) return null;
        const activeWhere = buildActivePlanVersionWhere(asOf, { withEndsAt: true });
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
        // `ON CONFLICT DO NOTHING` on the one-draft-per-plan index and on the
        // version number: a draft created in the meantime is refused.
        const [created] = await planVersion.createManyAndReturn({
            skipDuplicates: true,
            data: [
                {
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
                    validFrom: data.validFrom ? new Date(data.validFrom) : null,
                    validUntil: data.validUntil ? new Date(data.validUntil) : null,
                    // publishedAt defaults to null (draft). `bundles` remains
                    // app-specific and is intentionally not persisted here.
                },
            ],
        });
        if (!created) {
            // The version number can also have been taken by a draft published
            // a moment later; that reads as the draft it was, and asking again
            // succeeds.
            const draft = await planVersion.findFirst({
                where: { planId: storedPlanId, publishedAt: null },
            });
            throw catalogDraftExists('PlanVersion', planKey, draft?.version ?? nextVersion);
        }
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
                ...(data.validFrom !== undefined
                    ? { validFrom: data.validFrom ? new Date(data.validFrom) : null }
                    : {}),
                ...(data.validUntil !== undefined
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
        const publish = async (db: PlanPrisma): Promise<PlanVersionDbRow> => {
            const planVersion = this.versions(db);
            const now = new Date();
            // Claim the draft first, and only while it IS one — the order
            // `adapter-drizzle` and the bundle repository use. Superseding the
            // predecessor first lets two publications of one draft both write:
            // the second overwrites when and by whom the version was published,
            // and closes the predecessor a second time.
            const claimed = await planVersion.updateMany({
                where: { id: versionId, publishedAt: null },
                data: {
                    publishedAt: now,
                    publishedChanges: publishMeta.publishedChanges,
                    nonRegressive: publishMeta.nonRegressive,
                    publishedByUserId: publishMeta.publishedByUserId,
                    validFrom: publishMeta.validFrom,
                    validUntil: publishMeta.validUntil,
                },
            });
            const published = await planVersion.findUnique({ where: { id: versionId } });
            if (!published) throw catalogVersionGone('PlanVersion', versionId);
            if (claimed.count === 0) throw catalogVersionAlreadyPublished('PlanVersion', versionId);

            await planVersion.updateMany({
                where: {
                    planId: published.planId,
                    publishedAt: { not: null },
                    supersededAt: null,
                    id: { not: versionId },
                },
                data: {
                    supersededAt: now,
                    validUntil: previousUtcDay(publishMeta.validFrom),
                },
            });
            return published;
        };

        const published = tx
            ? await publish(this.db(tx))
            : await this.prisma.$transaction((txClient) =>
                  publish(txClient as unknown as PlanPrisma),
              );
        const planKey = await this.binding.toPlanKey(this.db(tx), published.planId);
        return this.toPlanVersionRow(published, planKey);
    }

    async deletePlanVersionDraft(versionId: string): Promise<void> {
        const planVersion = this.versions(this.db());
        // Conditional on the row still being a draft, and the answer read from
        // what the DELETE matched rather than from a SELECT before it: a
        // publish committing in between would otherwise leave the caller told
        // the draft is gone while a published version stands.
        const { count } = await planVersion.deleteMany({
            where: { id: versionId, publishedAt: null },
        });
        if (count > 0) return;
        // Already gone is the state the caller wanted; still there means it
        // was published, and that is a refusal they have to see.
        const remaining = await planVersion.findUnique({ where: { id: versionId } });
        if (remaining) throw catalogVersionAlreadyPublished('PlanVersion', versionId);
    }

    async terminate(versionId: string, endsAt: Date): Promise<PlanVersionRow> {
        const db = this.db();
        const updated = await this.versions(db).update({
            where: { id: versionId },
            data: { endsAt },
        });
        const planKey = await this.binding.toPlanKey(db, updated.planId);
        return this.toPlanVersionRow(updated, planKey);
    }

    private toPlanVersionRow(row: PlanVersionDbRow, planKey: string): PlanVersionRow {
        return toPlanVersionRow(row, planKey);
    }
}
