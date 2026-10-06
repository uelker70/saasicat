import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import {
    subscriptionBundleAlreadyCancelled,
    subscriptionBundleGone,
    toSubscriptionBundleRecord,
    type CancelSubscriptionBundleData,
    type CreateSubscriptionBundleData,
    type EndNowInput,
    type SubscriptionBundleRecord,
    type SubscriptionBundleRepository,
    type TransactionContext,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { subscriptionBundles } from './schema.js';

/**
 * `SubscriptionBundleRepository` against the canonical `subscription_bundles`
 * table — the junction between a subscription and the add-ons booked on it.
 *
 * Dumb persistence on purpose. What a booking may commit to, when its period
 * ends and whether a cancellation is allowed are decided above this layer; an
 * adapter that decided any of it would stop being interchangeable with the
 * ones that do not. The only judgement here is what "active" means, and that
 * is the same predicate the port documents: no cancellation, or one whose
 * effective date is still ahead.
 */
@Injectable()
export class DrizzleSubscriptionBundleRepository implements SubscriptionBundleRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async listBySubscription(subscriptionId: string): Promise<SubscriptionBundleRecord[]> {
        const rows = await this.db
            .select()
            .from(subscriptionBundles)
            .where(eq(subscriptionBundles.subscriptionId, subscriptionId))
            // Newest first, as the port says and `adapter-prisma` does. Without
            // an ORDER BY, PostgreSQL is free to return any order it likes, and
            // the tenant's "My bundles" list keeps whatever the repository
            // handed over — so the page would reorder itself between reloads
            // for no reason a reader could see.
            .orderBy(desc(subscriptionBundles.startedAt));
        return rows.map(toSubscriptionBundleRecord);
    }

    async listOfVersion(bundleVersionId: string): Promise<SubscriptionBundleRecord[]> {
        const rows = await this.db
            .select()
            .from(subscriptionBundles)
            .where(eq(subscriptionBundles.bundleVersionId, bundleVersionId))
            .orderBy(desc(subscriptionBundles.startedAt), asc(subscriptionBundles.id));
        return rows.map(toSubscriptionBundleRecord);
    }

    async findById(subscriptionBundleId: string): Promise<SubscriptionBundleRecord | null> {
        const rows = await this.db
            .select()
            .from(subscriptionBundles)
            .where(eq(subscriptionBundles.id, subscriptionBundleId))
            .limit(1);
        return rows[0] ? toSubscriptionBundleRecord(rows[0]) : null;
    }

    async listActiveBySubscription(
        subscriptionId: string,
        asOf: Date = new Date(),
        tx?: TransactionContext,
    ): Promise<SubscriptionBundleRecord[]> {
        const rows = await resolveDb(this.db, tx)
            .select()
            .from(subscriptionBundles)
            .where(and(eq(subscriptionBundles.subscriptionId, subscriptionId), stillActive(asOf)));
        return rows.map(toSubscriptionBundleRecord);
    }

    async add(data: CreateSubscriptionBundleData): Promise<SubscriptionBundleRecord> {
        const now = new Date();
        const rows = await this.db
            .insert(subscriptionBundles)
            .values({
                id: randomUUID(),
                subscriptionId: data.subscriptionId,
                bundleVersionId: data.bundleVersionId,
                startedAt: data.startedAt ?? now,
                minimumTermEndsAt: data.minimumTermEndsAt ?? null,
                billingCycle: data.billingCycle ?? null,
                currentPeriodStart: data.currentPeriodStart ?? null,
                currentPeriodEnd: data.currentPeriodEnd ?? null,
                canceledAt: null,
                canceledEffectiveAt: null,
                updatedAt: now,
            })
            .returning();
        return toSubscriptionBundleRecord(rows[0]);
    }

    async cancel(
        subscriptionBundleId: string,
        data: CancelSubscriptionBundleData,
    ): Promise<SubscriptionBundleRecord> {
        // Conditional on the booking still being uncancelled, so a second
        // request cannot overwrite the first one's dates.
        //
        // The service checks first and answers `SUBSCRIPTION_BUNDLE_ALREADY_
        // CANCELLED`, which handles the ordinary case; what it cannot handle is
        // two requests passing that check together. The loser would then move
        // an effective date the tenant has already been told — the one field in
        // this row that decides when they stop being billed.
        const rows = await this.db
            .update(subscriptionBundles)
            .set({
                canceledAt: data.canceledAt,
                canceledEffectiveAt: data.canceledEffectiveAt,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(subscriptionBundles.id, subscriptionBundleId),
                    isNull(subscriptionBundles.canceledAt),
                ),
            )
            .returning();
        if (rows[0]) return toSubscriptionBundleRecord(rows[0]);
        // Nothing claimed: the row is gone, or another request cancelled it
        // between the caller's read and this write. A read says which.
        const [row] = await this.db
            .select({ id: subscriptionBundles.id })
            .from(subscriptionBundles)
            .where(eq(subscriptionBundles.id, subscriptionBundleId))
            .limit(1);
        throw row
            ? subscriptionBundleAlreadyCancelled(subscriptionBundleId)
            : subscriptionBundleGone(subscriptionBundleId);
    }

    async moveToVersion(
        subscriptionBundleId: string,
        from: string,
        to: string,
    ): Promise<SubscriptionBundleRecord | null> {
        const rows = await this.db
            .update(subscriptionBundles)
            .set({ bundleVersionId: to, updatedAt: new Date() })
            .where(
                and(
                    eq(subscriptionBundles.id, subscriptionBundleId),
                    eq(subscriptionBundles.bundleVersionId, from),
                ),
            )
            .returning();
        return rows[0] ? toSubscriptionBundleRecord(rows[0]) : null;
    }

    async scheduleVersion(
        subscriptionBundleId: string,
        switchTo: { from: string; to: string; effectiveAt: Date },
    ): Promise<SubscriptionBundleRecord | null> {
        const rows = await this.db
            .update(subscriptionBundles)
            .set({
                pendingBundleVersionId: switchTo.to,
                pendingVersionEffectiveAt: switchTo.effectiveAt,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(subscriptionBundles.id, subscriptionBundleId),
                    eq(subscriptionBundles.bundleVersionId, switchTo.from),
                    isNull(subscriptionBundles.pendingBundleVersionId),
                ),
            )
            .returning();
        return rows[0] ? toSubscriptionBundleRecord(rows[0]) : null;
    }

    async unscheduleVersion(
        subscriptionBundleId: string,
        to: string,
    ): Promise<SubscriptionBundleRecord | null> {
        const rows = await this.db
            .update(subscriptionBundles)
            .set({
                pendingBundleVersionId: null,
                pendingVersionEffectiveAt: null,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(subscriptionBundles.id, subscriptionBundleId),
                    eq(subscriptionBundles.pendingBundleVersionId, to),
                ),
            )
            .returning();
        return rows[0] ? toSubscriptionBundleRecord(rows[0]) : null;
    }

    async listScheduledVersionsDue(asOf: Date): Promise<SubscriptionBundleRecord[]> {
        const rows = await this.db
            .select()
            .from(subscriptionBundles)
            .where(lte(subscriptionBundles.pendingVersionEffectiveAt, asOf))
            .orderBy(
                asc(subscriptionBundles.pendingVersionEffectiveAt),
                asc(subscriptionBundles.id),
            );
        return rows.map(toSubscriptionBundleRecord);
    }

    /**
     * One guarded `UPDATE`: the effective date the caller read is in the
     * `WHERE`, so a cancellation moved or reinstated between the read and the
     * write returns no row instead of being overwritten.
     */
    async endNow(
        subscriptionBundleId: string,
        input: EndNowInput,
    ): Promise<SubscriptionBundleRecord | null> {
        const [row] = await this.db
            .update(subscriptionBundles)
            .set({ canceledAt: input.at, canceledEffectiveAt: input.at, updatedAt: new Date() })
            .where(
                and(
                    eq(subscriptionBundles.id, subscriptionBundleId),
                    eq(subscriptionBundles.canceledEffectiveAt, input.expectedCanceledEffectiveAt),
                ),
            )
            .returning();
        return row ? toSubscriptionBundleRecord(row) : null;
    }

    async reactivate(subscriptionBundleId: string): Promise<SubscriptionBundleRecord> {
        const rows = await this.db
            .update(subscriptionBundles)
            .set({ canceledAt: null, canceledEffectiveAt: null, updatedAt: new Date() })
            .where(eq(subscriptionBundles.id, subscriptionBundleId))
            .returning();
        if (!rows[0]) throw new Error(`SubscriptionBundle '${subscriptionBundleId}' not found`);
        return toSubscriptionBundleRecord(rows[0]);
    }

    async countActiveByBundleVersionId(
        bundleVersionId: string,
        asOf: Date = new Date(),
    ): Promise<number> {
        const rows = await this.db
            .select({ id: subscriptionBundles.id })
            .from(subscriptionBundles)
            .where(
                and(eq(subscriptionBundles.bundleVersionId, bundleVersionId), stillActive(asOf)),
            );
        return rows.length;
    }
}

/**
 * Active: nobody asked to cancel it, or the cancellation lands later.
 *
 * The port writes the rule out — `canceledAt IS NULL OR canceledEffectiveAt >
 * NOW()` — and `adapter-prisma` implements exactly that, so this is not a place
 * to have an opinion. Requiring BOTH columns to be null for the first branch
 * looks equivalent and is not: a row with no request date but a past effective
 * date then reads as inactive here and active there, and a tenant on Drizzle
 * would be granted less than the same tenant on Prisma. The shape is incoherent
 * data either way; what matters is that both adapters answer it the same, which
 * is the whole reason the contract exists.
 */
function stillActive(asOf: Date) {
    return or(
        isNull(subscriptionBundles.canceledAt),
        gt(subscriptionBundles.canceledEffectiveAt, asOf),
    );
}
