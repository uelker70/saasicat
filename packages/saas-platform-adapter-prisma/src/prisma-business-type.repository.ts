import { Inject, Injectable } from '@nestjs/common';
import type {
    BusinessTypeBundleInput,
    BusinessTypeBundleRow,
    BusinessTypeListFilter,
    BusinessTypeRepository,
    BusinessTypeRow,
    BusinessTypeVersionRow,
    CreateBusinessTypeData,
    CreateBusinessTypeVersionDraftData,
    TransactionContext,
    UpdateBusinessTypeData,
    UpdateBusinessTypeVersionDraftData,
    VersionChange,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type DecimalLike,
    type PrismaLike,
    type PrismaModelDelegateLike,
} from './prisma-client-token.js';
import { resolveClient, toQuotaMap } from './tx.js';

// DB columns this repository reads from `business_types`.
interface BusinessTypeDbRow {
    id: string;
    projectKey: string;
    businessTypeKey: string;
    label: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

// DB columns this repository reads from `business_type_versions`.
interface BusinessTypeVersionDbRow {
    id: string;
    businessTypeId: string;
    version: number;
    baseVersionId: string | null;
    quotaOverrides: unknown;
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

// DB columns this repository reads from the `business_type_bundles` junction.
interface BusinessTypeBundleDbRow {
    businessTypeVersionId: string;
    bundleVersionId: string;
    sortOrder: number;
}

// Denormalization sources: the concrete `bundle_versions` row (version number +
// its master id) and the `bundles` master (key + label) it belongs to.
interface BundleVersionDbRow {
    id: string;
    bundleId: string;
    version: number;
}

interface BundleDbRow {
    id: string;
    bundleKey: string;
    label: string;
}

/** Narrow view of the injected client used by this repository. */
interface BusinessTypePrisma {
    businessType: PrismaModelDelegateLike<BusinessTypeDbRow>;
    businessTypeVersion: PrismaModelDelegateLike<BusinessTypeVersionDbRow>;
    businessTypeBundle: PrismaModelDelegateLike<BusinessTypeBundleDbRow>;
    bundleVersion: PrismaModelDelegateLike<BundleVersionDbRow>;
    bundle: PrismaModelDelegateLike<BundleDbRow>;
}

/**
 * `BusinessTypeRepository` against the canonical `business_types`,
 * `business_type_versions` and `business_type_bundles` tables.
 *
 * Like `BundleRepository`: at most one draft per `businessTypeId`;
 * `publishDraft` supersedes the previously live version. The `bundles`
 * composition (junction rows pinning concrete `BundleVersion`s) is written
 * atomically together with each version. Junction rows are enriched with the
 * denormalized bundle key/label/version via explicit follow-up queries — the
 * adapter deliberately avoids Prisma `include` (see `prisma-client-token.ts`).
 */
@Injectable()
export class PrismaBusinessTypeRepository implements BusinessTypeRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    private db(tx?: TransactionContext): BusinessTypePrisma {
        return resolveClient(this.prisma, tx) as unknown as BusinessTypePrisma;
    }

    private runInTx<T>(work: (db: BusinessTypePrisma) => Promise<T>): Promise<T> {
        return this.prisma.$transaction((tx) => work(tx as unknown as BusinessTypePrisma));
    }

    // ─── Stem operations ───

    async list(filter: BusinessTypeListFilter): Promise<BusinessTypeRow[]> {
        const excludeDeleted = filter.excludeDeleted ?? true;
        const rows = await this.db().businessType.findMany({
            where: {
                projectKey: filter.projectKey,
                ...(excludeDeleted ? { deletedAt: null } : {}),
            },
            orderBy: [{ sortOrder: 'asc' }, { businessTypeKey: 'asc' }],
        });
        return rows.map(toTypeRow);
    }

    async findById(businessTypeId: string): Promise<BusinessTypeRow | null> {
        const row = await this.db().businessType.findUnique({ where: { id: businessTypeId } });
        return row ? toTypeRow(row) : null;
    }

    async findByKey(projectKey: string, businessTypeKey: string): Promise<BusinessTypeRow | null> {
        const row = await this.db().businessType.findFirst({
            where: { projectKey, businessTypeKey, deletedAt: null },
        });
        return row ? toTypeRow(row) : null;
    }

    async create(data: CreateBusinessTypeData): Promise<BusinessTypeRow> {
        const created = await this.db().businessType.create({
            data: {
                projectKey: data.projectKey,
                businessTypeKey: data.businessTypeKey,
                label: data.label,
                description: data.description ?? null,
                icon: data.icon ?? null,
                sortOrder: data.sortOrder ?? 0,
            },
        });
        return toTypeRow(created);
    }

    async update(businessTypeId: string, data: UpdateBusinessTypeData): Promise<BusinessTypeRow> {
        const updated = await this.db().businessType.update({
            where: { id: businessTypeId },
            data: {
                ...(data.label !== undefined ? { label: data.label } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.icon !== undefined ? { icon: data.icon } : {}),
                ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
            },
        });
        return toTypeRow(updated);
    }

    async softDelete(businessTypeId: string): Promise<void> {
        await this.db().businessType.update({
            where: { id: businessTypeId },
            data: { deletedAt: new Date() },
        });
    }

    // ─── Version operations ───

    async listVersions(businessTypeId: string): Promise<BusinessTypeVersionRow[]> {
        const db = this.db();
        const rows = await db.businessTypeVersion.findMany({
            where: { businessTypeId },
            orderBy: { version: 'asc' },
        });
        return this.mapVersions(db, rows);
    }

    async findVersionById(versionId: string): Promise<BusinessTypeVersionRow | null> {
        const db = this.db();
        const row = await db.businessTypeVersion.findUnique({ where: { id: versionId } });
        return row ? this.mapVersion(db, row) : null;
    }

    async findCurrentDraft(businessTypeId: string): Promise<BusinessTypeVersionRow | null> {
        const db = this.db();
        const row = await db.businessTypeVersion.findFirst({
            where: { businessTypeId, publishedAt: null },
        });
        return row ? this.mapVersion(db, row) : null;
    }

    async findLatestLive(
        businessTypeId: string,
        tx?: TransactionContext,
    ): Promise<BusinessTypeVersionRow | null> {
        const db = this.db(tx);
        const row = await db.businessTypeVersion.findFirst({
            where: { businessTypeId, publishedAt: { not: null }, supersededAt: null },
            orderBy: { version: 'desc' },
        });
        return row ? this.mapVersion(db, row) : null;
    }

    async createDraft(data: CreateBusinessTypeVersionDraftData): Promise<BusinessTypeVersionRow> {
        return this.runInTx(async (db) => {
            const existingDraft = await db.businessTypeVersion.findFirst({
                where: { businessTypeId: data.businessTypeId, publishedAt: null },
            });
            if (existingDraft) {
                throw new Error(
                    `BusinessType '${data.businessTypeId}' already has a draft version ` +
                        `(v${existingDraft.version}); publish or discard it before creating another.`,
                );
            }
            const latest = await db.businessTypeVersion.findMany({
                where: { businessTypeId: data.businessTypeId },
                orderBy: { version: 'desc' },
                take: 1,
            });
            const nextVersion = latest.length === 0 ? 1 : latest[0].version + 1;

            const created = await db.businessTypeVersion.create({
                data: {
                    businessTypeId: data.businessTypeId,
                    version: nextVersion,
                    baseVersionId: data.baseVersionId ?? null,
                    quotaOverrides: data.quotaOverrides ?? {},
                    monthlyNet: data.monthlyNet ?? null,
                    yearlyNet: data.yearlyNet ?? null,
                    marketed: data.marketed ?? true,
                    changeNote: data.changeNote ?? '',
                    createdByUserId: data.createdByUserId ?? null,
                },
            });
            await this.replaceBundles(db, created.id, data.bundles);
            return this.mapVersion(db, created);
        });
    }

    async updateDraft(
        versionId: string,
        data: UpdateBusinessTypeVersionDraftData,
    ): Promise<BusinessTypeVersionRow> {
        return this.runInTx(async (db) => {
            if (data.bundles !== undefined) {
                await this.replaceBundles(db, versionId, data.bundles);
            }
            const updated = await db.businessTypeVersion.update({
                where: { id: versionId },
                data: {
                    ...(data.quotaOverrides !== undefined
                        ? { quotaOverrides: data.quotaOverrides }
                        : {}),
                    ...(data.monthlyNet !== undefined ? { monthlyNet: data.monthlyNet } : {}),
                    ...(data.yearlyNet !== undefined ? { yearlyNet: data.yearlyNet } : {}),
                    ...(data.marketed !== undefined ? { marketed: data.marketed } : {}),
                    ...(data.changeNote !== undefined ? { changeNote: data.changeNote } : {}),
                },
            });
            return this.mapVersion(db, updated);
        });
    }

    async publishDraft(
        versionId: string,
        publishMeta: {
            publishedByUserId: string | null;
            publishedChanges: VersionChange[];
            nonRegressive: boolean;
        },
        tx?: TransactionContext,
    ): Promise<BusinessTypeVersionRow> {
        const work = async (db: BusinessTypePrisma): Promise<BusinessTypeVersionRow> => {
            const draft = await db.businessTypeVersion.findUnique({ where: { id: versionId } });
            if (!draft) {
                throw new Error(`BusinessTypeVersion '${versionId}' not found.`);
            }
            await db.businessTypeVersion.updateMany({
                where: {
                    businessTypeId: draft.businessTypeId,
                    publishedAt: { not: null },
                    supersededAt: null,
                    NOT: { id: versionId },
                },
                data: { supersededAt: new Date() },
            });
            const published = await db.businessTypeVersion.update({
                where: { id: versionId },
                data: {
                    publishedAt: new Date(),
                    publishedByUserId: publishMeta.publishedByUserId,
                    publishedChanges: publishMeta.publishedChanges,
                    nonRegressive: publishMeta.nonRegressive,
                },
            });
            return this.mapVersion(db, published);
        };
        return tx ? work(this.db(tx)) : this.runInTx(work);
    }

    // ─── Internal helpers ───

    private async replaceBundles(
        db: BusinessTypePrisma,
        versionId: string,
        inputs: BusinessTypeBundleInput[],
    ): Promise<void> {
        await db.businessTypeBundle.deleteMany({ where: { businessTypeVersionId: versionId } });
        if (inputs.length === 0) return;
        await db.businessTypeBundle.createMany({
            data: inputs.map((bundle, index) => ({
                businessTypeVersionId: versionId,
                bundleVersionId: bundle.bundleVersionId,
                sortOrder: bundle.sortOrder ?? index,
            })),
        });
    }

    private async mapVersion(
        db: BusinessTypePrisma,
        row: BusinessTypeVersionDbRow,
    ): Promise<BusinessTypeVersionRow> {
        const [mapped] = await this.mapVersions(db, [row]);
        return mapped;
    }

    private async mapVersions(
        db: BusinessTypePrisma,
        rows: BusinessTypeVersionDbRow[],
    ): Promise<BusinessTypeVersionRow[]> {
        if (rows.length === 0) return [];
        const masterIds = [...new Set(rows.map((row) => row.businessTypeId))];
        const masters = await db.businessType.findMany({ where: { id: { in: masterIds } } });
        const masterById = new Map(masters.map((master) => [master.id, master]));
        const bundlesByVersion = await this.loadBundles(
            db,
            rows.map((row) => row.id),
        );
        return rows.map((row) =>
            toVersionRow(
                row,
                masterById.get(row.businessTypeId) ?? null,
                bundlesByVersion.get(row.id) ?? [],
            ),
        );
    }

    private async loadBundles(
        db: BusinessTypePrisma,
        versionIds: string[],
    ): Promise<Map<string, BusinessTypeBundleRow[]>> {
        const byVersion = new Map<string, BusinessTypeBundleRow[]>();
        if (versionIds.length === 0) return byVersion;

        const junctions = await db.businessTypeBundle.findMany({
            where: { businessTypeVersionId: { in: versionIds } },
            orderBy: { sortOrder: 'asc' },
        });
        if (junctions.length === 0) return byVersion;

        const bundleVersionIds = [
            ...new Set(junctions.map((junction) => junction.bundleVersionId)),
        ];
        const bundleVersions = await db.bundleVersion.findMany({
            where: { id: { in: bundleVersionIds } },
        });
        const bundleVersionById = new Map(bundleVersions.map((version) => [version.id, version]));

        const bundleIds = [...new Set(bundleVersions.map((version) => version.bundleId))];
        const bundles = await db.bundle.findMany({ where: { id: { in: bundleIds } } });
        const bundleById = new Map(bundles.map((bundle) => [bundle.id, bundle]));

        for (const junction of junctions) {
            const bundleVersion = bundleVersionById.get(junction.bundleVersionId);
            const bundle = bundleVersion ? bundleById.get(bundleVersion.bundleId) : undefined;
            if (!bundleVersion || !bundle) {
                throw new Error(
                    `BusinessTypeBundle references missing BundleVersion '${junction.bundleVersionId}'.`,
                );
            }
            const entry: BusinessTypeBundleRow = {
                bundleVersionId: junction.bundleVersionId,
                bundleKey: bundle.bundleKey,
                bundleLabel: bundle.label,
                bundleVersion: bundleVersion.version,
                sortOrder: junction.sortOrder,
            };
            const existing = byVersion.get(junction.businessTypeVersionId);
            if (existing) existing.push(entry);
            else byVersion.set(junction.businessTypeVersionId, [entry]);
        }
        return byVersion;
    }
}

function toTypeRow(row: BusinessTypeDbRow): BusinessTypeRow {
    return {
        id: row.id,
        projectKey: row.projectKey,
        businessTypeKey: row.businessTypeKey,
        label: row.label,
        description: row.description,
        icon: row.icon,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
}

function toVersionRow(
    row: BusinessTypeVersionDbRow,
    master: BusinessTypeDbRow | null,
    bundles: BusinessTypeBundleRow[],
): BusinessTypeVersionRow {
    return {
        id: row.id,
        businessTypeId: row.businessTypeId,
        businessTypeKey: master?.businessTypeKey ?? '',
        label: master?.label ?? '',
        version: row.version,
        baseVersionId: row.baseVersionId,
        quotaOverrides: toQuotaMap(row.quotaOverrides),
        monthlyNet: decimalToString(row.monthlyNet),
        yearlyNet: decimalToString(row.yearlyNet),
        marketed: row.marketed,
        publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
        supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
        publishedChanges: toVersionChanges(row.publishedChanges),
        changeNote: row.changeNote,
        nonRegressive: row.nonRegressive,
        // The canonical `business_type_versions` table carries no
        // validFrom/validUntil columns and the port's publishDraft omits them,
        // so both stay null (unlike the Plan/Bundle version lifecycle).
        validFrom: null,
        validUntil: null,
        createdByUserId: row.createdByUserId,
        publishedByUserId: row.publishedByUserId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        bundles,
    };
}

function decimalToString(value: DecimalLike | null): string | null {
    return value === null || value === undefined ? null : value.toString();
}

function toVersionChanges(value: unknown): VersionChange[] | null {
    return Array.isArray(value) ? (value as VersionChange[]) : null;
}
