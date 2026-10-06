import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
    type FeatureWithdrawalLift,
    type FeatureWithdrawalRecord,
    type FeatureWithdrawalRepository,
    type NewFeatureWithdrawal,
    type TransactionContext,
    toFeatureWithdrawalRecord,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient, resolveDb } from './client.js';
import { featureWithdrawals } from './schema.js';

/** `FeatureWithdrawalRepository` against the canonical `feature_withdrawals` table. */
@Injectable()
export class DrizzleFeatureWithdrawalRepository implements FeatureWithdrawalRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    /**
     * `ON CONFLICT DO NOTHING` with no target, because the key it has to meet
     * is the partial unique index on withdrawals not lifted, which has no
     * constraint to name. The id is a uuid made here, so the primary key cannot
     * be the key it met: no row back means the feature is withdrawn already.
     */
    async create(
        data: NewFeatureWithdrawal,
        tx?: TransactionContext,
    ): Promise<FeatureWithdrawalRecord | null> {
        const [row] = await resolveDb(this.db, tx)
            .insert(featureWithdrawals)
            .values({
                id: randomUUID(),
                featureKey: data.featureKey,
                reason: data.reason,
                effectiveFrom: data.effectiveFrom,
                liftedFrom: null,
                reductions: data.reductions.map((reduction) => ({ ...reduction })),
                announcedAt: data.announcedAt,
                announcedBy: data.announcedBy,
                liftedAt: null,
                liftedBy: null,
            })
            .onConflictDoNothing()
            .returning();
        return row ? toFeatureWithdrawalRecord(row) : null;
    }

    async list(): Promise<FeatureWithdrawalRecord[]> {
        const rows = await this.db
            .select()
            .from(featureWithdrawals)
            .orderBy(desc(featureWithdrawals.announcedAt), desc(featureWithdrawals.id));
        return rows.map(toFeatureWithdrawalRecord);
    }

    async findById(id: string): Promise<FeatureWithdrawalRecord | null> {
        const [row] = await this.db
            .select()
            .from(featureWithdrawals)
            .where(eq(featureWithdrawals.id, id));
        return row ? toFeatureWithdrawalRecord(row) : null;
    }

    /**
     * One guarded `UPDATE`: the withdrawal not being lifted is in the `WHERE`,
     * so a second operator lifting it a moment later gets no row back instead
     * of moving the date the first one recorded.
     */
    async lift(
        id: string,
        lift: FeatureWithdrawalLift,
        tx?: TransactionContext,
    ): Promise<FeatureWithdrawalRecord | null> {
        const [row] = await resolveDb(this.db, tx)
            .update(featureWithdrawals)
            .set({ liftedFrom: lift.liftedFrom, liftedAt: lift.liftedAt, liftedBy: lift.liftedBy })
            .where(and(eq(featureWithdrawals.id, id), isNull(featureWithdrawals.liftedFrom)))
            .returning();
        return row ? toFeatureWithdrawalRecord(row) : null;
    }
}
