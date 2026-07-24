import { Inject, Injectable } from '@nestjs/common';
import type {
    CancelSubscriptionBundleData,
    CreateSubscriptionBundleData,
    SubscriptionBundleRecord,
    SubscriptionBundleRepository,
    TransactionContext,
} from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** DB columns this repository reads from `subscription_bundles`. */
interface SubscriptionBundleDbRow {
    id: string;
    subscriptionId: string;
    bundleVersionId: string;
    startedAt: Date;
    minimumTermEndsAt: Date | null;
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

/** Narrow view of the injected client used by this repository. */
interface SubscriptionBundlePrisma {
    subscriptionBundle: PrismaModelDelegateLike<SubscriptionBundleDbRow>;
}

interface SubscriptionBundleClient {
    subscriptionBundle: unknown;
}

/**
 * `SubscriptionBundleRepository` against the canonical `subscription_bundles`
 * junction (SPEC_V2 §11.1 M6 Pack 2e). Dumb persistence: domain constraints
 * (plan compatibility, minimum-term default, cancellation-window computation)
 * live in the platform's `SubscriptionBundlesService`; `add`/`cancel` here only
 * write what they are handed. "Active" is `canceledAt IS NULL OR
 * canceledEffectiveAt > asOf`, mirroring the port contract.
 */
@Injectable()
export class PrismaSubscriptionBundleRepository implements SubscriptionBundleRepository {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: SubscriptionBundleClient,
    ) {}

    private db(tx?: TransactionContext): SubscriptionBundlePrisma {
        return (tx ?? this.prisma) as unknown as SubscriptionBundlePrisma;
    }

    async listBySubscription(subscriptionId: string): Promise<SubscriptionBundleRecord[]> {
        const rows = await this.db().subscriptionBundle.findMany({
            where: { subscriptionId },
            orderBy: { startedAt: 'desc' },
        });
        return rows.map(toRecord);
    }

    async findById(subscriptionBundleId: string): Promise<SubscriptionBundleRecord | null> {
        const row = await this.db().subscriptionBundle.findUnique({
            where: { id: subscriptionBundleId },
        });
        return row ? toRecord(row) : null;
    }

    async listActiveBySubscription(
        subscriptionId: string,
        asOf: Date = new Date(),
    ): Promise<SubscriptionBundleRecord[]> {
        const rows = await this.db().subscriptionBundle.findMany({
            where: {
                subscriptionId,
                OR: [{ canceledAt: null }, { canceledEffectiveAt: { gt: asOf } }],
            },
            orderBy: { startedAt: 'desc' },
        });
        return rows.map(toRecord);
    }

    async add(data: CreateSubscriptionBundleData): Promise<SubscriptionBundleRecord> {
        const row = await this.db().subscriptionBundle.create({
            data: {
                subscriptionId: data.subscriptionId,
                bundleVersionId: data.bundleVersionId,
                startedAt: data.startedAt,
                minimumTermEndsAt: data.minimumTermEndsAt ?? null,
            },
        });
        return toRecord(row);
    }

    async cancel(
        subscriptionBundleId: string,
        data: CancelSubscriptionBundleData,
    ): Promise<SubscriptionBundleRecord> {
        const row = await this.db().subscriptionBundle.update({
            where: { id: subscriptionBundleId },
            data: {
                canceledAt: data.canceledAt,
                canceledEffectiveAt: data.canceledEffectiveAt,
            },
        });
        return toRecord(row);
    }

    async reactivate(subscriptionBundleId: string): Promise<SubscriptionBundleRecord> {
        const row = await this.db().subscriptionBundle.update({
            where: { id: subscriptionBundleId },
            data: { canceledAt: null, canceledEffectiveAt: null },
        });
        return toRecord(row);
    }

    async countActiveByBundleVersionId(
        bundleVersionId: string,
        asOf: Date = new Date(),
    ): Promise<number> {
        return this.db().subscriptionBundle.count({
            where: {
                bundleVersionId,
                OR: [{ canceledAt: null }, { canceledEffectiveAt: { gt: asOf } }],
            },
        });
    }
}

function toRecord(row: SubscriptionBundleDbRow): SubscriptionBundleRecord {
    return {
        id: row.id,
        subscriptionId: row.subscriptionId,
        bundleVersionId: row.bundleVersionId,
        startedAt: row.startedAt,
        minimumTermEndsAt: row.minimumTermEndsAt,
        canceledAt: row.canceledAt,
        canceledEffectiveAt: row.canceledEffectiveAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}
