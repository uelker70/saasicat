import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNotNull, isNull, like, lt, or, sql } from 'drizzle-orm';
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
import { DRIZZLE_DB_TOKEN, escapeLikePattern, resolveDb, type DrizzleClient } from './client.js';
import { promoCodes } from './schema.js';

type PromoCodeRow = typeof promoCodes.$inferSelect;

/**
 * `PromoCodeRepository` against the canonical `promo_codes` table.
 *
 * The availability-critical mutations (`claimSlot`, `releaseSlot`,
 * `markExhaustedIfFull`) run as single guarded UPDATE statements — the
 * column-to-column comparison and the conditional status flip are SQL
 * fragments inside the query builder. Row counts come from `RETURNING`,
 * which is uniform across every Drizzle pg driver.
 */
@Injectable()
export class DrizzlePromoCodeRepository implements PromoCodeRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async findById(id: string): Promise<PromoCodeRecord | null> {
        const rows = await this.db.select().from(promoCodes).where(eq(promoCodes.id, id)).limit(1);
        const row = rows[0] as PromoCodeRow | undefined;
        return row ? toRecord(row) : null;
    }

    async findByCode(code: string, tx?: TransactionContext): Promise<PromoCodeRecord | null> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .select()
            .from(promoCodes)
            .where(eq(promoCodes.code, normalizeCode(code)))
            .limit(1);
        const row = rows[0] as PromoCodeRow | undefined;
        // Soft-deleted codes are not redeemable/visible via code lookup.
        if (!row || row.deletedAt) return null;
        return toRecord(row);
    }

    async findMany(filter: PromoCodeFilter): Promise<PromoCodeRecord[]> {
        const conditions = [
            isNull(promoCodes.deletedAt),
            filter.status ? eq(promoCodes.status, filter.status) : undefined,
            filter.campaignTag ? eq(promoCodes.campaignTag, filter.campaignTag) : undefined,
            filter.search
                ? like(promoCodes.code, `%${escapeLikePattern(normalizeCode(filter.search))}%`)
                : undefined,
        ];
        const rows = await this.db
            .select()
            .from(promoCodes)
            .where(and(...conditions))
            .orderBy(sql`${promoCodes.createdAt} DESC`);
        return (rows as PromoCodeRow[]).map(toRecord);
    }

    async create(data: CreatePromoCodeData): Promise<PromoCodeRecord> {
        const rows = await this.db
            .insert(promoCodes)
            .values({
                id: randomUUID(),
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
                updatedAt: new Date(),
            })
            .returning();
        return toRecord(rows[0] as PromoCodeRow);
    }

    async update(id: string, data: UpdatePromoCodeData): Promise<PromoCodeRecord> {
        const rows = await this.db
            .update(promoCodes)
            .set({
                status: data.status,
                description: data.description,
                validUntil: data.validUntil,
                maxRedemptions: data.maxRedemptions,
                updatedAt: new Date(),
            })
            .where(eq(promoCodes.id, id))
            .returning();
        const row = rows[0] as PromoCodeRow | undefined;
        if (!row) {
            throw new Error(`PromoCode ${id} not found.`);
        }
        return toRecord(row);
    }

    async softDelete(id: string): Promise<void> {
        await this.db
            .update(promoCodes)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(promoCodes.id, id));
    }

    async claimSlot(id: string, tx?: TransactionContext): Promise<boolean> {
        const db = resolveDb(this.db, tx);
        const claimed = await db
            .update(promoCodes)
            .set({
                redemptionsCount: sql`${promoCodes.redemptionsCount} + 1`,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(promoCodes.id, id),
                    eq(promoCodes.status, 'ACTIVE'),
                    isNull(promoCodes.deletedAt),
                    or(
                        isNull(promoCodes.maxRedemptions),
                        lt(promoCodes.redemptionsCount, promoCodes.maxRedemptions),
                    ),
                ),
            )
            .returning({ id: promoCodes.id });
        return claimed.length === 1;
    }

    async markExhaustedIfFull(id: string, tx?: TransactionContext): Promise<void> {
        const db = resolveDb(this.db, tx);
        await db
            .update(promoCodes)
            .set({ status: 'EXHAUSTED', updatedAt: new Date() })
            .where(
                and(
                    eq(promoCodes.id, id),
                    eq(promoCodes.status, 'ACTIVE'),
                    isNotNull(promoCodes.maxRedemptions),
                    gte(promoCodes.redemptionsCount, promoCodes.maxRedemptions),
                ),
            );
    }

    async releaseSlot(id: string, tx?: TransactionContext): Promise<void> {
        const db = resolveDb(this.db, tx);
        await db
            .update(promoCodes)
            .set({
                redemptionsCount: sql`GREATEST(${promoCodes.redemptionsCount} - 1, 0)`,
                status: sql`CASE WHEN ${promoCodes.status} = 'EXHAUSTED' THEN 'ACTIVE' ELSE ${promoCodes.status} END`,
                updatedAt: new Date(),
            })
            .where(eq(promoCodes.id, id));
    }

    async expireDueCodes(now: Date): Promise<number> {
        const expired = await this.db
            .update(promoCodes)
            .set({ status: 'EXPIRED', updatedAt: new Date() })
            .where(
                and(
                    inArray(promoCodes.status, ['ACTIVE', 'PAUSED']),
                    lt(promoCodes.validUntil, now),
                ),
            )
            .returning({ id: promoCodes.id });
        return expired.length;
    }
}

function normalizeCode(code: string): string {
    return code.trim().toUpperCase();
}

function toRecord(row: PromoCodeRow): PromoCodeRecord {
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
        appliesToPlans: row.appliesToPlans ?? [],
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
