import { Inject, Injectable } from '@nestjs/common';
import type { AdminActor, AuditPort } from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaLike } from './prisma-client-token.js';

/**
 * Default implementation of `AuditPort` against the `AuditEntry` table
 * from the platform Prisma fragment.
 *
 * Schema assumption:
 *
 * ```prisma
 * model AuditEntry {
 *     id         String   @id @default(cuid())
 *     actorEmail String
 *     actorRole  String
 *     entity     String
 *     entityId   String
 *     action     String
 *     changes    Json     @default("{}")
 *     createdAt  DateTime @default(now())
 *     @@index([entity, entityId])
 *     @@index([createdAt])
 * }
 * ```
 */
@Injectable()
export class PrismaAuditAdapter implements AuditPort {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async write(input: {
        actor: AdminActor;
        entity: string;
        entityId: string;
        action: string;
        changes?: Record<string, unknown>;
    }): Promise<void> {
        await this.prisma.auditEntry.create({
            data: {
                actorEmail: input.actor.email,
                actorRole: input.actor.source === 'cli' ? 'CLI' : 'SUPER_ADMIN',
                entity: input.entity,
                entityId: input.entityId,
                action: input.action,
                changes: input.changes ?? {},
            },
        });
    }
}
