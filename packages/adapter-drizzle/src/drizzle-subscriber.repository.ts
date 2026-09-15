import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type {
    CreateSubscriberData,
    SubscriberContactChange,
    SubscriberCorrectionData,
    SubscriberCorrectionRecord,
    SubscriberCorrectionResult,
    SubscriberRecord,
    SubscriberRepository,
    TransactionContext,
} from '@saasicat/core';
import {
    identityCorrectionDelta,
    toSubscriberCorrectionRecord,
    toSubscriberRecord,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { subscriberCorrections, subscriberTenants, subscribers } from './schema.js';

type SubscriberTableRow = typeof subscribers.$inferSelect;

/**
 * `SubscriberRepository` against `subscribers`, `subscriber_tenants` and
 * `subscriber_corrections`.
 *
 * The customer number is the column default: the database counts, from where
 * `constraints.postgres.sql` starts it, so two subscribers created at once
 * never share a number.
 */
@Injectable()
export class DrizzleSubscriberRepository implements SubscriberRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async createForTenant(
        data: CreateSubscriberData,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord | null> {
        const { tenantId, ...details } = data;
        const now = new Date();
        const subscriberId = randomUUID();
        // The subscriber and its link are one fact: both or neither, as a
        // savepoint on the caller's transaction when it has one.
        return resolveDb(this.db, tx).transaction(async (transaction) => {
            const db = transaction as unknown as DrizzleClient;
            const [created] = await db
                .insert(subscribers)
                .values({ ...details, id: subscriberId, createdAt: now, updatedAt: now })
                .returning();
            // A tenant's live link is unique in the database. Doing nothing on
            // the conflict turns a second one into no row rather than an error,
            // so the caller's transaction survives the refusal; the subscriber
            // written above goes with it.
            const linked = await db
                .insert(subscriberTenants)
                .values({ id: randomUUID(), subscriberId, tenantId, linkedAt: now })
                .onConflictDoNothing()
                .returning();
            if (linked.length === 0) {
                await db.delete(subscribers).where(eq(subscribers.id, subscriberId));
                return null;
            }
            return toSubscriberRecord(created, tenantId);
        });
    }

    async findById(
        subscriberId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord | null> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .select()
            .from(subscribers)
            .where(eq(subscribers.id, subscriberId))
            .limit(1);
        return rows[0] ? this.withLiveTenant(db, rows[0]) : null;
    }

    async findByTenantId(
        tenantId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord | null> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .select({ subscriber: subscribers })
            .from(subscriberTenants)
            .innerJoin(subscribers, eq(subscribers.id, subscriberTenants.subscriberId))
            .where(
                and(eq(subscriberTenants.tenantId, tenantId), isNull(subscriberTenants.unlinkedAt)),
            )
            .limit(1);
        return rows[0] ? toSubscriberRecord(rows[0].subscriber, tenantId) : null;
    }

    async updateContact(
        subscriberId: string,
        change: SubscriberContactChange,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord | null> {
        const db = resolveDb(this.db, tx);
        const rows = await db
            .update(subscribers)
            .set({ ...change, updatedAt: new Date() })
            .where(eq(subscribers.id, subscriberId))
            .returning();
        return rows[0] ? this.withLiveTenant(db, rows[0]) : null;
    }

    async correctIdentity(
        subscriberId: string,
        data: SubscriberCorrectionData,
        tx?: TransactionContext,
    ): Promise<SubscriberCorrectionResult | null> {
        return resolveDb(this.db, tx).transaction(async (transaction) => {
            const db = transaction as unknown as DrizzleClient;
            // Held until the transaction ends, so a correction arriving at the
            // same time reads the values this one wrote, and records those as
            // the ones it replaces.
            const [current] = await db
                .select()
                .from(subscribers)
                .where(eq(subscribers.id, subscriberId))
                .for('update')
                .limit(1);
            if (!current) return null;
            const delta = identityCorrectionDelta(current, data.corrected);
            if (Object.keys(delta.corrected).length === 0) {
                return { subscriber: await this.withLiveTenant(db, current), correction: null };
            }
            const [updated] = await db
                .update(subscribers)
                .set({ ...delta.corrected, updatedAt: new Date() })
                .where(eq(subscribers.id, subscriberId))
                .returning();
            const [correction] = await db
                .insert(subscriberCorrections)
                .values({
                    id: randomUUID(),
                    subscriberId,
                    previous: delta.previous,
                    corrected: delta.corrected,
                    reason: data.reason,
                    correctedBy: data.correctedBy,
                    correctedAt: data.correctedAt,
                })
                .returning();
            return {
                subscriber: await this.withLiveTenant(db, updated),
                correction: toSubscriberCorrectionRecord(correction),
            };
        });
    }

    async listCorrections(subscriberId: string): Promise<SubscriberCorrectionRecord[]> {
        const rows = await this.db
            .select()
            .from(subscriberCorrections)
            .where(eq(subscriberCorrections.subscriberId, subscriberId))
            .orderBy(desc(subscriberCorrections.correctedAt), desc(subscriberCorrections.id));
        return rows.map(toSubscriberCorrectionRecord);
    }

    private async withLiveTenant(
        db: DrizzleClient,
        row: SubscriberTableRow,
    ): Promise<SubscriberRecord> {
        const links = await db
            .select({ tenantId: subscriberTenants.tenantId })
            .from(subscriberTenants)
            .where(
                and(
                    eq(subscriberTenants.subscriberId, row.id),
                    isNull(subscriberTenants.unlinkedAt),
                ),
            )
            .limit(1);
        return toSubscriberRecord(row, links[0]?.tenantId ?? null);
    }
}
