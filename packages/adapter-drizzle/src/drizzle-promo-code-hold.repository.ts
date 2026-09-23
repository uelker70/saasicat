import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type {
    PromoCodeHoldRecord,
    PromoCodeHoldRepository,
    PromoCodeHoldTaken,
    TransactionContext,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { hasFreeSlot } from './drizzle-promo-code.repository.js';
import { promoCodeHolds, promoCodes } from './schema.js';

const HOLD_FIELDS = {
    id: promoCodeHolds.id,
    promoCodeId: promoCodeHolds.promoCodeId,
    checkoutOfferId: promoCodeHolds.checkoutOfferId,
    expiresAt: promoCodeHolds.expiresAt,
    createdAt: promoCodeHolds.createdAt,
};

/** The transaction a conclusion runs on, as Postgres numbers it. */
const CURRENT_TRANSACTION = sql`txid_current()`;

/**
 * `PromoCodeHoldRepository` against the canonical `promo_code_holds` table and
 * the `heldCount` of `promo_codes`.
 *
 * A hold ends by deleting its row and lowering the count on one transaction —
 * a savepoint on the caller's, or one opened here. Two callers ending the same hold both
 * delete it; the second blocks on the first and then finds no row, so the
 * count drops once.
 */
@Injectable()
export class DrizzlePromoCodeHoldRepository implements PromoCodeHoldRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async findByCheckoutOffer(
        checkoutOfferId: string,
        tx?: TransactionContext,
    ): Promise<PromoCodeHoldRecord | null> {
        const rows = await resolveDb(this.db, tx)
            .select(HOLD_FIELDS)
            .from(promoCodeHolds)
            .where(eq(promoCodeHolds.checkoutOfferId, checkoutOfferId))
            .limit(1);
        return rows[0] ?? null;
    }

    async take(hold: {
        promoCodeId: string;
        checkoutOfferId: string;
        expiresAt: Date;
    }): Promise<PromoCodeHoldTaken> {
        return this.onTransaction(undefined, async (db) => {
            // Locking the code first serialises every take of it, so a second
            // take for the same offer finds the first one's row.
            const code = await db
                .select({ id: promoCodes.id })
                .from(promoCodes)
                .where(eq(promoCodes.id, hold.promoCodeId))
                .for('update');
            if (code.length === 0) return { outcome: 'no-slot' };
            const held = await db
                .select({ id: promoCodeHolds.id })
                .from(promoCodeHolds)
                .where(eq(promoCodeHolds.checkoutOfferId, hold.checkoutOfferId))
                .limit(1);
            if (held.length > 0) return { outcome: 'offer-holds-one' };
            const counted = await db
                .update(promoCodes)
                .set({ heldCount: sql`${promoCodes.heldCount} + 1`, updatedAt: new Date() })
                .where(hasFreeSlot(hold.promoCodeId))
                .returning({ id: promoCodes.id });
            if (counted.length === 0) return { outcome: 'no-slot' };
            const [created] = await db
                .insert(promoCodeHolds)
                .values({ id: randomUUID(), ...hold })
                .returning(HOLD_FIELDS);
            return { outcome: 'taken', hold: created };
        });
    }

    async extend(checkoutOfferId: string, promoCodeId: string, expiresAt: Date): Promise<boolean> {
        const extended = await this.db
            .update(promoCodeHolds)
            .set({ expiresAt })
            .where(
                and(
                    eq(promoCodeHolds.checkoutOfferId, checkoutOfferId),
                    eq(promoCodeHolds.promoCodeId, promoCodeId),
                ),
            )
            .returning({ id: promoCodeHolds.id });
        return extended.length === 1;
    }

    async release(checkoutOfferId: string, tx?: TransactionContext): Promise<boolean> {
        return this.onTransaction(tx, async (db) => {
            const gone = await db
                .delete(promoCodeHolds)
                .where(eq(promoCodeHolds.checkoutOfferId, checkoutOfferId))
                .returning({ promoCodeId: promoCodeHolds.promoCodeId });
            await giveBack(db, gone, { redeemed: false });
            return gone.length === 1;
        });
    }

    async handOver(checkoutOfferId: string, now: Date, tx: TransactionContext): Promise<boolean> {
        const marked = await resolveDb(this.db, tx)
            .update(promoCodeHolds)
            .set({ handedOverTx: CURRENT_TRANSACTION })
            .where(
                and(
                    eq(promoCodeHolds.checkoutOfferId, checkoutOfferId),
                    gt(promoCodeHolds.expiresAt, now),
                ),
            )
            .returning({ id: promoCodeHolds.id });
        return marked.length === 1;
    }

    async convertHandedOver(promoCodeId: string, tx: TransactionContext): Promise<boolean> {
        const db = resolveDb(this.db, tx);
        const handedOver = await db
            .select({ id: promoCodeHolds.id })
            .from(promoCodeHolds)
            .where(
                and(
                    eq(promoCodeHolds.promoCodeId, promoCodeId),
                    eq(promoCodeHolds.handedOverTx, CURRENT_TRANSACTION),
                ),
            )
            .limit(1);
        if (handedOver.length === 0) return false;
        const gone = await db
            .delete(promoCodeHolds)
            .where(eq(promoCodeHolds.id, handedOver[0].id))
            .returning({ promoCodeId: promoCodeHolds.promoCodeId });
        await giveBack(db, gone, { redeemed: true });
        return gone.length === 1;
    }

    async expireDue(now: Date, promoCodeId?: string, tx?: TransactionContext): Promise<number> {
        return this.onTransaction(tx, async (db) => {
            const gone = await db
                .delete(promoCodeHolds)
                .where(
                    and(
                        lte(promoCodeHolds.expiresAt, now),
                        sql`${promoCodeHolds.handedOverTx} IS DISTINCT FROM ${CURRENT_TRANSACTION}`,
                        promoCodeId ? eq(promoCodeHolds.promoCodeId, promoCodeId) : undefined,
                    ),
                )
                .returning({ promoCodeId: promoCodeHolds.promoCodeId });
            await giveBack(db, gone, { redeemed: false });
            return gone.length;
        });
    }

    /** Runs `work` on a transaction of its own, a savepoint where the caller has one. */
    private onTransaction<T>(
        tx: TransactionContext | undefined,
        work: (db: DrizzleClient) => Promise<T>,
    ): Promise<T> {
        return resolveDb(this.db, tx).transaction((transaction) =>
            work(transaction as unknown as DrizzleClient),
        );
    }
}

/**
 * Lowers `heldCount` by the holds that ended, per code and in a fixed order of
 * codes so that two sweeps lock them in the same order. A hold that became a
 * redemption moves its slot to `redemptionsCount` instead of freeing it.
 */
async function giveBack(
    db: DrizzleClient,
    ended: ReadonlyArray<{ promoCodeId: string }>,
    { redeemed }: { redeemed: boolean },
): Promise<void> {
    const perCode = new Map<string, number>();
    for (const { promoCodeId } of ended) {
        perCode.set(promoCodeId, (perCode.get(promoCodeId) ?? 0) + 1);
    }
    for (const promoCodeId of [...perCode.keys()].sort()) {
        const count = perCode.get(promoCodeId) ?? 0;
        await db
            .update(promoCodes)
            .set({
                heldCount: sql`GREATEST(${promoCodes.heldCount} - ${count}, 0)`,
                ...(redeemed
                    ? { redemptionsCount: sql`${promoCodes.redemptionsCount} + ${count}` }
                    : {}),
                updatedAt: new Date(),
            })
            .where(eq(promoCodes.id, promoCodeId));
    }
}
