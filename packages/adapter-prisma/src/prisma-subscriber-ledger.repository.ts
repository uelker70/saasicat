import { Inject, Injectable } from '@nestjs/common';
import type {
    CanonicalSubscriberChargeRow,
    NewSubscriberCharge,
    SubscriberChargeRecord,
    SubscriberLedgerRepository,
    TransactionContext,
} from '@saasicat/core';
import { subscriberChargeColumns, toSubscriberChargeRecord } from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the client and of a transaction client, which carry the same delegate. */
interface LedgerPrisma {
    subscriberLedgerEntry: PrismaModelDelegateLike<CanonicalSubscriberChargeRow> & {
        /** `INSERT … ON CONFLICT DO NOTHING RETURNING *`, which PostgreSQL supports. */
        createManyAndReturn(args: {
            data: ReturnType<typeof subscriberChargeColumns>[];
            skipDuplicates: boolean;
        }): Promise<CanonicalSubscriberChargeRow[]>;
    };
}

interface LedgerClient {
    subscriberLedgerEntry: unknown;
}

/** `SubscriberLedgerRepository` against `subscriber_ledger_entries`. Append-only. */
@Injectable()
export class PrismaSubscriberLedgerRepository implements SubscriberLedgerRepository {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: LedgerClient,
    ) {}

    private db(tx?: TransactionContext): LedgerPrisma {
        return (tx ?? this.prisma) as unknown as LedgerPrisma;
    }

    /**
     * One statement, `skipDuplicates` being `ON CONFLICT DO NOTHING`: a charge
     * another caller wrote first — committed or still in flight — is waited for
     * and skipped rather than raised, and only what this call wrote comes back.
     * It names no conflict target, so it suppresses every unique key; the only
     * one besides the natural key is the primary key, a uuid made per row here.
     */
    async recordCharges(
        charges: readonly NewSubscriberCharge[],
        tx?: TransactionContext,
    ): Promise<SubscriberChargeRecord[]> {
        if (charges.length === 0) return [];
        const rows = await this.db(tx).subscriberLedgerEntry.createManyAndReturn({
            data: charges.map(subscriberChargeColumns),
            skipDuplicates: true,
        });
        return rows.map(toSubscriberChargeRecord);
    }

    async listBySubscription(
        subscriptionId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberChargeRecord[]> {
        const rows = await this.db(tx).subscriberLedgerEntry.findMany({
            where: { subscriptionId },
            orderBy: [
                { periodStart: 'asc' },
                { source: 'asc' },
                { sourceRef: 'asc' },
                { origin: 'asc' },
            ],
        });
        return rows.map(toSubscriberChargeRecord);
    }
}
