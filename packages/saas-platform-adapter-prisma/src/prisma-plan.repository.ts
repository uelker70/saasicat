import { Inject, Injectable } from '@nestjs/common';
import type {
    CreatePlanData,
    CreatePlanVersionDraftData,
    PlanListFilter,
    PlanRepository,
    PlanRow,
    PlanVersionRow,
    TransactionContext,
    UpdatePlanData,
    UpdatePlanVersionDraftData,
    VersionChange,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type DecimalLike,
    type PrismaLike,
    type PrismaModelDelegateLike,
} from './prisma-client-token.js';
import { resolveClient, toQuotaMap, toStringArray } from './tx.js';

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
    createdAt: Date;
    updatedAt: Date;
}

/** Narrow view of the injected client used by this repository. */
interface PlanPrisma {
    plan: PrismaModelDelegateLike<PlanDbRow>;
    planVersion: PrismaModelDelegateLike<PlanVersionDbRow>;
}

/**
 * `PlanRepository` against the canonical `plans` + `plan_versions` tables
 * (SPEC_V2 §11.1 M6). Plan stem CRUD (Pack 1) and PlanVersion lifecycle
 * (Pack 2a) live in one adapter; the soft binding is
 * `PlanVersion.planId === Plan.planKey`, so the lifecycle methods take the
 * **planKey**, not the plan UUID.
 *
 * Schema limitation: the canonical `plan_versions` fragment
 * (03-plan-versions.prisma) intentionally has no validity-window columns
 * (`validFrom`/`validUntil`) and no `endsAt` column — it carries a generic
 * `quotas Json` instead of fixed quota columns. Consequences:
 * - Every `PlanVersionRow.validFrom`/`validUntil` maps to `null`.
 * - `publishPlanVersionDraft` persists only the publish/supersede state; the
 *   `validFrom`/`validUntil` in `publishMeta` cannot be stored, so
 *   auto-succession reduces to setting `supersededAt` on the previous live version.
 * - `findActivePlanVersion` (validity-window read) and `terminate` (endsAt)
 *   throw, because their contract depends on columns this schema does not have.
 *   Consumers that need them provide a custom adapter on an extended schema.
 */
@Injectable()
export class PrismaPlanRepository implements PlanRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    private db(tx?: TransactionContext): PlanPrisma {
        return resolveClient(this.prisma, tx) as unknown as PlanPrisma;
    }

    // ─── Stem operations (Pack 1) ───

    async list(filter: PlanListFilter): Promise<PlanRow[]> {
        const excludeDeleted = filter.excludeDeleted ?? true;
        let publishedKeys: string[] | null = null;
        if (filter.onlyPublished) {
            const live = await this.db().planVersion.findMany({
                where: { publishedAt: { not: null }, supersededAt: null },
            });
            publishedKeys = [...new Set(live.map((version) => version.planId))];
        }
        const rows = await this.db().plan.findMany({
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
        const rows = await this.db().planVersion.findMany({
            where: { planId: planKey },
            orderBy: { version: 'asc' },
        });
        return rows.map(toPlanVersionRow);
    }

    async findVersionById(versionId: string): Promise<PlanVersionRow | null> {
        const row = await this.db().planVersion.findUnique({ where: { id: versionId } });
        return row ? toPlanVersionRow(row) : null;
    }

    async findCurrentDraft(planKey: string): Promise<PlanVersionRow | null> {
        const row = await this.db().planVersion.findFirst({
            where: { planId: planKey, publishedAt: null },
        });
        return row ? toPlanVersionRow(row) : null;
    }

    async findLatestLivePlanVersion(
        planKey: string,
        tx?: TransactionContext,
    ): Promise<PlanVersionRow | null> {
        const row = await this.db(tx).planVersion.findFirst({
            where: { planId: planKey, publishedAt: { not: null }, supersededAt: null },
            orderBy: { version: 'desc' },
        });
        return row ? toPlanVersionRow(row) : null;
    }

    async findActivePlanVersion(): Promise<PlanVersionRow | null> {
        throw new Error(
            'findActivePlanVersion is not supported by the shipped @saasicat/adapter-prisma ' +
                'PlanRepository: the canonical plan_versions schema (03-plan-versions.prisma) has ' +
                'no validFrom/validUntil columns, so a version cannot be resolved by validity ' +
                'window. Use findLatestLivePlanVersion for the newest live version, or provide a ' +
                'custom PlanRepository adapter on a schema that carries the validity-window columns.',
        );
    }

    async createPlanVersionDraft(data: CreatePlanVersionDraftData): Promise<PlanVersionRow> {
        const planKey = data.planId;
        const latest = await this.db().planVersion.findFirst({
            where: { planId: planKey },
            orderBy: { version: 'desc' },
        });
        const nextVersion = (latest?.version ?? 0) + 1;
        const created = await this.db().planVersion.create({
            data: {
                planId: planKey,
                version: nextVersion,
                baseVersionId: data.baseVersionId ?? null,
                features: data.features,
                quotas: data.quotas,
                monthlyNet: data.monthlyNet,
                yearlyNet: data.yearlyNet,
                marketed: data.marketed ?? true,
                changeNote: data.changeNote ?? '',
                createdByUserId: data.createdByUserId ?? null,
                // publishedAt defaults to null (draft). bundles/validFrom/validUntil
                // have no column in the canonical plan_versions schema — dropped.
            },
        });
        return toPlanVersionRow(created);
    }

    async updatePlanVersionDraft(
        versionId: string,
        data: UpdatePlanVersionDraftData,
    ): Promise<PlanVersionRow> {
        const updated = await this.db().planVersion.update({
            where: { id: versionId },
            data: {
                ...(data.features !== undefined ? { features: data.features } : {}),
                ...(data.quotas !== undefined ? { quotas: data.quotas } : {}),
                ...(data.monthlyNet !== undefined ? { monthlyNet: data.monthlyNet } : {}),
                ...(data.yearlyNet !== undefined ? { yearlyNet: data.yearlyNet } : {}),
                ...(data.marketed !== undefined ? { marketed: data.marketed } : {}),
                ...(data.changeNote !== undefined ? { changeNote: data.changeNote } : {}),
                // bundles/validFrom/validUntil: no column in canonical schema — ignored.
            },
        });
        return toPlanVersionRow(updated);
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
        const draft = await this.db(tx).planVersion.findUnique({ where: { id: versionId } });
        if (!draft) {
            throw new Error(`PlanVersion ${versionId} not found.`);
        }
        const planKey = draft.planId;

        // The canonical plan_versions schema has no validFrom/validUntil columns,
        // so publishMeta.validFrom/validUntil cannot be persisted; auto-succession
        // reduces to marking the previously live version superseded.
        const publish = async (db: PlanPrisma): Promise<PlanVersionDbRow> => {
            const previous = await db.planVersion.findFirst({
                where: {
                    planId: planKey,
                    publishedAt: { not: null },
                    supersededAt: null,
                    id: { not: versionId },
                },
                orderBy: { version: 'desc' },
            });
            const now = new Date();
            if (previous) {
                await db.planVersion.update({
                    where: { id: previous.id },
                    data: { supersededAt: now },
                });
            }
            return db.planVersion.update({
                where: { id: versionId },
                data: {
                    publishedAt: now,
                    publishedChanges: publishMeta.publishedChanges,
                    nonRegressive: publishMeta.nonRegressive,
                    publishedByUserId: publishMeta.publishedByUserId,
                },
            });
        };

        const published = tx
            ? await publish(this.db(tx))
            : await this.prisma.$transaction((txClient) =>
                  publish(txClient as unknown as PlanPrisma),
              );
        return toPlanVersionRow(published);
    }

    async deletePlanVersionDraft(versionId: string): Promise<void> {
        const row = await this.db().planVersion.findUnique({ where: { id: versionId } });
        if (!row) return; // no-op — the draft is already gone
        if (row.publishedAt !== null) {
            throw new Error(
                `PlanVersion ${versionId} is already published and cannot be discarded ` +
                    '(published versions are immutable — contract protection P1).',
            );
        }
        await this.db().planVersion.deleteMany({ where: { id: versionId, publishedAt: null } });
    }

    async terminate(): Promise<PlanVersionRow> {
        throw new Error(
            'terminate is not supported by the shipped @saasicat/adapter-prisma PlanRepository: ' +
                'the canonical plan_versions schema (03-plan-versions.prisma) has no endsAt column. ' +
                'Provide a custom PlanRepository adapter on a schema that carries endsAt to support ' +
                'SuperAdmin-initiated plan-version termination.',
        );
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

function toPlanVersionRow(row: PlanVersionDbRow): PlanVersionRow {
    return {
        id: row.id,
        version: row.version,
        baseVersionId: row.baseVersionId,
        planId: row.planId,
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
        // The canonical plan_versions schema carries no validity-window columns.
        validFrom: null,
        validUntil: null,
        createdByUserId: row.createdByUserId,
        publishedByUserId: row.publishedByUserId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
