import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
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
} from '@saasicat/core';
import { previousUtcDay, startOfUtcDay, toPlanRow, toPlanVersionRow } from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { plans, planVersions } from './schema.js';

type PlanVersionTableRow = typeof planVersions.$inferSelect;

/** Whether this adapter answers validity-window questions at all. */
export interface DrizzlePlanRepositoryOptions {
    /**
     * Opt-in, mirroring `adapter-prisma` and `DrizzleBundleRepository`. Without
     * it a draft's `validFrom`/`validUntil` are neither written nor returned and
     * `findActivePlanVersion` is not offered, so a consumer whose schema
     * predates the columns gets a capability that is absent rather than one
     * that answers from columns nobody maintains.
     */
    validityWindows?: boolean;
}

/**
 * `PlanRepository` against the canonical `plans` and `plan_versions`.
 *
 * The plan half of the catalogue: which plans a project sells, in which
 * versions, and from when. `DrizzleBundleRepository` is the same shape one
 * level down, for the add-ons a plan can carry.
 *
 * `plan_versions.planId` holds the **plan key**, not a foreign key into
 * `plans.id` — that is what the canonical schema stores and what
 * `CreatePlanVersionDraftData.planId` documents. `adapter-prisma` carries a
 * binding resolver because consumer schemas disagree about it; this adapter
 * owns its schema and has no such disagreement to translate.
 */
@Injectable()
export class DrizzlePlanRepository implements PlanRepository {
    private readonly validityWindows: boolean;

    constructor(
        @Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient,
        @Optional() options: DrizzlePlanRepositoryOptions = {},
    ) {
        this.validityWindows = options.validityWindows ?? false;
        // Assigned rather than declared, and only when promised — see the same
        // constructor in `DrizzleBundleRepository` for why a method that exists
        // and cannot answer is worse than one that is absent.
        if (this.validityWindows) {
            this.findActivePlanVersion = (planKey, asOf, tx) =>
                this.activeVersionAt(planKey, asOf ?? new Date(), tx);
        }
    }

    readonly findActivePlanVersion?: (
        planKey: string,
        asOf?: Date,
        tx?: TransactionContext,
    ) => Promise<PlanVersionRow | null>;

    // ─── Stem operations ───

    async list(filter: PlanListFilter): Promise<PlanRow[]> {
        const excludeDeleted = filter.excludeDeleted ?? true;
        const stems = await this.db
            .select()
            .from(plans)
            .where(
                and(
                    eq(plans.projectKey, filter.projectKey),
                    ...(excludeDeleted ? [isNull(plans.deletedAt)] : []),
                ),
            )
            .orderBy(asc(plans.sortOrder), asc(plans.planKey));
        if (!filter.onlyPublished) return stems.map(toPlanRow);
        if (stems.length === 0) return [];

        // One query for all of them rather than one per plan: `onlyPublished`
        // is the marketing catalogue's filter and runs on every page load.
        const live = await this.db
            .select({ planId: planVersions.planId })
            .from(planVersions)
            .where(
                and(
                    inArray(
                        planVersions.planId,
                        stems.map((stem) => stem.planKey),
                    ),
                    sql`${planVersions.publishedAt} IS NOT NULL`,
                    isNull(planVersions.supersededAt),
                ),
            );
        const publishedKeys = new Set(live.map((row) => row.planId));
        return stems.filter((stem) => publishedKeys.has(stem.planKey)).map(toPlanRow);
    }

    async findById(planId: string): Promise<PlanRow | null> {
        const rows = await this.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
        return rows[0] ? toPlanRow(rows[0]) : null;
    }

    async findByKey(projectKey: string, planKey: string): Promise<PlanRow | null> {
        const rows = await this.db
            .select()
            .from(plans)
            .where(
                and(
                    eq(plans.projectKey, projectKey),
                    eq(plans.planKey, planKey),
                    isNull(plans.deletedAt),
                ),
            )
            .limit(1);
        return rows[0] ? toPlanRow(rows[0]) : null;
    }

    async create(data: CreatePlanData): Promise<PlanRow> {
        const now = new Date();
        const rows = await this.db
            .insert(plans)
            .values({
                id: randomUUID(),
                projectKey: data.projectKey,
                planKey: data.planKey,
                label: data.label,
                description: data.description ?? null,
                icon: data.icon ?? null,
                sortOrder: data.sortOrder ?? 0,
                createdAt: now,
                updatedAt: now,
            })
            .returning();
        return toPlanRow(rows[0]);
    }

    async update(planId: string, data: UpdatePlanData): Promise<PlanRow> {
        const rows = await this.db
            .update(plans)
            .set({
                ...(data.label !== undefined ? { label: data.label } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.icon !== undefined ? { icon: data.icon } : {}),
                ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
                updatedAt: new Date(),
            })
            .where(eq(plans.id, planId))
            .returning();
        if (!rows[0]) throw new Error(`Plan '${planId}' not found.`);
        return toPlanRow(rows[0]);
    }

    async softDelete(planId: string): Promise<void> {
        const now = new Date();
        await this.db
            .update(plans)
            .set({ deletedAt: now, updatedAt: now })
            .where(eq(plans.id, planId));
    }

    async hardDelete(planId: string): Promise<void> {
        // Idempotent: deleting a plan that is already gone is not an error.
        await this.db.delete(plans).where(eq(plans.id, planId));
    }

    // ─── Version lifecycle — keyed by plan key ───

    async listVersions(planKey: string): Promise<PlanVersionRow[]> {
        const rows = await this.db
            .select()
            .from(planVersions)
            .where(eq(planVersions.planId, planKey))
            .orderBy(asc(planVersions.version));
        return rows.map((row) => this.versionRow(row));
    }

    async findVersionById(versionId: string): Promise<PlanVersionRow | null> {
        const rows = await this.db
            .select()
            .from(planVersions)
            .where(eq(planVersions.id, versionId))
            .limit(1);
        return rows[0] ? this.versionRow(rows[0]) : null;
    }

    async findCurrentDraft(planKey: string): Promise<PlanVersionRow | null> {
        const rows = await this.db
            .select()
            .from(planVersions)
            .where(and(eq(planVersions.planId, planKey), isNull(planVersions.publishedAt)))
            .orderBy(desc(planVersions.version))
            .limit(1);
        return rows[0] ? this.versionRow(rows[0]) : null;
    }

    async findLatestLivePlanVersion(
        planKey: string,
        tx?: TransactionContext,
    ): Promise<PlanVersionRow | null> {
        const rows = await resolveDb(this.db, tx)
            .select()
            .from(planVersions)
            .where(
                and(
                    eq(planVersions.planId, planKey),
                    sql`${planVersions.publishedAt} IS NOT NULL`,
                    isNull(planVersions.supersededAt),
                    // A version the operator terminated is not live, whatever
                    // its supersession says: `terminate` sets `endsAt` without
                    // a successor to supersede it.
                    or(isNull(planVersions.endsAt), sql`${planVersions.endsAt} > NOW()`),
                ),
            )
            .orderBy(desc(planVersions.version))
            .limit(1);
        return rows[0] ? this.versionRow(rows[0]) : null;
    }

    /**
     * The version bookable at `asOf`: published, inside its validity window,
     * not terminated.
     *
     * `validUntil` is day-inclusive — a window that closes on the 28th is still
     * open at 23:59 on the 28th — which is why the comparison is against
     * `startOfUtcDay(asOf)` and not against `asOf`. The reading half of the
     * rule `previousUtcDay` writes in `publishWithin`; both come from
     * `@saasicat/core` so the two halves cannot drift apart.
     */
    private async activeVersionAt(
        planKey: string,
        asOf: Date,
        tx?: TransactionContext,
    ): Promise<PlanVersionRow | null> {
        const rows = await resolveDb(this.db, tx)
            .select()
            .from(planVersions)
            .where(
                and(
                    eq(planVersions.planId, planKey),
                    sql`${planVersions.publishedAt} IS NOT NULL`,
                    or(isNull(planVersions.validFrom), lte(planVersions.validFrom, asOf)),
                    or(
                        isNull(planVersions.validUntil),
                        gte(planVersions.validUntil, startOfUtcDay(asOf)),
                    ),
                    or(isNull(planVersions.endsAt), sql`${planVersions.endsAt} > ${asOf}`),
                ),
            )
            // `nulls last` so a version with no window loses to one that has a
            // window it is inside — the order adapter-prisma uses.
            .orderBy(sql`"validFrom" DESC NULLS LAST`, desc(planVersions.version))
            .limit(1);
        return rows[0] ? this.versionRow(rows[0]) : null;
    }

    async createPlanVersionDraft(data: CreatePlanVersionDraftData): Promise<PlanVersionRow> {
        const now = new Date();
        const latest = await this.db
            .select({ version: planVersions.version })
            .from(planVersions)
            .where(eq(planVersions.planId, data.planId))
            .orderBy(desc(planVersions.version))
            .limit(1);
        const rows = await this.db
            .insert(planVersions)
            .values({
                id: randomUUID(),
                planId: data.planId,
                version: (latest[0]?.version ?? 0) + 1,
                baseVersionId: data.baseVersionId ?? null,
                features: data.features,
                quotas: data.quotas,
                monthlyNet: data.monthlyNet,
                yearlyNet: data.yearlyNet,
                marketed: data.marketed ?? true,
                changeNote: data.changeNote ?? '',
                createdByUserId: data.createdByUserId ?? null,
                createdAt: now,
                updatedAt: now,
                // publishedAt stays null — this is a draft. `bundles` is
                // app-specific and has no column here, as in adapter-prisma.
                ...(this.validityWindows
                    ? {
                          validFrom: toNullableDate(data.validFrom),
                          validUntil: toNullableDate(data.validUntil),
                      }
                    : {}),
            })
            .returning();
        return this.versionRow(rows[0]);
    }

    async updatePlanVersionDraft(
        versionId: string,
        data: UpdatePlanVersionDraftData,
    ): Promise<PlanVersionRow> {
        const rows = await this.db
            .update(planVersions)
            .set({
                ...(data.features !== undefined ? { features: data.features } : {}),
                ...(data.quotas !== undefined ? { quotas: data.quotas } : {}),
                ...(data.monthlyNet !== undefined ? { monthlyNet: data.monthlyNet } : {}),
                ...(data.yearlyNet !== undefined ? { yearlyNet: data.yearlyNet } : {}),
                ...(data.marketed !== undefined ? { marketed: data.marketed } : {}),
                ...(data.changeNote !== undefined ? { changeNote: data.changeNote } : {}),
                ...(this.validityWindows && data.validFrom !== undefined
                    ? { validFrom: toNullableDate(data.validFrom) }
                    : {}),
                ...(this.validityWindows && data.validUntil !== undefined
                    ? { validUntil: toNullableDate(data.validUntil) }
                    : {}),
                updatedAt: new Date(),
            })
            // Only while it is still a draft. A published version is immutable
            // (contract protection P1), and an unconditional update by id would
            // rewrite one that was published between read and write.
            .where(and(eq(planVersions.id, versionId), isNull(planVersions.publishedAt)))
            .returning();
        if (!rows[0]) {
            throw new Error(`PlanVersion '${versionId}' not found or already published.`);
        }
        return this.versionRow(rows[0]);
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
        if (tx !== undefined)
            return this.publishWithin(resolveDb(this.db, tx), versionId, publishMeta);
        // Both writes or neither: together they are what "exactly one live
        // version" means.
        return this.db.transaction((transaction) =>
            this.publishWithin(transaction as unknown as DrizzleClient, versionId, publishMeta),
        );
    }

    private async publishWithin(
        db: DrizzleClient,
        versionId: string,
        publishMeta: {
            publishedByUserId: string | null;
            publishedChanges: VersionChange[];
            nonRegressive: boolean;
            validFrom: Date;
            validUntil: Date | null;
        },
    ): Promise<PlanVersionRow> {
        const now = new Date();
        // Claim the draft first, and only while it IS one — the same ordering
        // and the same reason as `DrizzleBundleRepository.publishWithin`:
        // superseding first lets two concurrent publications of one draft each
        // do half the work and leave a gap or an overlap behind.
        const publishedRows = await db
            .update(planVersions)
            .set({
                publishedAt: now,
                publishedByUserId: publishMeta.publishedByUserId,
                publishedChanges: publishMeta.publishedChanges,
                nonRegressive: publishMeta.nonRegressive,
                updatedAt: now,
                ...(this.validityWindows
                    ? { validFrom: publishMeta.validFrom, validUntil: publishMeta.validUntil }
                    : {}),
            })
            .where(and(eq(planVersions.id, versionId), isNull(planVersions.publishedAt)))
            .returning();
        if (!publishedRows[0]) {
            throw new Error(`PlanVersion '${versionId}' not found or already published.`);
        }

        await db
            .update(planVersions)
            .set(
                this.validityWindows
                    ? {
                          supersededAt: now,
                          validUntil: previousUtcDay(publishMeta.validFrom),
                          updatedAt: now,
                      }
                    : { supersededAt: now, updatedAt: now },
            )
            .where(
                and(
                    eq(planVersions.planId, publishedRows[0].planId),
                    sql`${planVersions.publishedAt} IS NOT NULL`,
                    isNull(planVersions.supersededAt),
                    ne(planVersions.id, versionId),
                ),
            );

        return this.versionRow(publishedRows[0]);
    }

    async deletePlanVersionDraft(versionId: string): Promise<void> {
        // Conditional on the row still being a draft, and the answer read from
        // what the DELETE matched rather than from a SELECT before it: a
        // publish committing in between would otherwise have its version
        // deleted.
        const deleted = await this.db
            .delete(planVersions)
            .where(and(eq(planVersions.id, versionId), isNull(planVersions.publishedAt)))
            .returning({ id: planVersions.id });
        if (deleted.length > 0) return;
        const existing = await this.db
            .select({ publishedAt: planVersions.publishedAt })
            .from(planVersions)
            .where(eq(planVersions.id, versionId))
            .limit(1);
        // Already gone is a no-op; still there means it is published.
        if (existing[0]) {
            throw new Error(
                `PlanVersion '${versionId}' is already published and cannot be discarded ` +
                    '(published versions are immutable — contract protection P1).',
            );
        }
    }

    async terminate(versionId: string, endsAt: Date): Promise<PlanVersionRow> {
        const rows = await this.db
            .update(planVersions)
            .set({ endsAt, updatedAt: new Date() })
            .where(eq(planVersions.id, versionId))
            .returning();
        if (!rows[0]) throw new Error(`PlanVersion '${versionId}' not found.`);
        return this.versionRow(rows[0]);
    }

    private versionRow(row: PlanVersionTableRow): PlanVersionRow {
        return toPlanVersionRow(row, row.planId, {
            validityWindows: this.validityWindows,
            // The canonical schema always has the column, so this adapter can
            // always answer the question — unlike a Prisma consumer whose
            // schema may predate it.
            endsAt: true,
        });
    }
}

function toNullableDate(value: string | null | undefined): Date | null {
    return value ? new Date(value) : null;
}
