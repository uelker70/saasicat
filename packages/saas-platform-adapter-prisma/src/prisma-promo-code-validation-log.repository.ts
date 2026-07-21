import { Inject, Injectable } from '@nestjs/common';
import type { PromoCodeValidationLogRepository } from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaLike } from './prisma-client-token.js';

/** `PromoCodeValidationLogRepository` against `promo_code_validation_logs`. */
@Injectable()
export class PrismaPromoCodeValidationLogRepository implements PromoCodeValidationLogRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async log(args: {
        promoCodeId: string | null;
        codeAttempt: string;
        result: string;
        ipHash?: string;
        sessionId?: string;
    }): Promise<void> {
        await this.prisma.promoCodeValidationLog.create({
            data: {
                promoCodeId: args.promoCodeId,
                codeAttempt: args.codeAttempt.trim().toUpperCase(),
                result: args.result,
                ipHash: args.ipHash ?? null,
                sessionId: args.sessionId ?? null,
            },
        });
    }

    async countValid(promoCodeId: string): Promise<number> {
        return this.prisma.promoCodeValidationLog.count({
            where: { promoCodeId, result: 'VALID' },
        });
    }
}
