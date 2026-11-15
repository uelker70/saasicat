import type {
    Paginated,
    PlatformRole,
    PlatformUserDto,
    UserListFilter,
    UserPort,
} from '@saasicat/core';

import type { PrismaService } from '../prisma/prisma.service';

/** The columns of `super_admin_users` an operator is described by. */
interface SuperAdminRow {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    platformRole: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    deletedAt: Date | null;
}

const NO_USER_COMMANDS =
    "The notes app's command line has no `user` command: it acts as an operator " +
    "and reads no tenant's users.";

/**
 * Who the notes app's command line acts as: the platform's SuperAdmins, kept in
 * `super_admin_users`, which the seed fills with `admin@notesapp.example`. The
 * CLI asks for an operator by e-mail and checks the second factor under the
 * id it gets back, so the id is the one the second factor was enrolled under —
 * the seed gives the demo admin the id `DemoAuthGuard` names it by.
 *
 * `UserPort` also lists, counts and resets a tenant's users, for the shared
 * `user` command. This CLI does not register that command, and the notes app
 * keeps no roles or passwords for its tenant users to answer it with, so those
 * three refuse rather than answer something made up.
 */
export class NotesOperators implements UserPort {
    constructor(private readonly prisma: PrismaService) {}

    async findById(id: string): Promise<PlatformUserDto | null> {
        const row = await this.prisma.superAdminUser.findUnique({ where: { id } });
        return row ? toOperator(row) : null;
    }

    async findByEmail(email: string): Promise<PlatformUserDto | null> {
        // The table keeps addresses lowercase, as the platform's adapters write them.
        const row = await this.prisma.superAdminUser.findUnique({
            where: { email: email.toLowerCase() },
        });
        return row ? toOperator(row) : null;
    }

    async hasRole(userId: string, role: PlatformRole): Promise<boolean> {
        const operator = await this.findById(userId);
        return operator?.platformRole === role;
    }

    countActive(_tenantId: string): Promise<number> {
        return Promise.reject(new Error(NO_USER_COMMANDS));
    }

    listForTenant(_tenantId: string, _filter: UserListFilter): Promise<Paginated<PlatformUserDto>> {
        return Promise.reject(new Error(NO_USER_COMMANDS));
    }

    resetPassword(_userId: string, _newHash: string): Promise<void> {
        return Promise.reject(new Error(NO_USER_COMMANDS));
    }
}

function toOperator(row: SuperAdminRow): PlatformUserDto {
    return {
        id: row.id,
        email: row.email,
        firstName: row.firstName ?? undefined,
        lastName: row.lastName ?? undefined,
        platformRole: toPlatformRole(row.platformRole),
        isActive: row.isActive,
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        deletedAt: row.deletedAt?.toISOString() ?? null,
    };
}

const PLATFORM_ROLES: readonly PlatformRole[] = ['SUPER_ADMIN', 'TENANT_ADMIN', 'TENANT_MEMBER'];

/** The column is free text; a value that names no platform role is refused, not guessed. */
function toPlatformRole(value: string): PlatformRole {
    const role = PLATFORM_ROLES.find((candidate) => candidate === value);
    if (!role) {
        throw new Error(`super_admin_users holds the role '${value}', which is no platform role.`);
    }
    return role;
}
