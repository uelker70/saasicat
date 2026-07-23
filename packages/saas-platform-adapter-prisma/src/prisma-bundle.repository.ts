import { Inject, Injectable } from '@nestjs/common';
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
    TransactionContext,
    UpdateBundleData,
    UpdateBundleVersionDraftData,
    VersionChange,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type DecimalLike,
    type PrismaLike,
    type PrismaModelDelegateLike,
} from './prisma-client-token.js';
import { resolveClient, toQuotaMap, toStringArray } from './tx.js';

/** DB columns this repository reads from `bundles`. */
interface BundleDbRow {
    id: string;
    projectKey: string;
    bundleKey: string;
    label: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    i18n: unknown;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

/** DB columns this repository reads from `bundle_versions`. */
interface BundleVersionDbRow {
    id: string;
    bundleId: string;
    version: number;
    baseVersionId: string | null;
    features: unknown;
    quotas: unknown;
    compatibility: unknown;
    pricingOverrides: unknown;
    monthlyNet: DecimalLike | null;
    yearlyNet: DecimalLike | null;
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
interface BundlePrisma {
    bundle: PrismaModelDelegateLike<BundleDbRow>;
    bundleVersion: PrismaModelDelegateLike<BundleVersionDbRow>;
}

/**
 * `BundleRepository` against the canonical `bundles` + `bundle_versions`
 * tables (SPEC_V2 §5 + §11.1 M3). Versioning mirrors `PlanVersion`: at most one
 * draft (`publishedAt IS NULL`) per bundle, monotonically incrementing
 * `version`, `supersededAt` marking the previous live version on publish.
 *
 * Divergence from time-aware consumer schemas: the canonical `bundle_versions`
 * table carries **no** `validFrom`/`validUntil` columns. The `BundleVersionRow`
 * therefore always reports both as `null`, and the `validFrom`/`validUntil`
 * inputs on the Create/Update DTOs and on `publishDraft`'s `publishMeta` are
 * accepted (to satisfy the port signature) but not persisted — consistent with
 * `PrismaPlanVersionRepository`, which documents the same schema gap.
 *
 * Atomicity of `publishDraft` (supersede-previous + publish-draft) is delegated
 * to the caller's `TransactionContext`, following the package convention that
 * repositories never open their own `$transaction`.
 */
@Injectable()
export class PrismaBundleRepository implements BundleRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    private db(tx?: TransactionContext): BundlePrisma {
        return resolveClient(this.prisma, tx) as unknown as BundlePrisma;
    }

    // ─── Stem operations ───

    async list(filter: BundleListFilter): Promise<BundleRow[]> {
        const excludeDeleted = filter.excludeDeleted ?? true;
        const rows = await this.db().bundle.findMany({
            where: {
                projectKey: filter.projectKey,
                ...(excludeDeleted ? { deletedAt: null } : {}),
            },
            orderBy: [{ sortOrder: 'asc' }, { bundleKey: 'asc' }],
        });
        return rows.map(toBundleRow);
    }

    async findById(bundleId: string): Promise<BundleRow | null> {
        const row = await this.db().bundle.findUnique({ where: { id: bundleId } });
        return row ? toBundleRow(row) : null;
    }

    async findByKey(projectKey: string, bundleKey: string): Promise<BundleRow | null> {
        const row = await this.db().bundle.findFirst({
            where: { projectKey, bundleKey, deletedAt: null },
        });
        return row ? toBundleRow(row) : null;
    }

    async create(data: CreateBundleData): Promise<BundleRow> {
        const created = await this.db().bundle.create({
            data: {
                projectKey: data.projectKey,
                bundleKey: data.bundleKey,
                label: data.label,
                description: data.description ?? null,
                icon: data.icon ?? null,
                sortOrder: data.sortOrder ?? 0,
                i18n: data.i18n ?? {},
            },
        });
        return toBundleRow(created);
    }

    async update(bundleId: string, data: UpdateBundleData): Promise<BundleRow> {
        const updated = await this.db().bundle.update({
            where: { id: bundleId },
            data: {
                ...(data.label !== undefined ? { label: data.label } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.icon !== undefined ? { icon: data.icon } : {}),
                ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
                ...(data.i18n !== undefined ? { i18n: data.i18n } : {}),
            },
        });
        return toBundleRow(updated);
    }

    async softDelete(bundleId: string): Promise<void> {
        await this.db().bundle.update({
            where: { id: bundleId },
            data: { deletedAt: new Date() },
        });
    }

    // ─── Version operations ───

    async listVersions(bundleId: string): Promise<BundleVersionRow[]> {
        const bundle = await this.db().bundle.findUnique({ where: { id: bundleId } });
        if (!bundle) return [];
        const rows = await this.db().bundleVersion.findMany({
            where: { bundleId },
            orderBy: { version: 'asc' },
        });
        return rows.map((row) => toBundleVersionRow(row, bundle));
    }

    async findVersionById(versionId: string): Promise<BundleVersionRow | null> {
        const row = await this.db().bundleVersion.findUnique({ where: { id: versionId } });
        if (!row) return null;
        const bundle = await this.db().bundle.findUnique({ where: { id: row.bundleId } });
        return toBundleVersionRow(row, bundle);
    }

    async findCurrentDraft(bundleId: string): Promise<BundleVersionRow | null> {
        const row = await this.db().bundleVersion.findFirst({
            where: { bundleId, publishedAt: null },
        });
        if (!row) return null;
        const bundle = await this.db().bundle.findUnique({ where: { id: bundleId } });
        return toBundleVersionRow(row, bundle);
    }

    async findLatestLive(
        bundleId: string,
        tx?: TransactionContext,
    ): Promise<BundleVersionRow | null> {
        const db = this.db(tx);
        const row = await db.bundleVersion.findFirst({
            where: { bundleId, publishedAt: { not: null }, supersededAt: null },
            orderBy: { version: 'desc' },
        });
        if (!row) return null;
        const bundle = await db.bundle.findUnique({ where: { id: bundleId } });
        return toBundleVersionRow(row, bundle);
    }

    async createDraft(data: CreateBundleVersionDraftData): Promise<BundleVersionRow> {
        const db = this.db();
        const existingDraft = await db.bundleVersion.findFirst({
            where: { bundleId: data.bundleId, publishedAt: null },
        });
        if (existingDraft) {
            throw new Error(
                `Bundle '${data.bundleId}' already has a draft version (v${existingDraft.version}); ` +
                    'only one draft per bundle is allowed.',
            );
        }
        const latest = await db.bundleVersion.findFirst({
            where: { bundleId: data.bundleId },
            orderBy: { version: 'desc' },
        });
        const nextVersion = latest ? latest.version + 1 : 1;

        const created = await db.bundleVersion.create({
            data: {
                bundleId: data.bundleId,
                version: nextVersion,
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
            },
        });
        const bundle = await db.bundle.findUnique({ where: { id: data.bundleId } });
        return toBundleVersionRow(created, bundle);
    }

    async updateDraft(
        versionId: string,
        data: UpdateBundleVersionDraftData,
    ): Promise<BundleVersionRow> {
        const db = this.db();
        const updated = await db.bundleVersion.update({
            where: { id: versionId },
            data: {
                ...(data.features !== undefined ? { features: data.features } : {}),
                ...(data.quotas !== undefined ? { quotas: data.quotas } : {}),
                ...(data.compatibility !== undefined ? { compatibility: data.compatibility } : {}),
                ...(data.pricingOverrides !== undefined
                    ? { pricingOverrides: data.pricingOverrides }
                    : {}),
                ...(data.monthlyNet !== undefined ? { monthlyNet: data.monthlyNet } : {}),
                ...(data.yearlyNet !== undefined ? { yearlyNet: data.yearlyNet } : {}),
                ...(data.marketed !== undefined ? { marketed: data.marketed } : {}),
                ...(data.changeNote !== undefined ? { changeNote: data.changeNote } : {}),
            },
        });
        const bundle = await db.bundle.findUnique({ where: { id: updated.bundleId } });
        return toBundleVersionRow(updated, bundle);
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
        const db = this.db(tx);
        const draft = await db.bundleVersion.findUnique({ where: { id: versionId } });
        if (!draft) {
            throw new Error(`BundleVersion '${versionId}' not found.`);
        }

        await db.bundleVersion.updateMany({
            where: {
                bundleId: draft.bundleId,
                publishedAt: { not: null },
                supersededAt: null,
                NOT: { id: versionId },
            },
            data: { supersededAt: new Date() },
        });

        const published = await db.bundleVersion.update({
            where: { id: versionId },
            data: {
                publishedAt: new Date(),
                publishedByUserId: publishMeta.publishedByUserId,
                publishedChanges: publishMeta.publishedChanges,
                nonRegressive: publishMeta.nonRegressive,
            },
        });
        const bundle = await db.bundle.findUnique({ where: { id: published.bundleId } });
        return toBundleVersionRow(published, bundle);
    }

    async deleteDraft(versionId: string): Promise<void> {
        const db = this.db();
        const row = await db.bundleVersion.findUnique({ where: { id: versionId } });
        if (!row) return;
        if (row.publishedAt !== null) {
            throw new Error(
                `BundleVersion '${versionId}' is already published and cannot be discarded ` +
                    '(published versions are immutable — contract protection P1).',
            );
        }
        try {
            await db.bundleVersion.delete({ where: { id: versionId } });
        } catch (err) {
            // Concurrent discard already removed the row — treat as a no-op.
            if ((err as { code?: string } | null)?.code === 'P2025') return;
            throw err;
        }
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toDecimalString(value: DecimalLike | null): string | null {
    return value == null ? null : value.toString();
}

function toVersionChanges(value: unknown): VersionChange[] | null {
    return Array.isArray(value) ? (value as VersionChange[]) : null;
}

function toCompatibility(value: unknown): BundleCompatibility {
    return isPlainObject(value) ? (value as BundleCompatibility) : {};
}

function toPricingOverrides(value: unknown): BundlePricingOverride[] {
    return Array.isArray(value) ? (value as BundlePricingOverride[]) : [];
}

function toI18n(value: unknown): CatalogEntryI18n {
    return isPlainObject(value) ? (value as CatalogEntryI18n) : {};
}

function toBundleRow(row: BundleDbRow): BundleRow {
    return {
        id: row.id,
        projectKey: row.projectKey,
        bundleKey: row.bundleKey,
        label: row.label,
        description: row.description,
        icon: row.icon,
        sortOrder: row.sortOrder,
        i18n: toI18n(row.i18n),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt?.toISOString() ?? null,
    };
}

function toBundleVersionRow(row: BundleVersionDbRow, bundle: BundleDbRow | null): BundleVersionRow {
    return {
        id: row.id,
        bundleId: row.bundleId,
        bundleKey: bundle?.bundleKey ?? '',
        label: bundle?.label ?? '',
        version: row.version,
        baseVersionId: row.baseVersionId,
        features: toStringArray(row.features),
        quotas: toQuotaMap(row.quotas),
        compatibility: toCompatibility(row.compatibility),
        pricingOverrides: toPricingOverrides(row.pricingOverrides),
        monthlyNet: toDecimalString(row.monthlyNet),
        yearlyNet: toDecimalString(row.yearlyNet),
        marketed: row.marketed,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        supersededAt: row.supersededAt?.toISOString() ?? null,
        // The canonical `bundle_versions` table has no validFrom/validUntil
        // columns; time-aware validity is not expressible on this schema.
        validFrom: null,
        validUntil: null,
        publishedChanges: toVersionChanges(row.publishedChanges),
        changeNote: row.changeNote,
        nonRegressive: row.nonRegressive,
        createdByUserId: row.createdByUserId,
        publishedByUserId: row.publishedByUserId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
