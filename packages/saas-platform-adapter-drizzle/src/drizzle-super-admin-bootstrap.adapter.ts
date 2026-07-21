import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import type {
    CreateSuperAdminCliInput,
    PasswordHasher,
    PlatformRole,
    PlatformUserDto,
    SuperAdminProvisioningPort,
} from '@saasicat/types';
import { PlatformUserExistsError } from '@saasicat/types';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { superAdminUsers } from './schema.js';

/**
 * DI token for the app's `PasswordHasher` implementation (argon2/bcrypt —
 * the algorithm stays app-specific). `drizzlePersistence({ passwordHasher })`
 * wires it automatically; manual setups bind it themselves.
 */
export const PASSWORD_HASHER_TOKEN = Symbol.for('saasicat/adapter-drizzle/PasswordHasher');

/**
 * `SuperAdminProvisioningPort` against the canonical `super_admin_users`
 * table. Backs the first-run setup wizard and `<app> user create-super-admin`.
 */
@Injectable()
export class DrizzleSuperAdminBootstrapAdapter implements SuperAdminProvisioningPort {
    constructor(
        @Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient,
        @Inject(PASSWORD_HASHER_TOKEN) private readonly passwordHasher: PasswordHasher,
    ) {}

    async countSuperAdmins(): Promise<number> {
        const rows = await this.db
            .select({ value: count() })
            .from(superAdminUsers)
            .where(and(eq(superAdminUsers.isActive, true), isNull(superAdminUsers.deletedAt)));
        return rows[0]?.value ?? 0;
    }

    async createSuperAdmin(input: CreateSuperAdminCliInput): Promise<PlatformUserDto> {
        const email = input.email.trim().toLowerCase();
        const existing = await this.db
            .select()
            .from(superAdminUsers)
            .where(eq(superAdminUsers.email, email))
            .limit(1);
        if (existing[0]) {
            throw new PlatformUserExistsError(email, existing[0].platformRole as PlatformRole);
        }
        const rows = await this.db
            .insert(superAdminUsers)
            .values({
                id: randomUUID(),
                email,
                passwordHash: await this.passwordHasher.hash(input.password),
                firstName: input.firstName ?? null,
                lastName: input.lastName ?? null,
                updatedAt: new Date(),
            })
            .returning();
        const row = rows[0] as typeof superAdminUsers.$inferSelect;
        return {
            id: row.id,
            email: row.email,
            firstName: row.firstName ?? undefined,
            lastName: row.lastName ?? undefined,
            platformRole: row.platformRole as PlatformRole,
            isActive: row.isActive,
            lastLoginAt: null,
            deletedAt: null,
        };
    }
}
