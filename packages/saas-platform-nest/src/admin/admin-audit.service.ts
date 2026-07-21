// AdminAuditService — generic audit-log wrapper over the AuditPort.
//
// Platform services call `log({actor, entity, entityId, action, changes})`;
// the consumer implementation (PrismaAuditAdapter / DjangoAuditAdapter)
// persists the records.

import * as os from 'node:os';
import { Inject, Injectable } from '@nestjs/common';
import type { AdminActor, AuditPort } from '@saasicat/types';
import { AUDIT_PORT_TOKEN } from './tokens.js';

@Injectable()
export class AdminAuditService {
    constructor(@Inject(AUDIT_PORT_TOKEN) private readonly audit: AuditPort) {}

    async log(input: {
        actor: AdminActor;
        entity: string;
        entityId: string;
        action: string;
        changes?: Record<string, unknown>;
    }): Promise<void> {
        await this.audit.write({
            actor: input.actor,
            entity: input.entity,
            entityId: input.entityId,
            action: input.action,
            changes: { ...(input.changes ?? {}), actor: this.actorTag(input.actor) },
        });
    }

    /**
     * Standardized actor tag for the `changes.actor` column:
     * `<source>:<email>:<context>`.
     */
    actorTag(actor: AdminActor): string {
        return `${actor.source}:${actor.email}:${actor.context}`;
    }

    /** Helper: build an AdminActor from an authenticated web request. */
    fromWebRequest(user: { id: string; email: string }, sessionId?: string | null): AdminActor {
        return {
            userId: user.id,
            email: user.email,
            source: 'web',
            context: sessionId ?? 'unknown',
        };
    }

    /** Helper: build an AdminActor from a CLI identity (hostname as context). */
    fromCli(user: { id: string; email: string }): AdminActor {
        return {
            userId: user.id,
            email: user.email,
            source: 'cli',
            context: os.hostname(),
        };
    }
}
