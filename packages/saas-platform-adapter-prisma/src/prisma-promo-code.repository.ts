import { Inject, Injectable } from '@nestjs/common';
import type {
    BillingCycle,
    CreatePromoCodeData,
    PromoCodeDurationType,
    PromoCodeFilter,
    PromoCodeRecord,
    PromoCodeRepository,
    PromoCodeStatus,
    PromoCodeValueType,
    TransactionContext,
    UpdatePromoCodeData,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type PrismaLike,
    type PromoCodeRowLike,
} from './prisma-client-token.js';
import { resolveClient } from './tx.js';

/**
 * `PromoCodeRepository` against the canonical `promo_codes` table.
 *
 * The availability-critical mutations (`claimSlot`, `releaseSlot`,
 * `markExhaustedIfFull`) run as single atomic UPDATE statements — the
 * column-to-column guard (`redemptionsCount < maxRedemptions`) is not
 * expressible in the Prisma query API, so they use `$executeRaw`. The raw
 * statements maintain `updatedAt` manually because they bypass Prisma's
 * `@updatedAt`.
 */
@Injectable()
export class PrismaPromoCodeRepository implements PromoCodeRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async findById(id: string): Promise<PromoCodeRecord | null> {
        const row = await this.prisma.promoCode.findUnique({ where: { id } });
        return row ? toRecord(row) : null;
    }

    async findByCode(code: string, tx?: TransactionContext): Promise<PromoCodeRecord | null> {
        const db = resolveClient(this.prisma, tx);
        const row = await db.promoCode.findUnique({
            where: { code: normalizeCode(code) },
        });
        // Soft-deleted codes are not redeemable/visible via code lookup.
        if (!row || row.deletedAt) return null;
        return toRecord(row);
    }

    async findMany(filter: PromoCodeFilter): Promise<PromoCodeRecord[]> {
        const rows = await this.prisma.promoCode.findMany({
            where: {
                deletedAt: null,
                status: filter.status,
                campaignTag: filter.campaignTag,
                code: filter.search ? { contains: normalizeCode(filter.search) } : undefined,
            },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(toRecord);
    }

    async create(data: CreatePromoCodeData): Promise<PromoCodeRecord> {
        const row = await this.prisma.promoCode.create({
            data: {
                code: normalizeCode(data.code),
                valueType: data.valueType,
                value: data.value.toFixed(2),
                durationType: data.durationType,
                durationValue: data.durationValue ?? null,
                validFrom: data.validFrom ?? null,
                validUntil: data.validUntil ?? null,
                maxRedemptions: data.maxRedemptions ?? null,
                appliesToPlans: data.appliesToPlans ?? [],
                appliesToBilling: data.appliesToBilling ?? null,
                firstTimeCustomersOnly: data.firstTimeCustomersOnly ?? true,
                minimumPlanAmountGross: data.minimumPlanAmountGross?.toFixed(2) ?? null,
                allowZeroInvoice: data.allowZeroInvoice ?? false,
                description: data.description ?? null,
                campaignTag: data.campaignTag ?? null,
                revenueDeductionAccount: data.revenueDeductionAccount ?? null,
                createdById: data.createdById,
            },
        });
        return toRecord(row);
    }

    async update(id: string, data: UpdatePromoCodeData): Promise<PromoCodeRecord> {
        const row = await this.prisma.promoCode.update({
            where: { id },
            data: {
                status: data.status,
                description: data.description,
                validUntil: data.validUntil,
                maxRedemptions: data.maxRedemptions,
            },
        });
        return toRecord(row);
    }

    async softDelete(id: string): Promise<void> {
        await this.prisma.promoCode.update({ where: { id }, data: { deletedAt: new Date() } });
    }

    async claimSlot(id: string, tx?: TransactionContext): Promise<boolean> {
        const db = resolveClient(this.prisma, tx);
        const updated = await db.$executeRaw`
            UPDATE promo_codes
            SET "redemptionsCount" = "redemptionsCount" + 1, "updatedAt" = NOW()
            WHERE id = ${id}
              AND status = 'ACTIVE'
              AND "deletedAt" IS NULL
              AND ("maxRedemptions" IS NULL OR "redemptionsCount" < "maxRedemptions")`;
        return updated === 1;
    }

    async markExhaustedIfFull(id: string, tx?: TransactionContext): Promise<void> {
        const db = resolveClient(this.prisma, tx);
        await db.$executeRaw`
            UPDATE promo_codes
            SET status = 'EXHAUSTED', "updatedAt" = NOW()
            WHERE id = ${id}
              AND status = 'ACTIVE'
              AND "maxRedemptions" IS NOT NULL
              AND "redemptionsCount" >= "maxRedemptions"`;
    }

    async releaseSlot(id: string, tx?: TransactionContext): Promise<void> {
        const db = resolveClient(this.prisma, tx);
        await db.$executeRaw`
            UPDATE promo_codes
            SET "redemptionsCount" = GREATEST("redemptionsCount" - 1, 0),
                status = CASE WHEN status = 'EXHAUSTED' THEN 'ACTIVE' ELSE status END,
                "updatedAt" = NOW()
            WHERE id = ${id}`;
    }

    async expireDueCodes(now: Date): Promise<number> {
        const result = await this.prisma.promoCode.updateMany({
            where: { status: { in: ['ACTIVE', 'PAUSED'] }, validUntil: { lt: now } },
            data: { status: 'EXPIRED' },
        });
        return result.count;
    }
}

function normalizeCode(code: string): string {
    return code.trim().toUpperCase();
}

function toRecord(row: PromoCodeRowLike): PromoCodeRecord {
    return {
        id: row.id,
        code: row.code,
        valueType: row.valueType as PromoCodeValueType,
        value: String(row.value),
        durationType: row.durationType as PromoCodeDurationType,
        durationValue: row.durationValue,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        maxRedemptions: row.maxRedemptions,
        redemptionsCount: row.redemptionsCount,
        appliesToPlans: row.appliesToPlans,
        appliesToBilling: (row.appliesToBilling as BillingCycle | null) ?? null,
        firstTimeCustomersOnly: row.firstTimeCustomersOnly,
        minimumPlanAmountGross:
            row.minimumPlanAmountGross === null ? null : String(row.minimumPlanAmountGross),
        allowZeroInvoice: row.allowZeroInvoice,
        status: row.status as PromoCodeStatus,
        description: row.description,
        campaignTag: row.campaignTag,
        revenueDeductionAccount: row.revenueDeductionAccount,
        createdById: row.createdById,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
    };
}
