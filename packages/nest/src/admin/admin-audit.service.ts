// AdminAuditService — generic audit-log wrapper over the AuditPort.
//
// Platform services call `log({actor, entity, entityId, action, changes,
// tenantId})`; the consumer implementation (PrismaAuditAdapter /
// DjangoAuditAdapter) persists the records. Which entries name a tenant is
// `AuditPort.write`'s to say.

import * as os from 'node:os';
import { Inject, Injectable } from '@nestjs/common';
import type { AdminActor, AuditActor, AuditPort, PlatformJobActor } from '@saasicat/core';
import { AUDIT_PORT_TOKEN } from './admin.tokens.js';

/** What an entry is written with: the port's, so the two never disagree. */
type AuditEntryInput = Parameters<AuditPort['write']>[0];

@Injectable()
export class AdminAuditService {
    constructor(@Inject(AUDIT_PORT_TOKEN) private readonly audit: AuditPort) {}

    async log(input: AuditEntryInput): Promise<void> {
        await this.audit.write({
            actor: input.actor,
            entity: input.entity,
            entityId: input.entityId,
            action: input.action,
            changes: { ...input.changes, actor: this.actorTag(input.actor) },
            tenantId: input.tenantId,
        });
    }

    /**
     * Standardized actor tag for the `changes.actor` column:
     * `<source>:<email>:<context>`.
     */
    actorTag(actor: AuditActor): string {
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

/** The actor a platform job writes its audit entries as: `job:platform:<job>`. */
export function platformJobActor(job: string): PlatformJobActor {
    return { userId: null, email: 'platform', source: 'job', context: job };
}
