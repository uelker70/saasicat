import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
    type CanonicalFeatureWithdrawalRow,
    type FeatureWithdrawalLift,
    type FeatureWithdrawalRecord,
    type FeatureWithdrawalRepository,
    type NewFeatureWithdrawal,
    type TransactionContext,
    toFeatureWithdrawalRecord,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the injected client used by this repository. */
interface FeatureWithdrawalPrisma {
    featureWithdrawal: PrismaModelDelegateLike<CanonicalFeatureWithdrawalRow>;
}

/** The columns a read asks for, named, so a column a later release adds is not read. */
const COLUMNS = {
    id: true,
    featureKey: true,
    reason: true,
    effectiveFrom: true,
    liftedFrom: true,
    reductions: true,
    announcedAt: true,
    announcedBy: true,
    liftedAt: true,
    liftedBy: true,
} as const;

/** `FeatureWithdrawalRepository` against the canonical `feature_withdrawals` table. */
@Injectable()
export class PrismaFeatureWithdrawalRepository implements FeatureWithdrawalRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: unknown) {}

    private client(tx?: TransactionContext): FeatureWithdrawalPrisma {
        return (tx ?? this.prisma) as FeatureWithdrawalPrisma;
    }

    /**
     * One statement, `skipDuplicates` being `ON CONFLICT DO NOTHING`: the
     * partial unique index that holds a feature to one withdrawal not lifted is
     * what refuses the second, and it refuses by returning no row rather than
     * by raising. The id is a uuid made here, so the primary key cannot be the
     * key it met.
     */
    async create(
        data: NewFeatureWithdrawal,
        tx?: TransactionContext,
    ): Promise<FeatureWithdrawalRecord | null> {
        const [row] = await this.client(tx).featureWithdrawal.createManyAndReturn({
            data: [
                {
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
                },
            ],
            skipDuplicates: true,
        });
        return row ? toFeatureWithdrawalRecord(row) : null;
    }

    async list(): Promise<FeatureWithdrawalRecord[]> {
        const rows = await this.client().featureWithdrawal.findMany({
            select: COLUMNS,
            orderBy: [{ announcedAt: 'desc' }, { id: 'desc' }],
        });
        return rows.map(toFeatureWithdrawalRecord);
    }

    async findById(id: string): Promise<FeatureWithdrawalRecord | null> {
        const row = await this.client().featureWithdrawal.findFirst({
            where: { id },
            select: COLUMNS,
        });
        return row ? toFeatureWithdrawalRecord(row) : null;
    }

    /**
     * One guarded `UPDATE`: the withdrawal not being lifted is in the `WHERE`,
     * so a second operator lifting it a moment later leaves the count at zero
     * instead of moving the date the first one recorded.
     */
    async lift(
        id: string,
        lift: FeatureWithdrawalLift,
        tx?: TransactionContext,
    ): Promise<FeatureWithdrawalRecord | null> {
        const db = this.client(tx);
        const { count } = await db.featureWithdrawal.updateMany({
            where: { id, liftedFrom: null },
            data: {
                liftedFrom: lift.liftedFrom,
                liftedAt: lift.liftedAt,
                liftedBy: lift.liftedBy,
            },
        });
        if (count !== 1) return null;
        const row = await db.featureWithdrawal.findFirst({ where: { id }, select: COLUMNS });
        return row ? toFeatureWithdrawalRecord(row) : null;
    }
}
