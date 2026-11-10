import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
    type CanonicalSubscriptionEndRow,
    type NewSubscriptionEnd,
    type SubscriptionEnd,
    type SubscriptionEndPort,
    toSubscriptionEnd,
    utcMidnightOf,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the injected client used by this repository. */
interface SubscriptionEndPrisma {
    subscriptionEnd: PrismaModelDelegateLike<CanonicalSubscriptionEndRow>;
}

/**
 * What the constructor takes: a client that has the delegate. A client
 * generated from a schema without fragment 29 fails to compile here rather
 * than at the first run.
 */
interface SubscriptionEndRepositoryClient {
    subscriptionEnd: unknown;
}

/** The columns a read asks for, named, so a column a later release adds is not read. */
const COLUMNS = {
    id: true,
    tenantId: true,
    subscriptionId: true,
    endsAt: true,
    deletesOn: true,
    recordedAt: true,
    recordedBy: true,
} as const;

/** `SubscriptionEndPort` against the canonical `subscription_ends` table. */
@Injectable()
export class PrismaSubscriptionEndRepository implements SubscriptionEndPort {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: SubscriptionEndRepositoryClient,
    ) {}

    private get db(): SubscriptionEndPrisma {
        // SAFETY: `subscriptionEnd` is the delegate of fragment 29's model,
        // whose rows are `CanonicalSubscriptionEndRow`; the bundle hands this
        // repository the canonical client.
        return this.prisma as SubscriptionEndPrisma;
    }

    /**
     * One statement, `skipDuplicates` being `ON CONFLICT DO NOTHING`: the
     * unique key on `subscriptionId` is what refuses a second end, and it
     * refuses by returning no row rather than by raising. The id is a uuid made
     * here, so the primary key cannot be the key it met.
     */
    async record(end: NewSubscriptionEnd): Promise<SubscriptionEnd | null> {
        const [row] = await this.db.subscriptionEnd.createManyAndReturn({
            data: [{ id: randomUUID(), ...end, deletesOn: utcMidnightOf(end.deletesOn) }],
            skipDuplicates: true,
        });
        return row ? toSubscriptionEnd(row) : null;
    }

    async listFor(subscriptionIds: readonly string[]): Promise<SubscriptionEnd[]> {
        if (subscriptionIds.length === 0) return [];
        const rows = await this.db.subscriptionEnd.findMany({
            where: { subscriptionId: { in: [...subscriptionIds] } },
            select: COLUMNS,
            orderBy: { subscriptionId: 'asc' },
        });
        return rows.map(toSubscriptionEnd);
    }
}
