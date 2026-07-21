import { Inject, Injectable } from '@nestjs/common';
import type {
    PromoCodeDurationType,
    PromoCodeRedemptionListItem,
    PromoCodeRedemptionRecord,
    PromoCodeRedemptionRepository,
    PromoCodeRedemptionStatus,
    PromoCodeValueType,
    TransactionContext,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type PrismaLike,
    type PromoCodeRedemptionRowLike,
} from './prisma-client-token.js';
import { resolveClient } from './tx.js';

/**
 * `PromoCodeRedemptionRepository` against the canonical
 * `promo_code_redemptions` table. Double redemption per subscription is
 * excluded by the `subscriptionId` unique constraint — a concurrent second
 * `create` fails at the database.
 */
@Injectable()
export class PrismaPromoCodeRedemptionRepository implements PromoCodeRedemptionRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async findBySubscription(
        subscriptionId: string,
        tx?: TransactionContext,
    ): Promise<PromoCodeRedemptionRecord | null> {
        const db = resolveClient(this.prisma, tx);
        const row = await db.promoCodeRedemption.findUnique({ where: { subscriptionId } });
        return row ? toRecord(row) : null;
    }

    async create(
        data: Omit<PromoCodeRedemptionRecord, 'id' | 'redeemedAt' | 'status' | 'reversedAt'>,
        tx?: TransactionContext,
    ): Promise<PromoCodeRedemptionRecord> {
        const db = resolveClient(this.prisma, tx);
        const row = await db.promoCodeRedemption.create({
            data: {
                promoCodeId: data.promoCodeId,
                subscriptionId: data.subscriptionId,
                tenantId: data.tenantId,
                appliedValueType: data.appliedValueType,
                appliedValue: data.appliedValue,
                appliedDurationType: data.appliedDurationType,
                appliedDurationValue: data.appliedDurationValue,
                startsAt: data.startsAt,
                endsAt: data.endsAt,
            },
        });
        return toRecord(row);
    }

    async setReversed(id: string, tx?: TransactionContext): Promise<PromoCodeRedemptionRecord> {
        const db = resolveClient(this.prisma, tx);
        const row = await db.promoCodeRedemption.update({
            where: { id },
            data: { status: 'REVERSED', reversedAt: new Date() },
        });
        return toRecord(row);
    }

    async countByPromoCode(
        promoCodeId: string,
        status?: PromoCodeRedemptionStatus,
    ): Promise<number> {
        return this.prisma.promoCodeRedemption.count({ where: { promoCodeId, status } });
    }

    async listByPromoCode(promoCodeId: string): Promise<PromoCodeRedemptionListItem[]> {
        const rows = await this.prisma.promoCodeRedemption.findMany({
            where: { promoCodeId },
            orderBy: { redeemedAt: 'desc' },
        });
        // The canonical schema owns no Tenant table — the optional `tenant`
        // display join stays consumer-specific and is omitted here.
        return rows.map(toRecord);
    }

    async expireDueRedemptions(now: Date): Promise<number> {
        const result = await this.prisma.promoCodeRedemption.updateMany({
            where: { status: 'ACTIVE', endsAt: { lt: now } },
            data: { status: 'EXPIRED' },
        });
        return result.count;
    }
}

function toRecord(row: PromoCodeRedemptionRowLike): PromoCodeRedemptionRecord {
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
