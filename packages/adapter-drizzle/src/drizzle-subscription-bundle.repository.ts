import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type {
    CancelSubscriptionBundleData,
    CreateSubscriptionBundleData,
    SubscriptionBundleRecord,
    SubscriptionBundleRepository,
    TransactionContext,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { subscriptionBundles } from './schema.js';

type SubscriptionBundleRow = typeof subscriptionBundles.$inferSelect;

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
            .where(eq(subscriptionBundles.subscriptionId, subscriptionId));
        return rows.map(toRecord);
    }

    async findById(subscriptionBundleId: string): Promise<SubscriptionBundleRecord | null> {
        const rows = await this.db
            .select()
            .from(subscriptionBundles)
            .where(eq(subscriptionBundles.id, subscriptionBundleId))
            .limit(1);
        return rows[0] ? toRecord(rows[0]) : null;
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
        return rows.map(toRecord);
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
        return toRecord(rows[0]);
    }

    async cancel(
        subscriptionBundleId: string,
        data: CancelSubscriptionBundleData,
    ): Promise<SubscriptionBundleRecord> {
        const rows = await this.db
            .update(subscriptionBundles)
            .set({
                canceledAt: data.canceledAt,
                canceledEffectiveAt: data.canceledEffectiveAt,
                updatedAt: new Date(),
            })
            .where(eq(subscriptionBundles.id, subscriptionBundleId))
            .returning();
        if (!rows[0]) throw new Error(`SubscriptionBundle '${subscriptionBundleId}' not found`);
        return toRecord(rows[0]);
    }

    async reactivate(subscriptionBundleId: string): Promise<SubscriptionBundleRecord> {
        const rows = await this.db
            .update(subscriptionBundles)
            .set({ canceledAt: null, canceledEffectiveAt: null, updatedAt: new Date() })
            .where(eq(subscriptionBundles.id, subscriptionBundleId))
            .returning();
        if (!rows[0]) throw new Error(`SubscriptionBundle '${subscriptionBundleId}' not found`);
        return toRecord(rows[0]);
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
 * Active: never cancelled, or cancelled for a date still ahead.
 *
 * `isNull` on both columns rather than on `canceledAt` alone, because a row
 * may carry an effective date without the request date on the legacy reading —
 * and a comparison against NULL is neither true nor false in SQL, so a booking
 * with no effective date would silently drop out of every "active" list.
 */
function stillActive(asOf: Date) {
    return or(
        and(
            isNull(subscriptionBundles.canceledAt),
            isNull(subscriptionBundles.canceledEffectiveAt),
        ),
        gt(subscriptionBundles.canceledEffectiveAt, asOf),
    );
}

function toRecord(row: SubscriptionBundleRow): SubscriptionBundleRecord {
    return {
        id: row.id,
        subscriptionId: row.subscriptionId,
        bundleVersionId: row.bundleVersionId,
        startedAt: row.startedAt,
        minimumTermEndsAt: row.minimumTermEndsAt,
        billingCycle: row.billingCycle,
        currentPeriodStart: row.currentPeriodStart,
        currentPeriodEnd: row.currentPeriodEnd,
        canceledAt: row.canceledAt,
        canceledEffectiveAt: row.canceledEffectiveAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
