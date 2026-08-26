import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type {
    BundleCompatibility,
    BundleListFilter,
    BundlePricingOverride,
    BundleRepository,
    BundleRow,
    BundleVersionRow,
    CatalogEntryI18n,
    CreateBundleData,
    CreateBundleVersionDraftData,
    FeatureKey,
    QuotaKey,
    TransactionContext,
    UpdateBundleData,
    UpdateBundleVersionDraftData,
    VersionChange,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { bundles, bundleVersions } from './schema.js';

type BundleTableRow = typeof bundles.$inferSelect;
type BundleVersionTableRow = typeof bundleVersions.$inferSelect;

/** Whether this adapter answers validity-window questions at all. */
export interface DrizzleBundleRepositoryOptions {
    /**
     * Opt-in, mirroring `adapter-prisma`. Without it a draft's `validFrom` and
     * `validUntil` are neither written nor returned, and `findActiveBundleVersion`
     * is not offered — the contract then gates that scenario off by capability
     * rather than failing it, which is the difference between a gap that is
     * visible and one that is silent.
     */
    validityWindows?: boolean;
}

/**
 * `BundleRepository` against the canonical `bundles` and `bundle_versions`.
 *
 * The catalogue half of bundle persistence: what may be sold, in which
 * versions, and from when. The booking half — what a tenant actually bought —
 * is `DrizzleSubscriptionBundleRepository`.
 *
 * Publishing supersedes the previous live version and, with validity windows
 * on, closes its window the day before the successor opens. Both statements go
 * through one transaction where the caller has not opened one: a superseded
 * predecessor with no successor is a bundle nobody can book, and a successor
 * beside an unsuperseded predecessor is two live versions at once.
 */
@Injectable()
export class DrizzleBundleRepository implements BundleRepository {
    private readonly validityWindows: boolean;

    constructor(
        @Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient,
        @Optional() options: DrizzleBundleRepositoryOptions = {},
    ) {
        this.validityWindows = options.validityWindows ?? false;
        // Assigned rather than declared, and only when promised. The port makes
        // this optional and callers test it for truth — the persistence
        // contract gates its whole validity-window scenario on
        // `!repository?.findActiveBundleVersion`. A method that exists and
        // answers from columns the adapter does not maintain would pass that
        // gate and then be wrong, which is worse than not being there.
        //
        // `in` stays true either way: a declared field is defined as
        // `undefined` under `useDefineForClassFields`, here as in
        // `adapter-prisma`. The two adapters agree, which is the point.
        if (this.validityWindows) {
            this.findActiveBundleVersion = (bundleId, asOf, tx) =>
                this.activeVersionAt(bundleId, asOf ?? new Date(), tx);
        }
    }

    readonly findActiveBundleVersion?: (
        bundleId: string,
        asOf?: Date,
        tx?: TransactionContext,
    ) => Promise<BundleVersionRow | null>;

    // ─── Stems ───

    async list(filter: BundleListFilter): Promise<BundleRow[]> {
        const excludeDeleted = filter.excludeDeleted ?? true;
        const rows = await this.db
            .select()
            .from(bundles)
            .where(
                excludeDeleted
                    ? and(eq(bundles.projectKey, filter.projectKey), isNull(bundles.deletedAt))
                    : eq(bundles.projectKey, filter.projectKey),
            )
            .orderBy(asc(bundles.sortOrder), asc(bundles.bundleKey));
        return rows.map(toBundleRow);
    }

    async findById(bundleId: string): Promise<BundleRow | null> {
        const rows = await this.db.select().from(bundles).where(eq(bundles.id, bundleId)).limit(1);
        return rows[0] ? toBundleRow(rows[0]) : null;
    }

    async findByKey(projectKey: string, bundleKey: string): Promise<BundleRow | null> {
        const rows = await this.db
            .select()
            .from(bundles)
            .where(and(eq(bundles.projectKey, projectKey), eq(bundles.bundleKey, bundleKey)))
            .limit(1);
        return rows[0] ? toBundleRow(rows[0]) : null;
    }

    async create(data: CreateBundleData): Promise<BundleRow> {
        const now = new Date();
        const rows = await this.db
            .insert(bundles)
            .values({
                id: randomUUID(),
                projectKey: data.projectKey,
                bundleKey: data.bundleKey,
                label: data.label,
                description: data.description ?? null,
                icon: data.icon ?? null,
                sortOrder: data.sortOrder ?? 0,
                i18n: data.i18n ?? {},
                updatedAt: now,
            })
            .returning();
        return toBundleRow(rows[0]);
    }

    async update(bundleId: string, data: UpdateBundleData): Promise<BundleRow> {
        const patch: Partial<BundleTableRow> = { updatedAt: new Date() };
        if (data.label !== undefined) patch.label = data.label;
        if (data.description !== undefined) patch.description = data.description;
        if (data.icon !== undefined) patch.icon = data.icon;
        if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
        if (data.i18n !== undefined) patch.i18n = data.i18n;

        const rows = await this.db
            .update(bundles)
            .set(patch)
            .where(eq(bundles.id, bundleId))
            .returning();
        if (!rows[0]) throw new Error(`Bundle '${bundleId}' not found.`);
        return toBundleRow(rows[0]);
    }

    async softDelete(bundleId: string): Promise<void> {
        await this.db
            .update(bundles)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(bundles.id, bundleId));
    }

    // ─── Versions ───

    async listVersions(bundleId: string): Promise<BundleVersionRow[]> {
        const rows = await this.db
            .select()
            .from(bundleVersions)
            .where(eq(bundleVersions.bundleId, bundleId))
            .orderBy(asc(bundleVersions.version));
        const stem = await this.findById(bundleId);
        return rows.map((row) => this.toVersionRow(row, stem));
    }

    async findVersionById(
        versionId: string,
        tx?: TransactionContext,
    ): Promise<BundleVersionRow | null> {
        const rows = await resolveDb(this.db, tx)
            .select()
            .from(bundleVersions)
            .where(eq(bundleVersions.id, versionId))
            .limit(1);
        if (!rows[0]) return null;
        return this.toVersionRow(
            rows[0],
            await this.stemOn(resolveDb(this.db, tx), rows[0].bundleId),
        );
    }

    async findCurrentDraft(bundleId: string): Promise<BundleVersionRow | null> {
        const rows = await this.db
            .select()
            .from(bundleVersions)
            .where(and(eq(bundleVersions.bundleId, bundleId), isNull(bundleVersions.publishedAt)))
            .limit(1);
        if (!rows[0]) return null;
        return this.toVersionRow(rows[0], await this.findById(bundleId));
    }

    async findLatestLive(
        bundleId: string,
        tx?: TransactionContext,
    ): Promise<BundleVersionRow | null> {
        const rows = await resolveDb(this.db, tx)
            .select()
            .from(bundleVersions)
            .where(
                and(
                    eq(bundleVersions.bundleId, bundleId),
                    sql`${bundleVersions.publishedAt} IS NOT NULL`,
                    isNull(bundleVersions.supersededAt),
                ),
            )
            .orderBy(desc(bundleVersions.version))
            .limit(1);
        if (!rows[0]) return null;
        return this.toVersionRow(rows[0], await this.stemOn(resolveDb(this.db, tx), bundleId));
    }

    /**
     * The version bookable at `asOf`: published, inside its validity window.
     *
     * Deliberately not filtered by `supersededAt` — a superseded predecessor is
     * still the bookable one until its window closes, which is the whole point
     * of auto-succession. `validUntil` is day-inclusive, so a version is active
     * throughout its last day.
     */
    private async activeVersionAt(
        bundleId: string,
        asOf: Date,
        tx?: TransactionContext,
    ): Promise<BundleVersionRow | null> {
        const dayStart = new Date(asOf);
        dayStart.setUTCHours(0, 0, 0, 0);
        const rows = await resolveDb(this.db, tx)
            .select()
            .from(bundleVersions)
            .where(
                and(
                    eq(bundleVersions.bundleId, bundleId),
                    sql`${bundleVersions.publishedAt} IS NOT NULL`,
                    or(isNull(bundleVersions.validFrom), lte(bundleVersions.validFrom, asOf)),
                    or(isNull(bundleVersions.validUntil), gte(bundleVersions.validUntil, dayStart)),
                ),
            )
            // `nulls last` so a version with no window loses to one that has a
            // window it is inside — the same order adapter-prisma uses.
            .orderBy(sql`"validFrom" DESC NULLS LAST`, desc(bundleVersions.version))
            .limit(1);
        if (!rows[0]) return null;
        return this.toVersionRow(rows[0], await this.stemOn(resolveDb(this.db, tx), bundleId));
    }

    async createDraft(data: CreateBundleVersionDraftData): Promise<BundleVersionRow> {
        const existingDraft = await this.findCurrentDraft(data.bundleId);
        if (existingDraft) {
            throw new Error(
                `Bundle '${data.bundleId}' already has a draft version (v${existingDraft.version}); ` +
                    'only one draft per bundle is allowed.',
            );
        }
        const latest = await this.db
            .select({ version: bundleVersions.version })
            .from(bundleVersions)
            .where(eq(bundleVersions.bundleId, data.bundleId))
            .orderBy(desc(bundleVersions.version))
            .limit(1);
        const now = new Date();
        const rows = await this.db
            .insert(bundleVersions)
            .values({
                id: randomUUID(),
                bundleId: data.bundleId,
                version: latest[0] ? latest[0].version + 1 : 1,
                baseVersionId: data.baseVersionId ?? null,
                features: data.features,
                quotas: data.quotas ?? {},
                compatibility: data.compatibility ?? {},
                pricingOverrides: data.pricingOverrides ?? [],
                monthlyNet: data.monthlyNet ?? null,
                yearlyNet: data.yearlyNet ?? null,
                marketed: data.marketed ?? true,
                changeNote: data.changeNote ?? '',
                createdByUserId: data.createdByUserId ?? null,
                validFrom: this.validityWindows ? toNullableDate(data.validFrom) : null,
                validUntil: this.validityWindows ? toNullableDate(data.validUntil) : null,
                updatedAt: now,
            })
            .returning();
        return this.toVersionRow(rows[0], await this.findById(data.bundleId));
    }

    async updateDraft(
        versionId: string,
        data: UpdateBundleVersionDraftData,
    ): Promise<BundleVersionRow> {
        const patch: Partial<BundleVersionTableRow> = { updatedAt: new Date() };
        if (data.features !== undefined) patch.features = data.features;
        if (data.quotas !== undefined) patch.quotas = data.quotas;
        if (data.compatibility !== undefined) patch.compatibility = data.compatibility;
        if (data.pricingOverrides !== undefined) patch.pricingOverrides = data.pricingOverrides;
        if (data.monthlyNet !== undefined) patch.monthlyNet = data.monthlyNet;
        if (data.yearlyNet !== undefined) patch.yearlyNet = data.yearlyNet;
        if (data.marketed !== undefined) patch.marketed = data.marketed;
        if (data.changeNote !== undefined) patch.changeNote = data.changeNote;
        if (this.validityWindows) {
            if (data.validFrom !== undefined) patch.validFrom = toNullableDate(data.validFrom);
            if (data.validUntil !== undefined) patch.validUntil = toNullableDate(data.validUntil);
        }

        const rows = await this.db
            .update(bundleVersions)
            .set(patch)
            .where(eq(bundleVersions.id, versionId))
            .returning();
        if (!rows[0]) throw new Error(`BundleVersion '${versionId}' not found.`);
        return this.toVersionRow(rows[0], await this.findById(rows[0].bundleId));
    }

    async publishDraft(
        versionId: string,
        publishMeta: {
            publishedByUserId: string | null;
            publishedChanges: VersionChange[];
            nonRegressive: boolean;
            validFrom: Date;
            validUntil: Date | null;
        },
        tx?: TransactionContext,
    ): Promise<BundleVersionRow> {
        if (tx !== undefined)
            return this.publishWithin(resolveDb(this.db, tx), versionId, publishMeta);
        // Both writes or neither: the two statements together are what
        // "exactly one live version" means.
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
    ): Promise<BundleVersionRow> {
        const draftRows = await db
            .select()
            .from(bundleVersions)
            .where(eq(bundleVersions.id, versionId))
            .limit(1);
        const draft = draftRows[0];
        if (!draft) throw new Error(`BundleVersion '${versionId}' not found.`);

        const now = new Date();
        await db
            .update(bundleVersions)
            .set(
                this.validityWindows
                    ? { supersededAt: now, validUntil: previousUtcDay(publishMeta.validFrom) }
                    : { supersededAt: now },
            )
            .where(
                and(
                    eq(bundleVersions.bundleId, draft.bundleId),
                    sql`${bundleVersions.publishedAt} IS NOT NULL`,
                    isNull(bundleVersions.supersededAt),
                    ne(bundleVersions.id, versionId),
                ),
            );

        const publishedRows = await db
            .update(bundleVersions)
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
            .where(eq(bundleVersions.id, versionId))
            .returning();

        const stemRows = await db
            .select()
            .from(bundles)
            .where(eq(bundles.id, draft.bundleId))
            .limit(1);
        return this.toVersionRow(publishedRows[0], stemRows[0] ? toBundleRow(stemRows[0]) : null);
    }

    async deleteDraft(versionId: string): Promise<void> {
        const rows = await this.db
            .select({ publishedAt: bundleVersions.publishedAt })
            .from(bundleVersions)
            .where(eq(bundleVersions.id, versionId))
            .limit(1);
        if (!rows[0]) return;
        if (rows[0].publishedAt !== null) {
            throw new Error(
                `BundleVersion '${versionId}' is already published and cannot be discarded ` +
                    '(published versions are immutable — contract protection P1).',
            );
        }
        await this.db.delete(bundleVersions).where(eq(bundleVersions.id, versionId));
    }

    /**
     * The stem, read on the connection the caller is already holding.
     *
     * `this.db` would take a second one from the pool. Inside a transaction —
     * which is where `enforceLimit()` calls this, holding a row lock — that
     * second connection can only be released when the transaction ends, and the
     * transaction cannot end until this query returns. With a small pool, or
     * enough concurrent checks to occupy it, entitlement resolution stops
     * dead. A version query that honours `tx` and a stem query beside it that
     * does not is the shape that hides it: the deadlock needs load to appear.
     */
    private async stemOn(db: DrizzleClient, bundleId: string): Promise<BundleRow | null> {
        const rows = await db.select().from(bundles).where(eq(bundles.id, bundleId)).limit(1);
        return rows[0] ? toBundleRow(rows[0]) : null;
    }

    private toVersionRow(row: BundleVersionTableRow, stem: BundleRow | null): BundleVersionRow {
        return {
            id: row.id,
            bundleId: row.bundleId,
            bundleKey: stem?.bundleKey ?? '',
            label: stem?.label ?? '',
            version: row.version,
            baseVersionId: row.baseVersionId,
            features: (row.features ?? []) as FeatureKey[],
            quotas: (row.quotas ?? {}) as Record<QuotaKey, number>,
            compatibility: (row.compatibility ?? {}) as BundleCompatibility,
            pricingOverrides: (row.pricingOverrides ?? []) as BundlePricingOverride[],
            monthlyNet: row.monthlyNet,
            yearlyNet: row.yearlyNet,
            marketed: row.marketed,
            publishedAt: toIso(row.publishedAt),
            supersededAt: toIso(row.supersededAt),
            publishedChanges: Array.isArray(row.publishedChanges)
                ? (row.publishedChanges as VersionChange[])
                : null,
            changeNote: row.changeNote,
            nonRegressive: row.nonRegressive,
            // Null rather than the stored value where the adapter does not
            // promise windows: returning a date it does not maintain would
            // invite a caller to trust it.
            validFrom: this.validityWindows ? toIso(row.validFrom) : null,
            validUntil: this.validityWindows ? toIso(row.validUntil) : null,
            createdByUserId: row.createdByUserId,
            publishedByUserId: row.publishedByUserId,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        };
    }
}

function toBundleRow(row: BundleTableRow): BundleRow {
    return {
        id: row.id,
        projectKey: row.projectKey,
        bundleKey: row.bundleKey,
        label: row.label,
        description: row.description,
        icon: row.icon,
        sortOrder: row.sortOrder,
        i18n: (row.i18n ?? {}) as CatalogEntryI18n,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: toIso(row.deletedAt),
    };
}

function toIso(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

function toNullableDate(value: string | null | undefined): Date | null {
    return value ? new Date(value) : null;
}

/** A window closes the day before its successor opens. */
function previousUtcDay(value: Date): Date {
    const result = new Date(value);
    result.setUTCDate(result.getUTCDate() - 1);
    return result;
}
