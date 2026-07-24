import { Inject, Injectable } from '@nestjs/common';
import type {
    CapabilityCatalogEntryRow,
    CapabilityCodeStatus,
    CapabilityKind,
    CatalogEntryFilter,
    CatalogEntryI18n,
    CatalogEntryRepository,
    DiscoveryStatus,
    FeatureCatalogEntryRow,
    QuotaCatalogEntryRow,
    QuotaEnforcementMode,
    SetCatalogEntryReviewData,
    UpdateCatalogEntryBaseData,
    UpsertCapabilityEntryData,
    UpsertFeatureEntryData,
    UpsertQuotaEntryData,
} from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** DB columns this repository reads from `capability_catalog_entries`. */
interface CapabilityCatalogEntryDbRow {
    id: string;
    projectKey: string;
    capabilityKey: string;
    label: string;
    description: string | null;
    featureKey: string | null;
    bundleKey: string | null;
    codeStatus: string;
    owner: string | null;
    kind: string;
    replacementKey: string | null;
    deprecatedAt: Date | null;
    removalPlannedAt: Date | null;
    reason: string | null;
    i18n: unknown;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

/** DB columns this repository reads from `feature_catalog_entries`. */
interface FeatureCatalogEntryDbRow {
    id: string;
    projectKey: string;
    featureKey: string;
    label: string;
    description: string | null;
    marketingLabel: string | null;
    marketingDescription: string | null;
    icon: string | null;
    tier: string | null;
    core: boolean;
    requires: string[];
    replaces: string[];
    successorKey: string | null;
    discoveryStatus: string;
    approvedAt: Date | null;
    approvedBy: string | null;
    approvedSignature: string | null;
    plannedOnly: boolean;
    i18n: unknown;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

/** DB columns this repository reads from `quota_catalog_entries`. */
interface QuotaCatalogEntryDbRow {
    id: string;
    projectKey: string;
    quotaKey: string;
    label: string;
    description: string | null;
    unit: string;
    featureKey: string | null;
    usageProvider: string | null;
    enforcementMode: string;
    discoveryStatus: string;
    replaces: string[];
    successorKey: string | null;
    approvedAt: Date | null;
    approvedBy: string | null;
    approvedSignature: string | null;
    i18n: unknown;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

/**
 * Narrow view of the injected client used by this repository. Independent of
 * the `featureCatalogEntry` delegate on `PrismaTxLike` (used by other slices) —
 * this repo owns its own row shapes for the three discovery tables.
 */
interface CatalogEntryPrisma {
    capabilityCatalogEntry: PrismaModelDelegateLike<CapabilityCatalogEntryDbRow>;
    featureCatalogEntry: PrismaModelDelegateLike<FeatureCatalogEntryDbRow>;
    quotaCatalogEntry: PrismaModelDelegateLike<QuotaCatalogEntryDbRow>;
}

interface CatalogEntryRepositoryClient {
    capabilityCatalogEntry: unknown;
    featureCatalogEntry: unknown;
    quotaCatalogEntry: unknown;
}

/**
 * `CatalogEntryRepository` against the canonical `capability_catalog_entries`,
 * `feature_catalog_entries` and `quota_catalog_entries` tables (SPEC_V2 §6.3 —
 * discovery review workflow).
 *
 * `upsert*` writes only the code-derived fields + the service-resolved status
 * and leaves `i18n`, `sortOrder`, `createdAt` and the approval fields untouched
 * on update (Prisma's `update` payload simply omits them). `retireMissing`
 * marks entries whose key vanished from the code snapshot.
 */
@Injectable()
export class PrismaCatalogEntryRepository implements CatalogEntryRepository {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: CatalogEntryRepositoryClient,
    ) {}

    private get db(): CatalogEntryPrisma {
        return this.prisma as unknown as CatalogEntryPrisma;
    }

    async listCapabilities(filter: CatalogEntryFilter): Promise<CapabilityCatalogEntryRow[]> {
        const rows = await this.db.capabilityCatalogEntry.findMany({
            where: {
                projectKey: filter.projectKey,
                deletedAt: null,
                ...(filter.codeStatus ? { codeStatus: filter.codeStatus } : {}),
            },
            orderBy: [{ sortOrder: 'asc' }, { capabilityKey: 'asc' }],
        });
        return rows.map(toCapabilityRow);
    }

    async listFeatures(filter: CatalogEntryFilter): Promise<FeatureCatalogEntryRow[]> {
        const rows = await this.db.featureCatalogEntry.findMany({
            where: {
                projectKey: filter.projectKey,
                deletedAt: null,
                ...(filter.discoveryStatus ? { discoveryStatus: filter.discoveryStatus } : {}),
            },
            orderBy: [{ sortOrder: 'asc' }, { featureKey: 'asc' }],
        });
        return rows.map(toFeatureRow);
    }

    async listQuotas(filter: CatalogEntryFilter): Promise<QuotaCatalogEntryRow[]> {
        const rows = await this.db.quotaCatalogEntry.findMany({
            where: {
                projectKey: filter.projectKey,
                deletedAt: null,
                ...(filter.discoveryStatus ? { discoveryStatus: filter.discoveryStatus } : {}),
            },
            orderBy: [{ sortOrder: 'asc' }, { quotaKey: 'asc' }],
        });
        return rows.map(toQuotaRow);
    }

    async upsertCapability(data: UpsertCapabilityEntryData): Promise<CapabilityCatalogEntryRow> {
        const codeFields = {
            label: data.label,
            description: data.description,
            featureKey: data.featureKey,
            bundleKey: data.bundleKey,
            codeStatus: data.codeStatus,
            owner: data.owner,
            kind: data.kind,
            replacementKey: data.replacementKey,
            deprecatedAt: data.deprecatedAt ? new Date(data.deprecatedAt) : null,
            removalPlannedAt: data.removalPlannedAt ? new Date(data.removalPlannedAt) : null,
            reason: data.reason,
        };
        const row = await this.db.capabilityCatalogEntry.upsert({
            where: {
                projectKey_capabilityKey: {
                    projectKey: data.projectKey,
                    capabilityKey: data.capabilityKey,
                },
            },
            create: {
                projectKey: data.projectKey,
                capabilityKey: data.capabilityKey,
                ...codeFields,
            },
            update: codeFields,
        });
        return toCapabilityRow(row);
    }

    async upsertFeature(data: UpsertFeatureEntryData): Promise<FeatureCatalogEntryRow> {
        const codeFields = {
            label: data.label,
            description: data.description,
            discoveryStatus: data.discoveryStatus,
            requires: data.requires,
            replaces: data.replaces,
            ...(data.core !== undefined ? { core: data.core } : {}),
        };
        const row = await this.db.featureCatalogEntry.upsert({
            where: {
                projectKey_featureKey: {
                    projectKey: data.projectKey,
                    featureKey: data.featureKey,
                },
            },
            create: {
                projectKey: data.projectKey,
                featureKey: data.featureKey,
                ...codeFields,
            },
            update: codeFields,
        });
        return toFeatureRow(row);
    }

    async upsertQuota(data: UpsertQuotaEntryData): Promise<QuotaCatalogEntryRow> {
        const codeFields = {
            label: data.label,
            description: data.description,
            unit: data.unit,
            featureKey: data.featureKey,
            usageProvider: data.usageProvider,
            enforcementMode: data.enforcementMode,
            discoveryStatus: data.discoveryStatus,
            replaces: data.replaces,
        };
        const row = await this.db.quotaCatalogEntry.upsert({
            where: {
                projectKey_quotaKey: {
                    projectKey: data.projectKey,
                    quotaKey: data.quotaKey,
                },
            },
            create: {
                projectKey: data.projectKey,
                quotaKey: data.quotaKey,
                ...codeFields,
            },
            update: codeFields,
        });
        return toQuotaRow(row);
    }

    async retireMissing(
        projectKey: string,
        type: 'capability' | 'feature' | 'quota',
        presentKeys: string[],
    ): Promise<number> {
        if (type === 'capability') {
            const res = await this.db.capabilityCatalogEntry.updateMany({
                where: {
                    projectKey,
                    deletedAt: null,
                    codeStatus: { not: 'retired' },
                    capabilityKey: { notIn: presentKeys },
                },
                data: { codeStatus: 'retired' },
            });
            return res.count;
        }
        if (type === 'feature') {
            const res = await this.db.featureCatalogEntry.updateMany({
                where: {
                    projectKey,
                    deletedAt: null,
                    discoveryStatus: { not: 'obsolete' },
                    featureKey: { notIn: presentKeys },
                },
                data: { discoveryStatus: 'obsolete' },
            });
            return res.count;
        }
        const res = await this.db.quotaCatalogEntry.updateMany({
            where: {
                projectKey,
                deletedAt: null,
                discoveryStatus: { not: 'obsolete' },
                quotaKey: { notIn: presentKeys },
            },
            data: { discoveryStatus: 'obsolete' },
        });
        return res.count;
    }

    async setFeatureSuccessor(
        projectKey: string,
        featureKey: string,
        successorKey: string | null,
    ): Promise<FeatureCatalogEntryRow> {
        const row = await this.db.featureCatalogEntry.update({
            where: { projectKey_featureKey: { projectKey, featureKey } },
            data: { successorKey },
        });
        return toFeatureRow(row);
    }

    async setQuotaSuccessor(
        projectKey: string,
        quotaKey: string,
        successorKey: string | null,
    ): Promise<QuotaCatalogEntryRow> {
        const row = await this.db.quotaCatalogEntry.update({
            where: { projectKey_quotaKey: { projectKey, quotaKey } },
            data: { successorKey },
        });
        return toQuotaRow(row);
    }

    async findFeature(
        projectKey: string,
        featureKey: string,
    ): Promise<FeatureCatalogEntryRow | null> {
        const row = await this.db.featureCatalogEntry.findUnique({
            where: { projectKey_featureKey: { projectKey, featureKey } },
        });
        return row ? toFeatureRow(row) : null;
    }

    async findQuota(projectKey: string, quotaKey: string): Promise<QuotaCatalogEntryRow | null> {
        const row = await this.db.quotaCatalogEntry.findUnique({
            where: { projectKey_quotaKey: { projectKey, quotaKey } },
        });
        return row ? toQuotaRow(row) : null;
    }

    async setFeatureReview(
        projectKey: string,
        featureKey: string,
        data: SetCatalogEntryReviewData,
    ): Promise<FeatureCatalogEntryRow> {
        const row = await this.db.featureCatalogEntry.update({
            where: { projectKey_featureKey: { projectKey, featureKey } },
            data: {
                discoveryStatus: data.discoveryStatus,
                approvedAt: data.approvedAt ? new Date(data.approvedAt) : null,
                approvedBy: data.approvedBy,
                approvedSignature: data.approvedSignature,
            },
        });
        return toFeatureRow(row);
    }

    async setQuotaReview(
        projectKey: string,
        quotaKey: string,
        data: SetCatalogEntryReviewData,
    ): Promise<QuotaCatalogEntryRow> {
        const row = await this.db.quotaCatalogEntry.update({
            where: { projectKey_quotaKey: { projectKey, quotaKey } },
            data: {
                discoveryStatus: data.discoveryStatus,
                approvedAt: data.approvedAt ? new Date(data.approvedAt) : null,
                approvedBy: data.approvedBy,
                approvedSignature: data.approvedSignature,
            },
        });
        return toQuotaRow(row);
    }

    async setFeatureI18n(
        projectKey: string,
        featureKey: string,
        i18n: CatalogEntryI18n,
    ): Promise<FeatureCatalogEntryRow> {
        const row = await this.db.featureCatalogEntry.update({
            where: { projectKey_featureKey: { projectKey, featureKey } },
            data: { i18n },
        });
        return toFeatureRow(row);
    }

    async setQuotaI18n(
        projectKey: string,
        quotaKey: string,
        i18n: CatalogEntryI18n,
    ): Promise<QuotaCatalogEntryRow> {
        const row = await this.db.quotaCatalogEntry.update({
            where: { projectKey_quotaKey: { projectKey, quotaKey } },
            data: { i18n },
        });
        return toQuotaRow(row);
    }

    async setFeatureBase(
        projectKey: string,
        featureKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<FeatureCatalogEntryRow> {
        const row = await this.db.featureCatalogEntry.update({
            where: { projectKey_featureKey: { projectKey, featureKey } },
            data: {
                ...(data.label !== undefined ? { label: data.label } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.icon !== undefined ? { icon: data.icon } : {}),
                ...(data.tier !== undefined ? { tier: data.tier } : {}),
            },
        });
        return toFeatureRow(row);
    }

    async setQuotaBase(
        projectKey: string,
        quotaKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<QuotaCatalogEntryRow> {
        const row = await this.db.quotaCatalogEntry.update({
            where: { projectKey_quotaKey: { projectKey, quotaKey } },
            data: {
                ...(data.label !== undefined ? { label: data.label } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
            },
        });
        return toQuotaRow(row);
    }
}

/** Narrows an `i18n` JSON column to the locale-translation map; non-objects become {}. */
function toI18n(value: unknown): CatalogEntryI18n {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value as CatalogEntryI18n;
    }
    return {};
}

function toCapabilityRow(row: CapabilityCatalogEntryDbRow): CapabilityCatalogEntryRow {
    return {
        id: row.id,
        projectKey: row.projectKey,
        capabilityKey: row.capabilityKey,
        label: row.label,
        description: row.description,
        featureKey: row.featureKey,
        bundleKey: row.bundleKey,
        codeStatus: row.codeStatus as CapabilityCodeStatus,
        owner: row.owner,
        kind: row.kind as CapabilityKind,
        replacementKey: row.replacementKey,
        deprecatedAt: row.deprecatedAt ? row.deprecatedAt.toISOString() : null,
        removalPlannedAt: row.removalPlannedAt ? row.removalPlannedAt.toISOString() : null,
        reason: row.reason,
        i18n: toI18n(row.i18n),
        sortOrder: row.sortOrder,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
}

function toFeatureRow(row: FeatureCatalogEntryDbRow): FeatureCatalogEntryRow {
    return {
        id: row.id,
        projectKey: row.projectKey,
        featureKey: row.featureKey,
        label: row.label,
        description: row.description,
        marketingLabel: row.marketingLabel,
        marketingDescription: row.marketingDescription,
        icon: row.icon,
        tier: row.tier,
        discoveryStatus: row.discoveryStatus as DiscoveryStatus,
        requires: row.requires,
        replaces: row.replaces,
        successorKey: row.successorKey,
        approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
        approvedBy: row.approvedBy,
        approvedSignature: row.approvedSignature,
        plannedOnly: row.plannedOnly,
        core: row.core,
        i18n: toI18n(row.i18n),
        sortOrder: row.sortOrder,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
}

function toQuotaRow(row: QuotaCatalogEntryDbRow): QuotaCatalogEntryRow {
    return {
        id: row.id,
        projectKey: row.projectKey,
        quotaKey: row.quotaKey,
        label: row.label,
        description: row.description,
        unit: row.unit,
        featureKey: row.featureKey,
        usageProvider: row.usageProvider,
        enforcementMode: row.enforcementMode as QuotaEnforcementMode,
        discoveryStatus: row.discoveryStatus as DiscoveryStatus,
        replaces: row.replaces,
        successorKey: row.successorKey,
        approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
        approvedBy: row.approvedBy,
        approvedSignature: row.approvedSignature,
        i18n: toI18n(row.i18n),
        sortOrder: row.sortOrder,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
}
