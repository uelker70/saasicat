import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type {
    NewSubscriberCharge,
    SubscriberChargeRecord,
    SubscriberLedgerRepository,
    TransactionContext,
} from '@saasicat/core';
import { subscriberChargeColumns, toSubscriberChargeRecord } from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { subscriberLedgerEntries } from './schema.js';

/** `SubscriberLedgerRepository` against `subscriber_ledger_entries`. Append-only. */
@Injectable()
export class DrizzleSubscriberLedgerRepository implements SubscriberLedgerRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    /**
     * One statement, `ON CONFLICT DO NOTHING` on the natural key: a charge
     * another caller wrote first — committed or still in flight — is waited for
     * and skipped rather than raised, and only what this call wrote comes back.
     */
    async recordCharges(
        charges: readonly NewSubscriberCharge[],
        tx?: TransactionContext,
    ): Promise<SubscriberChargeRecord[]> {
        if (charges.length === 0) return [];
        const rows = await resolveDb(this.db, tx)
            .insert(subscriberLedgerEntries)
            .values(
                charges.map((charge) => ({ id: randomUUID(), ...subscriberChargeColumns(charge) })),
            )
            .onConflictDoNothing({
                target: [
                    subscriberLedgerEntries.subscriptionId,
                    subscriberLedgerEntries.source,
                    subscriberLedgerEntries.sourceRef,
                    subscriberLedgerEntries.periodStart,
                    subscriberLedgerEntries.origin,
                ],
            })
            .returning();
        return rows.map(toSubscriberChargeRecord);
    }

    async listBySubscription(
        subscriptionId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberChargeRecord[]> {
        const rows = await resolveDb(this.db, tx)
            .select()
            .from(subscriberLedgerEntries)
            .where(eq(subscriberLedgerEntries.subscriptionId, subscriptionId))
            .orderBy(
                asc(subscriberLedgerEntries.periodStart),
                asc(subscriberLedgerEntries.source),
                asc(subscriberLedgerEntries.sourceRef),
                asc(subscriberLedgerEntries.origin),
            );
        return rows.map(toSubscriberChargeRecord);
    }
}
