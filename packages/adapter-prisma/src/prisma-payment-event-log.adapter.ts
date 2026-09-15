import { Inject, Injectable } from '@nestjs/common';
import type { PaymentEventClaim, PaymentEventLog, TransactionContext } from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

interface PaymentEventLogPrisma {
    paymentEventLog: Pick<PrismaModelDelegateLike<unknown>, 'createMany'>;
}

/** `PaymentEventLog` against the canonical `"PaymentEventLog"` table. */
@Injectable()
export class PrismaPaymentEventLog implements PaymentEventLog {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: unknown,
    ) {}

    async claim(claim: PaymentEventClaim, tx: TransactionContext): Promise<boolean> {
        const db = (tx ?? this.prisma) as PaymentEventLogPrisma;
        // `skipDuplicates` is `ON CONFLICT DO NOTHING`: a claim this account
        // already holds is no row rather than an error, so the caller's
        // transaction stays usable.
        const { count } = await db.paymentEventLog.createMany({
            data: [
                {
                    gatewayAccount: claim.gatewayAccount,
                    eventId: claim.eventId,
                    provider: claim.provider,
                    sessionId: claim.sessionId,
                    status: claim.kind,
                    payload: claim.summary,
                },
            ],
            skipDuplicates: true,
        });
        return count === 1;
    }
}
