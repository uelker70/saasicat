// AdminAuditService — generischer Audit-Log-Wrapper über den AuditPort.
//
// Plattform-Services rufen `log({actor, entity, entityId, action, changes})`;
// Konsument-Implementation (PrismaAuditAdapter / DjangoAuditAdapter)
// persistiert die Records.
//
// Spec: yada-services/handoff/superadmin/UMSETZUNGSPLAN.md §3.3 (2.4).

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
     * Standardisierter Actor-Tag für die `changes.actor`-Spalte:
     * `<source>:<email>:<context>`.
     */
    actorTag(actor: AdminActor): string {
        return `${actor.source}:${actor.email}:${actor.context}`;
    }

    /** Helper: AdminActor aus authentifiziertem Web-Request bauen. */
    fromWebRequest(user: { id: string; email: string }, sessionId?: string | null): AdminActor {
        return {
            userId: user.id,
            email: user.email,
            source: 'web',
            context: sessionId ?? 'unknown',
        };
    }

    /** Helper: AdminActor aus CLI-Identity bauen (Hostname als Kontext). */
    fromCli(user: { id: string; email: string }): AdminActor {
        return {
            userId: user.id,
            email: user.email,
            source: 'cli',
            context: os.hostname(),
        };
    }
}
