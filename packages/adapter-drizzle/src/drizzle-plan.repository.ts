import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
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
import {
    catalogVersionAlreadyPublished,
    catalogDraftExists,
    catalogVersionGone,
    planKeyTaken,
    previousUtcDay,
    toPlanRow,
    toPlanVersionRow,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { ON_SALE_ORDER, onSaleAt } from './plan-version-on-sale.js';
import { plans, planVersions } from './schema.js';

type PlanVersionTableRow = typeof planVersions.$inferSelect;

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
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    // ─── Stem operations ───

    async list(filter: PlanListFilter): Promise<PlanRow[]> {
        const excludeDeleted = filter.excludeDeleted ?? true;
        const stems = await this.db
            .select()
            .from(plans)
            .where(and(...(excludeDeleted ? [isNull(plans.deletedAt)] : [])))
            .orderBy(asc(plans.sortOrder), asc(plans.planKey));
        if (!filter.onlyPublished) return stems.map(toPlanRow);
        if (stems.length === 0) return [];

        // A version carries the plan key, and a key names one plan for the
        // whole installation — so the version table answers directly.
        //
        // One query for all of them rather than one per plan: `onlyPublished`
        // is the marketing catalogue's filter and runs on every page load.
        const candidateKeys = [...new Set(stems.map((stem) => stem.planKey))];
        const live = await this.db
            .select({ planId: planVersions.planId })
            .from(planVersions)
            .where(
                and(
                    inArray(planVersions.planId, candidateKeys),
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

    /**
     * Whether this installation already uses this plan key — **including
     * retired plans**.
     *
     * `plans_planKey_key` is unconditional, so a soft delete does not free the
     * key, and the duplicate check in `createPlan` needs the database's answer
     * rather than the active catalogue's. `list` is that other lookup.
     */
    async findByKey(planKey: string): Promise<PlanRow | null> {
        const rows = await this.db.select().from(plans).where(eq(plans.planKey, planKey)).limit(1);
        return rows[0] ? toPlanRow(rows[0]) : null;
    }

    async create(data: CreatePlanData): Promise<PlanRow> {
        const now = new Date();
        const rows = await this.db
            .insert(plans)
            .values({
                id: randomUUID(),
                planKey: data.planKey,
                label: data.label,
                description: data.description ?? null,
                icon: data.icon ?? null,
                sortOrder: data.sortOrder ?? 0,
                createdAt: now,
                updatedAt: now,
            })
            // A key taken by a create that raced past the platform's check is
            // refused, and a caller's transaction stays usable. On the key
            // alone: a unique index of the application's own is its to report.
            .onConflictDoNothing({ target: plans.planKey })
            .returning();
        if (!rows[0]) throw planKeyTaken(data.planKey);
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

    /**
     * `tx` is beyond what the port asks for, and is what keeps a caller already
     * inside a transaction on its own connection: drawing a second one waits
     * for a connection that transaction is itself holding, which on a
     * one-connection pool never returns.
     */
    async findVersionById(
        versionId: string,
        tx?: TransactionContext,
    ): Promise<PlanVersionRow | null> {
        const rows = await resolveDb(this.db, tx)
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
                    // a successor to supersede it. Compared with the
                    // application's clock, which wrote it: the database's
                    // `NOW()` reads the column in the session's zone.
                    or(isNull(planVersions.endsAt), gt(planVersions.endsAt, new Date())),
                ),
            )
            .orderBy(desc(planVersions.version))
            .limit(1);
        return rows[0] ? this.versionRow(rows[0]) : null;
    }

    /** The version on sale at `asOf`: published, inside its validity window, not ended. */
    async findActivePlanVersion(
        planKey: string,
        asOf: Date = new Date(),
        tx?: TransactionContext,
    ): Promise<PlanVersionRow | null> {
        const rows = await resolveDb(this.db, tx)
            .select()
            .from(planVersions)
            .where(and(eq(planVersions.planId, planKey), onSaleAt(asOf)))
            .orderBy(...ON_SALE_ORDER)
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
        const nextVersion = (latest[0]?.version ?? 0) + 1;
        const rows = await this.db
            .insert(planVersions)
            .values({
                id: randomUUID(),
                planId: data.planId,
                version: nextVersion,
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
                validFrom: toNullableDate(data.validFrom),
                validUntil: toNullableDate(data.validUntil),
            })
            // On the one-draft-per-plan index and on the version number: a
            // draft created in the meantime is refused.
            .onConflictDoNothing()
            .returning();
        if (!rows[0]) {
            // The version number can also have been taken by a draft published
            // a moment later; that reads as the draft it was, and asking again
            // succeeds.
            const draft = await this.findCurrentDraft(data.planId);
            throw catalogDraftExists('PlanVersion', data.planId, draft?.version ?? nextVersion);
        }
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
                ...(data.validFrom !== undefined
                    ? { validFrom: toNullableDate(data.validFrom) }
                    : {}),
                ...(data.validUntil !== undefined
                    ? { validUntil: toNullableDate(data.validUntil) }
                    : {}),
                updatedAt: new Date(),
            })
            // By id, and nothing else. Whether a version may be edited is the
            // service's decision, not this adapter's: `PlanVersionsService`
            // allows a *published* version that is latest-in-chain, binds no
            // subscription and whose `validFrom` is still in the future, so an
            // operator can correct a price before it takes effect. A
            // `publishedAt IS NULL` guard here reads like caution and is
            // actually a stricter contract than the port has — it made every
            // scheduled version uncorrectable through this adapter.
            .where(eq(planVersions.id, versionId))
            .returning();
        if (!rows[0]) {
            throw new Error(`PlanVersion '${versionId}' not found.`);
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
                validFrom: publishMeta.validFrom,
                validUntil: publishMeta.validUntil,
            })
            .where(and(eq(planVersions.id, versionId), isNull(planVersions.publishedAt)))
            .returning();
        if (!publishedRows[0]) {
            // Gone, or published by somebody else a moment ago; the caller is
            // told which, with the code the platform's own check would use.
            const existing = await db
                .select({ id: planVersions.id })
                .from(planVersions)
                .where(eq(planVersions.id, versionId))
                .limit(1);
            throw existing[0]
                ? catalogVersionAlreadyPublished('PlanVersion', versionId)
                : catalogVersionGone('PlanVersion', versionId);
        }

        await db
            .update(planVersions)
            .set({
                supersededAt: now,
                validUntil: previousUtcDay(publishMeta.validFrom),
                updatedAt: now,
            })
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
        if (existing[0]) throw catalogVersionAlreadyPublished('PlanVersion', versionId);
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
        return toPlanVersionRow(row, row.planId);
    }
}

function toNullableDate(value: string | null | undefined): Date | null {
    return value ? new Date(value) : null;
}
