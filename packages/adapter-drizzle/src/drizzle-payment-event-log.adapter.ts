import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PaymentEventClaim, PaymentEventLog, TransactionContext } from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { paymentEventLog } from './schema.js';

/** `PaymentEventLog` against the canonical `"PaymentEventLog"` table. */
@Injectable()
export class DrizzlePaymentEventLog implements PaymentEventLog {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async claim(claim: PaymentEventClaim, tx: TransactionContext): Promise<boolean> {
        // Doing nothing on the conflict makes a claim this account already holds
        // no row rather than an error, so the caller's transaction stays usable.
        const inserted = await resolveDb(this.db, tx)
            .insert(paymentEventLog)
            .values({
                id: randomUUID(),
                gatewayAccount: claim.gatewayAccount,
                eventId: claim.eventId,
                provider: claim.provider,
                sessionId: claim.sessionId,
                status: claim.kind,
                payload: claim.summary,
            })
            .onConflictDoNothing()
            .returning({ id: paymentEventLog.id });
        return inserted.length === 1;
    }
}
