import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PromoCodeValidationLogRepository } from '@saasicat/types';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { promoCodeValidationLogs } from './schema.js';

/** `PromoCodeValidationLogRepository` against `promo_code_validation_logs`. */
@Injectable()
export class DrizzlePromoCodeValidationLogRepository implements PromoCodeValidationLogRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async log(args: {
        promoCodeId: string | null;
        codeAttempt: string;
        result: string;
        ipHash?: string;
        sessionId?: string;
    }): Promise<void> {
        await this.db.insert(promoCodeValidationLogs).values({
            id: randomUUID(),
            promoCodeId: args.promoCodeId,
            codeAttempt: args.codeAttempt.trim().toUpperCase(),
            result: args.result,
            ipHash: args.ipHash ?? null,
            sessionId: args.sessionId ?? null,
        });
    }

    async countValid(promoCodeId: string): Promise<number> {
        const rows = await this.db
            .select({ id: promoCodeValidationLogs.id })
            .from(promoCodeValidationLogs)
            .where(
                and(
                    eq(promoCodeValidationLogs.promoCodeId, promoCodeId),
                    eq(promoCodeValidationLogs.result, 'VALID'),
                ),
            );
        return rows.length;
    }
}
