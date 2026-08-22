import { Inject, Injectable } from '@nestjs/common';
import type { BillingCycle, PromoSubscriptionLookup, TransactionContext } from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaLike } from './prisma-client-token.js';
import { resolveClient } from './tx.js';

/** `PromoSubscriptionLookup` against the canonical `subscriptions` table. */
@Injectable()
export class PrismaPromoSubscriptionLookup implements PromoSubscriptionLookup {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

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
        const db = resolveClient(this.prisma, tx);
        const row = await db.subscription.findUnique({ where: { id: subscriptionId } });
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
