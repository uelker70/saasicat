import { Inject, Injectable } from '@nestjs/common';
import type {
    CreatePromotionData,
    PromotionBillingCycle,
    PromotionFilter,
    PromotionI18n,
    PromotionRepository,
    PromotionRow,
    PromotionTargetType,
    PromotionType,
    PromotionValue,
    UpdatePromotionData,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type PrismaLike,
    type PrismaModelDelegateLike,
} from './prisma-client-token.js';
import { toStringArray } from './tx.js';

/** DB columns this repository reads from `promotions`. */
interface PromotionDbRow {
    id: string;
    projectKey: string;
    internalLabel: string;
    type: string;
    value: unknown;
    targetType: string;
    appliesTo: unknown;
    billingCycle: string;
    validFrom: Date;
    validTo: Date;
    priority: number;
    onlyLocales: unknown;
    requiresCoupon: boolean;
    codes: unknown;
    color: string;
    i18n: unknown;
    createdAt: Date;
    updatedAt: Date;
}

/** Narrow view of the injected client used by this repository. */
interface PromotionPrisma {
    promotion: PrismaModelDelegateLike<PromotionDbRow>;
}

/**
 * `PromotionRepository` against the canonical `promotions` table. Not
 * versioned: promotions are edited directly.
 *
 * The nullable `onlyLocales` JSON column cannot be set to null through Prisma's
 * query API without the `Prisma.DbNull` sentinel — which this Prisma-agnostic
 * package deliberately does not import. On `create` a null restriction is
 * therefore written by omission (the column defaults to SQL NULL); on `update`
 * an explicit null clear runs as a raw statement.
 */
@Injectable()
export class PrismaPromotionRepository implements PromotionRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    private get db(): PromotionPrisma {
        return this.prisma as unknown as PromotionPrisma;
    }

    async list(filter: PromotionFilter): Promise<PromotionRow[]> {
        const rows = await this.db.promotion.findMany({
            where: { projectKey: filter.projectKey },
            orderBy: [{ validFrom: 'desc' }],
        });
        return rows.map(toRow);
    }

    async findById(id: string): Promise<PromotionRow | null> {
        const row = await this.db.promotion.findUnique({ where: { id } });
        return row ? toRow(row) : null;
    }

    async create(data: CreatePromotionData): Promise<PromotionRow> {
        const row = await this.db.promotion.create({
            data: {
                projectKey: data.projectKey,
                internalLabel: data.internalLabel,
                type: data.type,
                value: data.value,
                targetType: data.targetType ?? 'PLAN',
                appliesTo: data.appliesTo ?? [],
                billingCycle: data.billingCycle ?? 'both',
                validFrom: new Date(data.validFrom),
                validTo: new Date(data.validTo),
                priority: data.priority ?? 0,
                requiresCoupon: data.requiresCoupon ?? false,
                codes: data.codes ?? [],
                color: data.color ?? '#2563eb',
                i18n: data.i18n ?? {},
                // Null/undefined restriction is left off so the nullable column
                // stays SQL NULL (= all locales).
                ...(Array.isArray(data.onlyLocales) ? { onlyLocales: data.onlyLocales } : {}),
            },
        });
        return toRow(row);
    }

    async update(id: string, data: UpdatePromotionData): Promise<PromotionRow> {
        // Explicit `null` clears the locale restriction — not expressible via the
        // Prisma query API without the DbNull sentinel, so it runs as raw SQL
        // before the field update. A following (possibly empty) Prisma update
        // then returns the fresh row with the cleared value.
        if (data.onlyLocales === null) {
            await this.prisma.$executeRaw`
                UPDATE promotions SET "onlyLocales" = NULL, "updatedAt" = NOW() WHERE id = ${id}`;
        }
        const row = await this.db.promotion.update({
            where: { id },
            data: {
                ...(data.internalLabel !== undefined ? { internalLabel: data.internalLabel } : {}),
                ...(data.type !== undefined ? { type: data.type } : {}),
                ...(data.value !== undefined ? { value: data.value } : {}),
                ...(data.appliesTo !== undefined ? { appliesTo: data.appliesTo } : {}),
                ...(data.targetType !== undefined ? { targetType: data.targetType } : {}),
                ...(data.billingCycle !== undefined ? { billingCycle: data.billingCycle } : {}),
                ...(data.validFrom !== undefined ? { validFrom: new Date(data.validFrom) } : {}),
                ...(data.validTo !== undefined ? { validTo: new Date(data.validTo) } : {}),
                ...(data.priority !== undefined ? { priority: data.priority } : {}),
                ...(data.requiresCoupon !== undefined
                    ? { requiresCoupon: data.requiresCoupon }
                    : {}),
                ...(data.codes !== undefined ? { codes: data.codes } : {}),
                ...(data.color !== undefined ? { color: data.color } : {}),
                ...(data.i18n !== undefined ? { i18n: data.i18n } : {}),
                ...(Array.isArray(data.onlyLocales) ? { onlyLocales: data.onlyLocales } : {}),
            },
        });
        return toRow(row);
    }

    async delete(id: string): Promise<void> {
        await this.db.promotion.delete({ where: { id } });
    }
}

/**
 * Narrows the type-dependent `value` JSON: `percent`/`amount`/`freeMonths` are
 * stored as a number, `intro` as `{ price, months }`. Any other shape is
 * corrupt data and fails loud rather than mis-pricing the public catalog.
 */
function toPromotionValue(value: unknown): PromotionValue {
    if (typeof value === 'number') return value;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as { price?: unknown; months?: unknown };
        return { price: Number(obj.price), months: Number(obj.months) };
    }
    throw new Error(`Promotion.value has an unexpected shape: ${JSON.stringify(value)}`);
}

function toNullableStringArray(value: unknown): string[] | null {
    return Array.isArray(value) ? (value as string[]) : null;
}

function toPromotionI18n(value: unknown): PromotionI18n {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value as PromotionI18n;
    }
    return {};
}

function toRow(row: PromotionDbRow): PromotionRow {
    return {
        id: row.id,
        projectKey: row.projectKey,
        internalLabel: row.internalLabel,
        type: row.type as PromotionType,
        value: toPromotionValue(row.value),
        appliesTo: toStringArray(row.appliesTo),
        targetType: row.targetType as PromotionTargetType,
        billingCycle: row.billingCycle as PromotionBillingCycle,
        validFrom: row.validFrom.toISOString().slice(0, 10),
        validTo: row.validTo.toISOString().slice(0, 10),
        priority: row.priority,
        onlyLocales: toNullableStringArray(row.onlyLocales),
        requiresCoupon: row.requiresCoupon,
        codes: toStringArray(row.codes),
        color: row.color,
        i18n: toPromotionI18n(row.i18n),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
