import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type SQL, and, asc, desc, eq, gte, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import {
    type NoticeToRecord,
    type SubscriptionNoticeDelivery,
    type SubscriptionNoticeKey,
    type SubscriptionNoticeKind,
    type SubscriptionNoticeRecord,
    type SubscriptionNoticeRepository,
    type TransactionContext,
    toSubscriptionNoticeRecord,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient, resolveDb } from './client.js';
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

    /**
     * Two guarded `UPDATE`s, the second only where the first changed nothing:
     * a notice whose recipients a tenant's deletion forgot while it was held
     * keeps how many it went to and not to whom. Recipients once forgotten stay
     * forgotten, so a deletion between the two leaves the second to match.
     */
    async confirm(
        id: string,
        claimedAt: Date,
        delivery: SubscriptionNoticeDelivery,
        now: Date,
    ): Promise<boolean> {
        const deliver = (recipients: readonly string[], forgotten: SQL) =>
            this.db
                .update(subscriptionNotices)
                .set({
                    deliveredAt: now,
                    recipients: [...recipients],
                    channel: delivery.channel,
                    recipientCount: delivery.recipients.length,
                })
                .where(and(this.heldBy(id, claimedAt), forgotten))
                .returning({ id: subscriptionNotices.id });
        const told = await deliver(
            delivery.recipients,
            isNull(subscriptionNotices.recipientsForgottenAt),
        );
        if (told.length === 1) return true;
        const forgotten = await deliver([], isNotNull(subscriptionNotices.recipientsForgottenAt));
        return forgotten.length === 1;
    }

    /**
     * One `UPDATE`: the number is counted from the recipients the same
     * statement empties. A notice not delivered keeps no recipients to empty,
     * and is marked all the same.
     */
    async forgetRecipients(tenantId: string, at: Date, tx?: TransactionContext): Promise<number> {
        const { recipients, recipientCount } = subscriptionNotices;
        const forgotten = await resolveDb(this.db, tx)
            .update(subscriptionNotices)
            .set({
                recipientCount: sql`COALESCE(${recipientCount}, CASE WHEN jsonb_typeof(${recipients}) = 'array' THEN jsonb_array_length(${recipients}) END)`,
                recipients: sql`CASE WHEN ${recipients} IS NULL THEN NULL ELSE '[]'::jsonb END`,
                recipientsForgottenAt: at,
            })
            .where(
                and(
                    eq(subscriptionNotices.tenantId, tenantId),
                    isNull(subscriptionNotices.recipientsForgottenAt),
                ),
            )
            .returning({ id: subscriptionNotices.id });
        return forgotten.length;
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

    async record(
        notices: readonly NoticeToRecord[],
        now: Date,
        tx?: TransactionContext,
    ): Promise<number> {
        if (notices.length === 0) return 0;
        const written = await resolveDb(this.db, tx)
            .insert(subscriptionNotices)
            .values(
                notices.map(({ content, ...key }) => ({
                    id: randomUUID(),
                    tenantId: key.tenantId,
                    subscriptionId: key.subscriptionId,
                    kind: key.kind,
                    subject: key.subject,
                    content,
                    createdAt: now,
                })),
            )
            .onConflictDoNothing({
                target: [
                    subscriptionNotices.subscriptionId,
                    subscriptionNotices.kind,
                    subscriptionNotices.subject,
                ],
            })
            .returning({ id: subscriptionNotices.id });
        return written.length;
    }

    async listOfKindSince(
        kind: SubscriptionNoticeKind,
        since: Date,
    ): Promise<SubscriptionNoticeRecord[]> {
        const rows = await this.db
            .select()
            .from(subscriptionNotices)
            .where(
                and(eq(subscriptionNotices.kind, kind), gte(subscriptionNotices.createdAt, since)),
            )
            .orderBy(desc(subscriptionNotices.createdAt), desc(subscriptionNotices.id));
        return rows.map(toSubscriptionNoticeRecord);
    }

    async listUndelivered(
        kind: SubscriptionNoticeKind,
        staleBefore: Date,
    ): Promise<SubscriptionNoticeRecord[]> {
        const rows = await this.db
            .select()
            .from(subscriptionNotices)
            .where(
                and(
                    eq(subscriptionNotices.kind, kind),
                    isNull(subscriptionNotices.deliveredAt),
                    or(
                        isNull(subscriptionNotices.claimedAt),
                        lt(subscriptionNotices.claimedAt, staleBefore),
                    ),
                ),
            )
            .orderBy(asc(subscriptionNotices.createdAt), asc(subscriptionNotices.id));
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
