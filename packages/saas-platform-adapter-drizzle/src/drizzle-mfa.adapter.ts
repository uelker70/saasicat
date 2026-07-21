import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { MfaPort } from '@saasicat/types';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { superAdminMfa } from './schema.js';

/**
 * Default implementation of `MfaPort` against the canonical
 * `super_admin_mfa` table (prisma-fragments/10-super-admin.prisma).
 */
@Injectable()
export class DrizzleMfaAdapter implements MfaPort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async getSecret(userId: string): Promise<string | null> {
        const rows = await this.db
            .select()
            .from(superAdminMfa)
            .where(eq(superAdminMfa.userId, userId))
            .limit(1);
        return rows[0]?.secret ?? null;
    }

    async setSecret(userId: string, secret: string | null): Promise<void> {
        const enabledAt = secret ? new Date() : null;
        await this.db
            .insert(superAdminMfa)
            .values({ userId, secret, enabledAt, updatedAt: new Date() })
            .onConflictDoUpdate({
                target: superAdminMfa.userId,
                set: { secret, enabledAt, updatedAt: new Date() },
            });
    }

    async isEnabled(userId: string): Promise<boolean> {
        const rows = await this.db
            .select()
            .from(superAdminMfa)
            .where(eq(superAdminMfa.userId, userId))
            .limit(1);
        const row = rows[0];
        return !!row?.secret && !!row?.enabledAt;
    }
}
