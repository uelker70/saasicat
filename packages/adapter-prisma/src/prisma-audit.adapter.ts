import { Inject, Injectable } from '@nestjs/common';
import type { AuditActor, AuditPort } from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type JsonInputLike, type PrismaLike } from './prisma-client-token.js';

/** `'web:<email>:<sessionId>'` / `'cli:<email>:<host>'` — audit-event.schema.json ActorTagPattern. */
export function buildActorTag(actor: AuditActor): string {
    return `${actor.source}:${actor.email}:${actor.context}`;
}

/**
 * Default implementation of `AuditPort` against the canonical `audit_logs`
 * table (`@saasicat/spec` prisma-fragments/04-audit-log.prisma).
 *
 * `tenantId` is the tenant the entry concerns, as `AuditPort.write` was
 * handed it, and null where it was handed none; the actor lands as `userId` +
 * `actorTag`.
 */
@Injectable()
export class PrismaAuditAdapter implements AuditPort {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: Pick<PrismaLike, 'auditLog'>,
    ) {}

    async write(input: Parameters<AuditPort['write']>[0]): Promise<void> {
        await this.prisma.auditLog.create({
            data: {
                tenantId: input.tenantId ?? null,
                userId: input.actor.userId,
                entity: input.entity,
                entityId: input.entityId,
                action: input.action,
                // SAFETY: the port hands `changes` over as plain data, and Prisma
                // writes a `Json` column as `JSON.stringify` renders it; the
                // assertion names that for a generated client, which
                // `Record<string, unknown>` cannot prove to it.
                changes: (input.changes ?? {}) as JsonInputLike,
                actorTag: buildActorTag(input.actor),
            },
        });
    }
}
