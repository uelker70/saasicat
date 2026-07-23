import { Inject, Injectable } from '@nestjs/common';
import type {
    CreateMarketingProjectionData,
    MarketingProjectionFilter,
    MarketingProjectionRepository,
    MarketingProjectionRow,
    MarketingTargetType,
    MarketingTopFeature,
    UpdateMarketingProjectionData,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type PrismaLike,
    type PrismaModelDelegateLike,
} from './prisma-client-token.js';

/** DB columns this repository reads from `marketing_projections`. */
interface MarketingProjectionDbRow {
    id: string;
    projectKey: string;
    targetType: string;
    targetVersionId: string;
    locale: string;
    displayLabel: string;
    description: string;
    visible: boolean;
    badge: string;
    topFeatures: unknown;
    trialEnabled: boolean;
    trialDays: number;
    priceTag: string | null;
    ctaLabel: string | null;
    priority: number;
    highlight: boolean;
    createdAt: Date;
    updatedAt: Date;
}

/** Narrow view of the injected client used by this repository. */
interface MarketingProjectionPrisma {
    marketingProjection: PrismaModelDelegateLike<MarketingProjectionDbRow>;
}

/**
 * `MarketingProjectionRepository` against the canonical `marketing_projections`
 * table. Not versioned: per (`targetType`, `targetVersionId`, `locale`) there is
 * exactly one row (enforced by a unique index), edited directly. `create` on a
 * duplicate triple therefore raises the DB unique-constraint error.
 */
@Injectable()
export class PrismaMarketingProjectionRepository implements MarketingProjectionRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    private get db(): MarketingProjectionPrisma {
        return this.prisma as unknown as MarketingProjectionPrisma;
    }

    async list(filter: MarketingProjectionFilter): Promise<MarketingProjectionRow[]> {
        const rows = await this.db.marketingProjection.findMany({
            where: {
                projectKey: filter.projectKey,
                ...(filter.targetType ? { targetType: filter.targetType } : {}),
                ...(filter.targetVersionId ? { targetVersionId: filter.targetVersionId } : {}),
                ...(filter.locale ? { locale: filter.locale } : {}),
            },
            orderBy: [{ priority: 'desc' }, { displayLabel: 'asc' }],
        });
        return rows.map(toRow);
    }

    async findById(id: string): Promise<MarketingProjectionRow | null> {
        const row = await this.db.marketingProjection.findUnique({ where: { id } });
        return row ? toRow(row) : null;
    }

    async findByTarget(
        targetType: string,
        targetVersionId: string,
        locale: string,
    ): Promise<MarketingProjectionRow | null> {
        const row = await this.db.marketingProjection.findUnique({
            where: {
                targetType_targetVersionId_locale: { targetType, targetVersionId, locale },
            },
        });
        return row ? toRow(row) : null;
    }

    async create(data: CreateMarketingProjectionData): Promise<MarketingProjectionRow> {
        const row = await this.db.marketingProjection.create({
            data: {
                projectKey: data.projectKey,
                targetType: data.targetType,
                targetVersionId: data.targetVersionId,
                locale: data.locale ?? 'de',
                displayLabel: data.displayLabel,
                description: data.description,
                visible: data.visible ?? true,
                badge: data.badge ?? '',
                topFeatures: data.topFeatures ?? [],
                trialEnabled: data.trialEnabled ?? false,
                trialDays: data.trialDays ?? 30,
                priceTag: data.priceTag ?? null,
                ctaLabel: data.ctaLabel ?? null,
                priority: data.priority ?? 0,
                highlight: data.highlight ?? false,
            },
        });
        return toRow(row);
    }

    async update(id: string, data: UpdateMarketingProjectionData): Promise<MarketingProjectionRow> {
        const row = await this.db.marketingProjection.update({
            where: { id },
            data: {
                ...(data.displayLabel !== undefined ? { displayLabel: data.displayLabel } : {}),
                ...(data.description !== undefined ? { description: data.description } : {}),
                ...(data.visible !== undefined ? { visible: data.visible } : {}),
                ...(data.badge !== undefined ? { badge: data.badge } : {}),
                ...(data.topFeatures !== undefined ? { topFeatures: data.topFeatures } : {}),
                ...(data.trialEnabled !== undefined ? { trialEnabled: data.trialEnabled } : {}),
                ...(data.trialDays !== undefined ? { trialDays: data.trialDays } : {}),
                ...(data.priceTag !== undefined ? { priceTag: data.priceTag } : {}),
                ...(data.ctaLabel !== undefined ? { ctaLabel: data.ctaLabel } : {}),
                ...(data.priority !== undefined ? { priority: data.priority } : {}),
                ...(data.highlight !== undefined ? { highlight: data.highlight } : {}),
            },
        });
        return toRow(row);
    }

    async delete(id: string): Promise<void> {
        await this.db.marketingProjection.delete({ where: { id } });
    }
}

function toTopFeatures(value: unknown): MarketingTopFeature[] {
    return Array.isArray(value) ? (value as MarketingTopFeature[]) : [];
}

function toRow(row: MarketingProjectionDbRow): MarketingProjectionRow {
    return {
        id: row.id,
        projectKey: row.projectKey,
        targetType: row.targetType as MarketingTargetType,
        targetVersionId: row.targetVersionId,
        locale: row.locale,
        displayLabel: row.displayLabel,
        description: row.description,
        visible: row.visible,
        badge: row.badge,
        topFeatures: toTopFeatures(row.topFeatures),
        trialEnabled: row.trialEnabled,
        trialDays: row.trialDays,
        priceTag: row.priceTag,
        ctaLabel: row.ctaLabel,
        priority: row.priority,
        highlight: row.highlight,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
