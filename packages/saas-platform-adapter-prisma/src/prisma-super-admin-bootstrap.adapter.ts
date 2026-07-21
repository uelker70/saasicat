import { Inject, Injectable } from '@nestjs/common';
import type {
    CreateSuperAdminCliInput,
    PasswordHasher,
    PlatformRole,
    PlatformUserDto,
    SuperAdminProvisioningPort,
} from '@saasicat/types';
import { PlatformUserExistsError } from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaLike } from './prisma-client-token.js';

/**
 * DI token for the app's `PasswordHasher` implementation (argon2/bcrypt —
 * the algorithm stays app-specific). `prismaPersistence({ passwordHasher })`
 * wires it automatically; manual setups bind it themselves.
 */
export const PASSWORD_HASHER_TOKEN = Symbol.for('saasicat/adapter-prisma/PasswordHasher');

/**
 * `SuperAdminProvisioningPort` against the canonical `super_admin_users`
 * table (prisma-fragments/10-super-admin.prisma). Backs the first-run setup
 * wizard and `<app> user create-super-admin`.
 */
@Injectable()
export class PrismaSuperAdminBootstrapAdapter implements SuperAdminProvisioningPort {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike,
        @Inject(PASSWORD_HASHER_TOKEN) private readonly passwordHasher: PasswordHasher,
    ) {}

    async countSuperAdmins(): Promise<number> {
        return this.prisma.superAdminUser.count({ where: { isActive: true, deletedAt: null } });
    }

    async createSuperAdmin(input: CreateSuperAdminCliInput): Promise<PlatformUserDto> {
        const email = input.email.trim().toLowerCase();
        const existing = await this.prisma.superAdminUser.findUnique({ where: { email } });
        if (existing) {
            throw new PlatformUserExistsError(email, existing.platformRole as PlatformRole);
        }
        const row = await this.prisma.superAdminUser.create({
            data: {
                email,
                passwordHash: await this.passwordHasher.hash(input.password),
                firstName: input.firstName ?? null,
                lastName: input.lastName ?? null,
            },
        });
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
