import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import type {
    PromoCodeDurationType,
    PromoCodeRedemptionListItem,
    PromoCodeRedemptionRecord,
    PromoCodeRedemptionRepository,
    PromoCodeRedemptionStatus,
    PromoCodeValueType,
    TransactionContext,
} from '@saasicat/types';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { promoCodeRedemptions } from './schema.js';

type RedemptionRow = typeof promoCodeRedemptions.$inferSelect;

/**
 * `PromoCodeRedemptionRepository` against the canonical
 * `promo_code_redemptions` table. Double redemption per subscription is
 * excluded by the `subscriptionId` unique constraint — a concurrent second
 * `create` fails at the database.
 */
@Injectable()
export class DrizzlePromoCodeRedemptionRepository implements PromoCodeRedemptionRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async findBySubscription(
        subscriptionId: string,
        tx?: TransactionContext,
    ): Promise<PromoCodeRedemptionRecord | null> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .select()
            .from(promoCodeRedemptions)
            .where(eq(promoCodeRedemptions.subscriptionId, subscriptionId))
            .limit(1);
        const row = rows[0] as RedemptionRow | undefined;
        return row ? toRecord(row) : null;
    }

    async create(
        data: Omit<PromoCodeRedemptionRecord, 'id' | 'redeemedAt' | 'status' | 'reversedAt'>,
        tx?: TransactionContext,
    ): Promise<PromoCodeRedemptionRecord> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .insert(promoCodeRedemptions)
            .values({
                id: randomUUID(),
                promoCodeId: data.promoCodeId,
                subscriptionId: data.subscriptionId,
                tenantId: data.tenantId,
                appliedValueType: data.appliedValueType,
                appliedValue: data.appliedValue,
                appliedDurationType: data.appliedDurationType,
                appliedDurationValue: data.appliedDurationValue,
                startsAt: data.startsAt,
                endsAt: data.endsAt,
            })
            .returning();
        return toRecord(rows[0] as RedemptionRow);
    }

    async setReversed(id: string, tx?: TransactionContext): Promise<PromoCodeRedemptionRecord> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .update(promoCodeRedemptions)
            .set({ status: 'REVERSED', reversedAt: new Date() })
            .where(eq(promoCodeRedemptions.id, id))
            .returning();
        const row = rows[0] as RedemptionRow | undefined;
        if (!row) {
            throw new Error(`PromoCodeRedemption ${id} not found.`);
        }
        return toRecord(row);
    }

    async countByPromoCode(
        promoCodeId: string,
        status?: PromoCodeRedemptionStatus,
    ): Promise<number> {
        const rows = await this.db
            .select({ id: promoCodeRedemptions.id })
            .from(promoCodeRedemptions)
            .where(
                and(
                    eq(promoCodeRedemptions.promoCodeId, promoCodeId),
                    status ? eq(promoCodeRedemptions.status, status) : undefined,
                ),
            );
        return rows.length;
    }

    async listByPromoCode(promoCodeId: string): Promise<PromoCodeRedemptionListItem[]> {
        const rows = await this.db
            .select()
            .from(promoCodeRedemptions)
            .where(eq(promoCodeRedemptions.promoCodeId, promoCodeId))
            .orderBy(desc(promoCodeRedemptions.redeemedAt));
        // The canonical schema owns no Tenant table — the optional `tenant`
        // display join stays consumer-specific and is omitted here.
        return (rows as RedemptionRow[]).map(toRecord);
    }

    async expireDueRedemptions(now: Date): Promise<number> {
        const expired = await this.db
            .update(promoCodeRedemptions)
            .set({ status: 'EXPIRED' })
            .where(
                and(
                    eq(promoCodeRedemptions.status, 'ACTIVE'),
                    lt(promoCodeRedemptions.endsAt, now),
                ),
            )
            .returning({ id: promoCodeRedemptions.id });
        return expired.length;
    }
}

function toRecord(row: RedemptionRow): PromoCodeRedemptionRecord {
    return {
        id: row.id,
        promoCodeId: row.promoCodeId,
        subscriptionId: row.subscriptionId,
        tenantId: row.tenantId,
        appliedValueType: row.appliedValueType as PromoCodeValueType,
        appliedValue: String(row.appliedValue),
        appliedDurationType: row.appliedDurationType as PromoCodeDurationType,
        appliedDurationValue: row.appliedDurationValue,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        status: row.status as PromoCodeRedemptionStatus,
        redeemedAt: row.redeemedAt,
        reversedAt: row.reversedAt,
    };
}
