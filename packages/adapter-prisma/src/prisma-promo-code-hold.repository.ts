import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
    PromoCodeHoldRecord,
    PromoCodeHoldRepository,
    PromoCodeHoldTaken,
    TransactionContext,
} from '@saasicat/core';
import {
    PRISMA_CLIENT_TOKEN,
    type PrismaLike,
    type PrismaModelDelegateLike,
    type PrismaTxLike,
} from './prisma-client-token.js';
import { resolveClient } from './tx.js';

interface PromoCodeHoldRow {
    id: string;
    promoCodeId: string;
    checkoutOfferId: string;
    expiresAt: Date;
    createdAt: Date;
}

type HoldClient = PrismaTxLike & { promoCodeHold: PrismaModelDelegateLike<PromoCodeHoldRow> };

const HOLD_COLUMNS = {
    id: true,
    promoCodeId: true,
    checkoutOfferId: true,
    expiresAt: true,
    createdAt: true,
} as const;

/**
 * `PromoCodeHoldRepository` against the canonical `promo_code_holds` table and
 * the `heldCount` of `promo_codes`.
 *
 * Every statement that ends a hold deletes the row and lowers the count in one
 * statement — a `DELETE … RETURNING` feeding an `UPDATE` — so a sweep and a
 * conversion racing for the same hold lower the count once: the second finds
 * no row to delete. Timestamps handed to raw SQL are converted to UTC
 * explicitly, the way Prisma writes `DateTime` into `timestamp(3)`.
 */
@Injectable()
export class PrismaPromoCodeHoldRepository implements PromoCodeHoldRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async findByCheckoutOffer(
        checkoutOfferId: string,
        tx?: TransactionContext,
    ): Promise<PromoCodeHoldRecord | null> {
        return holdsOf(resolveClient(this.prisma, tx)).findUnique({
            where: { checkoutOfferId },
            select: HOLD_COLUMNS,
        });
    }

    async take(hold: {
        promoCodeId: string;
        checkoutOfferId: string;
        expiresAt: Date;
    }): Promise<PromoCodeHoldTaken> {
        return this.prisma.$transaction(async (tx) => {
            // Locking the code first serialises every take of it, so a second
            // take for the same offer finds the first one's row.
            const locked = (await tx.$queryRaw`
                SELECT id FROM promo_codes WHERE id = ${hold.promoCodeId} FOR UPDATE`) as unknown[];
            if (locked.length === 0) return { outcome: 'no-slot' };
            const held = await holdsOf(tx).findUnique({
                where: { checkoutOfferId: hold.checkoutOfferId },
                select: { id: true },
            });
            if (held) return { outcome: 'offer-holds-one' };
            const counted = await tx.$executeRaw`
                UPDATE promo_codes
                SET "heldCount" = "heldCount" + 1, "updatedAt" = NOW()
                WHERE id = ${hold.promoCodeId}
                  AND status = 'ACTIVE'
                  AND "deletedAt" IS NULL
                  AND ("maxRedemptions" IS NULL
                       OR "redemptionsCount" + "heldCount" < "maxRedemptions")`;
            if (counted !== 1) return { outcome: 'no-slot' };
            const created = await holdsOf(tx).create({
                data: { id: randomUUID(), ...hold },
                select: HOLD_COLUMNS,
            });
            return { outcome: 'taken', hold: created };
        });
    }

    async extend(checkoutOfferId: string, promoCodeId: string, expiresAt: Date): Promise<boolean> {
        const extended = await this.prisma.$executeRaw`
            UPDATE promo_code_holds
            SET "expiresAt" = GREATEST(
                "expiresAt",
                (${expiresAt.toISOString()}::timestamptz AT TIME ZONE 'UTC')
            )
            WHERE "checkoutOfferId" = ${checkoutOfferId} AND "promoCodeId" = ${promoCodeId}`;
        return extended === 1;
    }

    async release(checkoutOfferId: string, tx?: TransactionContext): Promise<boolean> {
        return this.giveBack(checkoutOfferId, null, tx);
    }

    async releaseIfUnmoved(checkoutOfferId: string, expiresAt: Date): Promise<boolean> {
        return this.giveBack(checkoutOfferId, expiresAt);
    }

    async handOver(checkoutOfferId: string, now: Date, tx: TransactionContext): Promise<boolean> {
        const marked = await resolveClient(this.prisma, tx).$executeRaw`
            UPDATE promo_code_holds
            SET "handedOverTx" = txid_current()
            WHERE "checkoutOfferId" = ${checkoutOfferId}
              AND "expiresAt" > (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
        return marked === 1;
    }

    async convertHandedOver(promoCodeId: string, tx: TransactionContext): Promise<boolean> {
        const converted = await resolveClient(this.prisma, tx).$executeRaw`
            WITH gone AS (
                DELETE FROM promo_code_holds
                WHERE id = (
                    SELECT id FROM promo_code_holds
                    WHERE "promoCodeId" = ${promoCodeId} AND "handedOverTx" = txid_current()
                    LIMIT 1
                )
                RETURNING "promoCodeId"
            )
            UPDATE promo_codes p
            SET "heldCount" = GREATEST(p."heldCount" - 1, 0),
                "redemptionsCount" = p."redemptionsCount" + 1,
                "updatedAt" = NOW()
            FROM gone
            WHERE p.id = gone."promoCodeId"`;
        return converted === 1;
    }

    async expireDue(now: Date, promoCodeId?: string, tx?: TransactionContext): Promise<number> {
        const rows = (await resolveClient(this.prisma, tx).$queryRaw`
            WITH gone AS (
                DELETE FROM promo_code_holds
                WHERE "expiresAt" <= (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
                  AND "handedOverTx" IS DISTINCT FROM txid_current()
                  AND (${promoCodeId ?? null}::text IS NULL OR "promoCodeId" = ${promoCodeId ?? null})
                RETURNING "promoCodeId"
            ),
            counted AS (
                SELECT "promoCodeId", COUNT(*)::int AS ended FROM gone GROUP BY "promoCodeId"
            ),
            given AS (
                UPDATE promo_codes p
                SET "heldCount" = GREATEST(p."heldCount" - counted.ended, 0), "updatedAt" = NOW()
                FROM counted
                WHERE p.id = counted."promoCodeId"
                RETURNING p.id
            )
            SELECT COALESCE(SUM(ended), 0)::int AS ended FROM counted`) as Array<{
            ended: number;
        }>;
        return rows[0]?.ended ?? 0;
    }

    /**
     * Deletes the offer's hold — only while it expires at `onlyAt`, where one
     * is given — and gives its slot back, in one statement.
     */
    private async giveBack(
        checkoutOfferId: string,
        onlyAt: Date | null,
        tx?: TransactionContext,
    ): Promise<boolean> {
        const at = onlyAt ? onlyAt.toISOString() : null;
        const released = await resolveClient(this.prisma, tx).$executeRaw`
            WITH gone AS (
                DELETE FROM promo_code_holds
                WHERE "checkoutOfferId" = ${checkoutOfferId}
                  AND (${at}::timestamptz IS NULL
                       OR "expiresAt" = (${at}::timestamptz AT TIME ZONE 'UTC'))
                RETURNING "promoCodeId"
            )
            UPDATE promo_codes p
            SET "heldCount" = GREATEST(p."heldCount" - 1, 0), "updatedAt" = NOW()
            FROM gone
            WHERE p.id = gone."promoCodeId"`;
        return released === 1;
    }
}

function holdsOf(client: PrismaTxLike): HoldClient['promoCodeHold'] {
    return (client as HoldClient).promoCodeHold;
}
