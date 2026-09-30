import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import {
    type SubscriptionNoticeDelivery,
    type SubscriptionNoticeKey,
    type SubscriptionNoticeKind,
    type SubscriptionNoticeRecord,
    type SubscriptionNoticeRepository,
    toSubscriptionNoticeRecord,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { subscriptionNotices } from './schema.js';

/** `SubscriptionNoticeRepository` against the canonical `subscription_notices` table. */
@Injectable()
export class DrizzleSubscriptionNoticeRepository implements SubscriptionNoticeRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    /**
     * An insert that meets the unique key does nothing, and the claim itself is
     * one guarded `UPDATE`: of two runs at the same moment the database lets one
     * change the row, and the other's condition no longer holds when it gets its
     * turn.
     */
    async claim(
        key: SubscriptionNoticeKey,
        content: unknown,
        now: Date,
        staleBefore: Date,
    ): Promise<SubscriptionNoticeRecord | null> {
        await this.db
            .insert(subscriptionNotices)
            .values({ id: randomUUID(), ...key, content, createdAt: now })
            .onConflictDoNothing({
                target: [
                    subscriptionNotices.subscriptionId,
                    subscriptionNotices.kind,
                    subscriptionNotices.subject,
                ],
            });
        const [row] = await this.db
            .update(subscriptionNotices)
            .set({ claimedAt: now, content })
            .where(
                and(
                    eq(subscriptionNotices.tenantId, key.tenantId),
                    eq(subscriptionNotices.subscriptionId, key.subscriptionId),
                    eq(subscriptionNotices.kind, key.kind),
                    eq(subscriptionNotices.subject, key.subject),
                    isNull(subscriptionNotices.deliveredAt),
                    or(
                        isNull(subscriptionNotices.claimedAt),
                        lt(subscriptionNotices.claimedAt, staleBefore),
                    ),
                ),
            )
            .returning();
        return row ? toSubscriptionNoticeRecord(row) : null;
    }

    async confirm(
        id: string,
        claimedAt: Date,
        delivery: SubscriptionNoticeDelivery,
        now: Date,
    ): Promise<boolean> {
        const rows = await this.db
            .update(subscriptionNotices)
            .set({
                deliveredAt: now,
                recipients: [...delivery.recipients],
                channel: delivery.channel,
            })
            .where(this.heldBy(id, claimedAt))
            .returning({ id: subscriptionNotices.id });
        return rows.length === 1;
    }

    async release(id: string, claimedAt: Date): Promise<void> {
        await this.db
            .update(subscriptionNotices)
            .set({ claimedAt: null })
            .where(this.heldBy(id, claimedAt));
    }

    async listDeliveredSubscriptionIds(
        kind: SubscriptionNoticeKind,
        subject: string,
    ): Promise<string[]> {
        const rows = await this.db
            .select({ subscriptionId: subscriptionNotices.subscriptionId })
            .from(subscriptionNotices)
            .where(
                and(
                    eq(subscriptionNotices.kind, kind),
                    eq(subscriptionNotices.subject, subject),
                    isNotNull(subscriptionNotices.deliveredAt),
                ),
            );
        return rows.map((row) => row.subscriptionId);
    }

    async listForSubscription(subscriptionId: string): Promise<SubscriptionNoticeRecord[]> {
        const rows = await this.db
            .select()
            .from(subscriptionNotices)
            .where(eq(subscriptionNotices.subscriptionId, subscriptionId))
            .orderBy(desc(subscriptionNotices.createdAt), desc(subscriptionNotices.id));
        return rows.map(toSubscriptionNoticeRecord);
    }

    /** The notice `id`, while the claim taken at `claimedAt` holds it and it is not delivered. */
    private heldBy(id: string, claimedAt: Date) {
        return and(
            eq(subscriptionNotices.id, id),
            eq(subscriptionNotices.claimedAt, claimedAt),
            isNull(subscriptionNotices.deliveredAt),
        );
    }
}
