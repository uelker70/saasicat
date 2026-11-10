import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { asc, inArray } from 'drizzle-orm';
import {
    type NewSubscriptionEnd,
    type SubscriptionEnd,
    type SubscriptionEndPort,
    toSubscriptionEnd,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { subscriptionEnds } from './schema.js';

/** `SubscriptionEndPort` against the canonical `subscription_ends` table. */
@Injectable()
export class DrizzleSubscriptionEndRepository implements SubscriptionEndPort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    /**
     * `ON CONFLICT DO NOTHING`: the unique key on `subscriptionId` is what
     * refuses a second end. The id is a uuid made here, so the primary key
     * cannot be the key it met: no row back means the subscription has an end
     * already.
     */
    async record(end: NewSubscriptionEnd): Promise<SubscriptionEnd | null> {
        const [row] = await this.db
            .insert(subscriptionEnds)
            .values({ id: randomUUID(), ...end })
            .onConflictDoNothing()
            .returning();
        return row ? toSubscriptionEnd(row) : null;
    }

    async listFor(subscriptionIds: readonly string[]): Promise<SubscriptionEnd[]> {
        if (subscriptionIds.length === 0) return [];
        const rows = await this.db
            .select()
            .from(subscriptionEnds)
            .where(inArray(subscriptionEnds.subscriptionId, [...subscriptionIds]))
            .orderBy(asc(subscriptionEnds.subscriptionId));
        return rows.map(toSubscriptionEnd);
    }
}
