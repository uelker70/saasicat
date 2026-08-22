import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { BillingCycle, PromoSubscriptionLookup, TransactionContext } from '@saasicat/types';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { subscriptions } from './schema.js';

/** `PromoSubscriptionLookup` against the canonical `subscriptions` table. */
@Injectable()
export class DrizzlePromoSubscriptionLookup implements PromoSubscriptionLookup {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async findById(
        subscriptionId: string,
        tx?: TransactionContext,
    ): Promise<{
        id: string;
        tenantId: string;
        plan: string;
        billingCycle: BillingCycle;
        startedAt: Date | null;
    } | null> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .select({
                id: subscriptions.id,
                tenantId: subscriptions.tenantId,
                plan: subscriptions.plan,
                billingCycle: subscriptions.billingCycle,
                startedAt: subscriptions.startedAt,
            })
            .from(subscriptions)
            .where(eq(subscriptions.id, subscriptionId))
            .limit(1);
        const row = rows[0];
        if (!row) return null;
        return {
            id: row.id,
            tenantId: row.tenantId,
            plan: row.plan,
            billingCycle: row.billingCycle as BillingCycle,
            startedAt: row.startedAt,
        };
    }
}
