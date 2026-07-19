// PRISMA_CLIENT_TOKEN — DI-Token, an das der Konsument seinen PrismaService
// bindet. Alle Adapter im Paket injecten gegen dieses Token, damit sie nicht
// von einem konkreten `PrismaService`-Class-Token abhängen.
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
 * Strukturelles Sub-Interface von `@prisma/client.PrismaClient`. Die Adapter
 * erwarten nur die Tabellen-Delegates, die sie tatsächlich benutzen — kein
 * harter Import auf `@prisma/client`, damit das Paket ohne Prisma-Generate
 * baut und in Tests gemockt werden kann.
 *
 * Ein Konsumenten-`PrismaService extends PrismaClient` erfüllt das Interface
 * automatisch.
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
