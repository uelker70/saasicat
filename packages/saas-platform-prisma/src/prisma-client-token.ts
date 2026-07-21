// PRISMA_CLIENT_TOKEN — DI token to which the consumer binds their
// PrismaService. All adapters in the package inject against this token so they
// do not depend on a concrete `PrismaService` class token.
//
// ```ts
// providers: [
//     { provide: PRISMA_CLIENT_TOKEN, useExisting: PrismaService },
//     PrismaMfaAdapter,
//     // ...
// ];
// ```

export const PRISMA_CLIENT_TOKEN = Symbol.for('saas-platform-prisma/PrismaClient');

/**
 * Structural sub-interface of `@prisma/client.PrismaClient`. The adapters
 * expect only the table delegates they actually use — no hard import on
 * `@prisma/client`, so the package builds without a Prisma generate and can be
 * mocked in tests.
 *
 * A consumer's `PrismaService extends PrismaClient` satisfies the interface
 * automatically.
 */
export interface PrismaLike {
    superAdminMfa: {
        findUnique(args: { where: { userId: string } }): Promise<{
            userId: string;
            secret: string | null;
            enabledAt: Date | null;
            updatedAt: Date;
        } | null>;
        upsert(args: {
            where: { userId: string };
            create: { userId: string; secret: string | null; enabledAt: Date | null };
            update: { secret: string | null; enabledAt: Date | null };
        }): Promise<unknown>;
    };
    auditEntry: {
        create(args: {
            data: {
                actorEmail: string;
                actorRole: string;
                entity: string;
                entityId: string;
                action: string;
                changes: unknown;
            };
        }): Promise<unknown>;
    };
    superAdminUser: {
        findUnique(args: { where: { email: string } }): Promise<{
            id: string;
            email: string;
            platformRole?: string | null;
            isActive?: boolean | null;
            createdAt: Date;
            updatedAt: Date;
        } | null>;
        create(args: {
            data: { email: string; platformRole?: string; isActive?: boolean };
        }): Promise<{
            id: string;
            email: string;
            platformRole?: string | null;
            isActive?: boolean | null;
            createdAt: Date;
            updatedAt: Date;
        }>;
    };
}
