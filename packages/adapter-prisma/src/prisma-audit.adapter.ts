import { Inject, Injectable } from '@nestjs/common';
import type { AdminActor, AuditPort } from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaLike } from './prisma-client-token.js';

/** `'web:<email>:<sessionId>'` / `'cli:<email>:<host>'` — audit-event.schema.json ActorTagPattern. */
export function buildActorTag(actor: AdminActor): string {
    return `${actor.source}:${actor.email}:${actor.context}`;
}

/**
 * Default implementation of `AuditPort` against the canonical `audit_logs`
 * table (`@saasicat/spec` prisma-fragments/04-audit-log.prisma).
 *
 * SuperAdmin actions are platform-global, so `tenantId` stays null; the
 * actor lands as `userId` + `actorTag`.
 */
@Injectable()
export class PrismaAuditAdapter implements AuditPort {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: Pick<PrismaLike, 'auditLog'>,
    ) {}

    async write(input: {
        actor: AdminActor;
        entity: string;
        entityId: string;
        action: string;
        changes?: Record<string, unknown>;
    }): Promise<void> {
        await this.prisma.auditLog.create({
            data: {
                tenantId: null,
                userId: input.actor.userId,
                entity: input.entity,
                entityId: input.entityId,
                action: input.action,
                changes: input.changes ?? {},
                actorTag: buildActorTag(input.actor),
            },
        });
    }
}
