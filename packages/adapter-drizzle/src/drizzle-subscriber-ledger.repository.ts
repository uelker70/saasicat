import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import type {
    NewSubscriberCharge,
    SubscriberChargeRecord,
    SubscriberLedgerRepository,
    TransactionContext,
} from '@saasicat/core';
import {
    assertCorrectionsFitTheirCharges,
    correctedChargeIdsOf,
    subscriberChargeColumns,
    toSubscriberChargeRecord,
} from '@saasicat/core';
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
     * A correction among them is checked against the charge it names first.
     */
    async recordCharges(
        charges: readonly NewSubscriberCharge[],
        tx?: TransactionContext,
    ): Promise<SubscriberChargeRecord[]> {
        if (charges.length === 0) return [];
        const values = charges.map((charge) => ({
            id: randomUUID(),
            ...subscriberChargeColumns(charge),
        }));
        assertCorrectionsFitTheirCharges(charges, await this.correctedChargesOf(charges, tx));
        const rows = await resolveDb(this.db, tx)
            .insert(subscriberLedgerEntries)
            .values(values)
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

    private async correctedChargesOf(
        charges: readonly NewSubscriberCharge[],
        tx?: TransactionContext,
    ): Promise<SubscriberChargeRecord[]> {
        const ids = correctedChargeIdsOf(charges);
        if (ids.length === 0) return [];
        const rows = await resolveDb(this.db, tx)
            .select()
            .from(subscriberLedgerEntries)
            .where(inArray(subscriberLedgerEntries.id, ids));
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
