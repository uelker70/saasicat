import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type {
    CreateSubscriberData,
    RecordedVatIdCheck,
    SubscriberBusinessStatusData,
    SubscriberBusinessStatusResult,
    SubscriberContactChange,
    SubscriberCorrectionData,
    SubscriberCorrectionRecord,
    SubscriberCorrectionResult,
    SubscriberRecord,
    SubscriberRepository,
    SubscriberTaxOriginChangeRecord,
    SubscriberVatIdCheckRecord,
    TaxOriginWrite,
    TransactionContext,
    VatIdCheck,
} from '@saasicat/core';
import {
    identityCorrectionDelta,
    keepsVatIdCheck,
    taxOriginWrite,
    toSubscriberCorrectionRecord,
    toSubscriberRecord,
    toSubscriberTaxOriginChangeRecord,
    toSubscriberVatIdCheckRecord,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import {
    subscriberCorrections,
    subscriberTaxOriginChanges,
    subscriberTenants,
    subscriberVatIdChecks,
    subscribers,
} from './schema.js';

type SubscriberTableRow = typeof subscribers.$inferSelect;

/**
 * `SubscriberRepository` against `subscribers`, `subscriber_tenants`,
 * `subscriber_corrections`, `subscriber_tax_origin_changes` and
 * `subscriber_vat_id_checks`.
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
        changedBy: string,
        tx?: TransactionContext,
    ): Promise<SubscriberRecord | null> {
        return resolveDb(this.db, tx).transaction(async (transaction) => {
            const db = transaction as unknown as DrizzleClient;
            // Locked as a correction is, so the country recorded as replaced is
            // the one this write replaced.
            const current = await lockedSubscriber(db, subscriberId);
            if (!current) return null;
            const changedAt = new Date();
            const origin = taxOriginWrite(current, { country: change.country });
            const [updated] = await db
                .update(subscribers)
                .set({ ...change, updatedAt: changedAt })
                .where(eq(subscribers.id, subscriberId))
                .returning();
            await recordTaxOriginChange(db, subscriberId, origin, changedBy, changedAt);
            return this.withLiveTenant(db, updated);
        });
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
            const current = await lockedSubscriber(db, subscriberId);
            if (!current) return null;
            const delta = identityCorrectionDelta(current, data.corrected);
            if (Object.keys(delta.corrected).length === 0) {
                return { subscriber: await this.withLiveTenant(db, current), correction: null };
            }
            const changedAt = new Date();
            const origin = taxOriginWrite(current, { vatId: delta.corrected.vatId });
            const [updated] = await db
                .update(subscribers)
                .set({
                    ...delta.corrected,
                    ...(origin.endsCountingVatIdCheck
                        ? { currentVatIdCheckId: null, vatIdSince: changedAt }
                        : {}),
                    updatedAt: changedAt,
                })
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
                    correctedAt: changedAt,
                })
                .returning();
            await recordTaxOriginChange(db, subscriberId, origin, data.correctedBy, changedAt);
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
            .orderBy(desc(subscriberCorrections.seq));
        return rows.map(toSubscriberCorrectionRecord);
    }

    async changeBusinessStatus(
        subscriberId: string,
        data: SubscriberBusinessStatusData,
        tx?: TransactionContext,
    ): Promise<SubscriberBusinessStatusResult | null> {
        return resolveDb(this.db, tx).transaction(async (transaction) => {
            const db = transaction as unknown as DrizzleClient;
            const current = await lockedSubscriber(db, subscriberId);
            if (!current) return null;
            const origin = taxOriginWrite(current, { business: data.business });
            if (!origin.moved) {
                return { subscriber: await this.withLiveTenant(db, current), change: null };
            }
            const changedAt = new Date();
            const [updated] = await db
                .update(subscribers)
                .set({ business: data.business, updatedAt: changedAt })
                .where(eq(subscribers.id, subscriberId))
                .returning();
            const change = await recordTaxOriginChange(
                db,
                subscriberId,
                origin,
                data.changedBy,
                changedAt,
            );
            return { subscriber: await this.withLiveTenant(db, updated), change };
        });
    }

    async recordVatIdCheck(
        subscriberId: string,
        check: VatIdCheck,
        tx?: TransactionContext,
    ): Promise<RecordedVatIdCheck | null> {
        return resolveDb(this.db, tx).transaction(async (transaction) => {
            const db = transaction as unknown as DrizzleClient;
            const current = await lockedSubscriber(db, subscriberId);
            if (!current) return null;
            const [row] = await db
                .insert(subscriberVatIdChecks)
                .values({
                    id: randomUUID(),
                    subscriberId,
                    vatId: check.vatId,
                    checkedAt: check.checkedAt,
                    valid: check.valid,
                    service: check.service,
                    confirmation: { ...check.confirmation },
                })
                .returning();
            const recorded = toSubscriberVatIdCheckRecord(row);
            const counting = await vatIdCheckById(db, current.currentVatIdCheckId);
            if (!keepsVatIdCheck(current, counting, recorded)) {
                return { recorded, current: counting };
            }
            await db
                .update(subscribers)
                .set({ currentVatIdCheckId: recorded.id, updatedAt: new Date() })
                .where(eq(subscribers.id, subscriberId));
            return { recorded, current: recorded };
        });
    }

    async findCurrentVatIdCheck(
        subscriberId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberVatIdCheckRecord | null> {
        const db = resolveDb(this.db, tx);
        const [row] = await db
            .select({ currentVatIdCheckId: subscribers.currentVatIdCheckId })
            .from(subscribers)
            .where(eq(subscribers.id, subscriberId))
            .limit(1);
        return vatIdCheckById(db, row?.currentVatIdCheckId ?? null);
    }

    async listVatIdChecks(subscriberId: string): Promise<SubscriberVatIdCheckRecord[]> {
        const rows = await this.db
            .select()
            .from(subscriberVatIdChecks)
            .where(eq(subscriberVatIdChecks.subscriberId, subscriberId))
            .orderBy(
                desc(subscriberVatIdChecks.checkedAt),
                desc(subscriberVatIdChecks.recordedAt),
                desc(subscriberVatIdChecks.id),
            );
        return rows.map(toSubscriberVatIdCheckRecord);
    }

    async listTaxOriginChanges(subscriberId: string): Promise<SubscriberTaxOriginChangeRecord[]> {
        const rows = await this.db
            .select()
            .from(subscriberTaxOriginChanges)
            .where(eq(subscriberTaxOriginChanges.subscriberId, subscriberId))
            .orderBy(desc(subscriberTaxOriginChanges.seq));
        return rows.map(toSubscriberTaxOriginChangeRecord);
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

/**
 * The subscriber row, locked until the transaction ends: a correction, a
 * contact change and a change of the business status arriving at once each
 * read the values the other wrote.
 */
async function lockedSubscriber(
    db: DrizzleClient,
    subscriberId: string,
): Promise<SubscriberTableRow | undefined> {
    const [row] = await db
        .select()
        .from(subscribers)
        .where(eq(subscribers.id, subscriberId))
        .for('update')
        .limit(1);
    return row;
}

/** A recorded check by its id; `null` for no id, or one that names no row. */
async function vatIdCheckById(
    db: DrizzleClient,
    checkId: string | null,
): Promise<SubscriberVatIdCheckRecord | null> {
    if (checkId === null) return null;
    const [row] = await db
        .select()
        .from(subscriberVatIdChecks)
        .where(eq(subscriberVatIdChecks.id, checkId))
        .limit(1);
    return row ? toSubscriberVatIdCheckRecord(row) : null;
}

/** Records what a write moved of the tax origin; nothing when it moved nothing. */
async function recordTaxOriginChange(
    db: DrizzleClient,
    subscriberId: string,
    origin: TaxOriginWrite,
    changedBy: string,
    changedAt: Date,
): Promise<SubscriberTaxOriginChangeRecord | null> {
    if (!origin.moved) return null;
    const [row] = await db
        .insert(subscriberTaxOriginChanges)
        .values({
            id: randomUUID(),
            subscriberId,
            previous: origin.previous,
            changed: origin.changed,
            changedBy,
            changedAt,
        })
        .returning();
    return toSubscriberTaxOriginChangeRecord(row);
}
