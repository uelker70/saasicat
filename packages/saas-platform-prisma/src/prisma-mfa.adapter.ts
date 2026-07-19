import { Inject, Injectable } from '@nestjs/common';
import type { MfaPort } from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaLike } from './prisma-client-token.js';

/**
 * Default-Implementation für `MfaPort` gegen die `SuperAdminMfa`-Tabelle
 * aus dem Plattform-Prisma-Fragment.
 *
 * Schema-Annahme:
 *
 * ```prisma
 * model SuperAdminMfa {
 *     userId    String   @id
 *     secret    String?
 *     enabledAt DateTime?
 *     updatedAt DateTime @updatedAt
 * }
 * ```
 */
@Injectable()
export class PrismaMfaAdapter implements MfaPort {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async getSecret(userId: string): Promise<string | null> {
        const row = await this.prisma.superAdminMfa.findUnique({ where: { userId } });
        return row?.secret ?? null;
    }

    async setSecret(userId: string, secret: string | null): Promise<void> {
        const enabledAt = secret ? new Date() : null;
        await this.prisma.superAdminMfa.upsert({
            where: { userId },
            create: { userId, secret, enabledAt },
            update: { secret, enabledAt },
        });
    }

    async isEnabled(userId: string): Promise<boolean> {
        const row = await this.prisma.superAdminMfa.findUnique({ where: { userId } });
        return !!row?.secret && !!row?.enabledAt;
    }
}
