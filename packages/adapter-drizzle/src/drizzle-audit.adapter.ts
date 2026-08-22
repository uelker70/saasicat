import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AdminActor, AuditPort } from '@saasicat/types';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { auditLogs } from './schema.js';

/** `'web:<email>:<sessionId>'` / `'cli:<email>:<host>'` — audit-event.schema.json ActorTagPattern. */
export function buildActorTag(actor: AdminActor): string {
    return `${actor.source}:${actor.email}:${actor.context}`;
}

/**
 * Default implementation of `AuditPort` against the canonical `audit_logs`
 * table. SuperAdmin actions are platform-global, so `tenantId` stays null;
 * the actor lands as `userId` + `actorTag`.
 */
@Injectable()
export class DrizzleAuditAdapter implements AuditPort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async write(input: {
        actor: AdminActor;
        entity: string;
        entityId: string;
        action: string;
        changes?: Record<string, unknown>;
    }): Promise<void> {
        await this.db.insert(auditLogs).values({
            id: randomUUID(),
            tenantId: null,
            userId: input.actor.userId,
            entity: input.entity,
            entityId: input.entityId,
            action: input.action,
            changes: input.changes ?? {},
            actorTag: buildActorTag(input.actor),
        });
    }
}
