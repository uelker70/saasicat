// WebAuditLogger — shared web-request → audit-log helper for SuperAdmin
// controllers.
//
// Builds an AdminActor from the request through the resolvers the application
// bound at the root of `SaaSiCatModule` (`request-user.ts` reads them) and logs
// best-effort via the AdminAuditService, without breaking the write path. All
// dependencies are @Optional: if the AdminAuditService is missing (minimal
// deploy without the admin module in scope), `logFromRequest` is a silent
// no-op.

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { AdminActor, AuditActor } from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { actorFromRequest, requestUserIdOf } from './request-user.js';
import {
    AUDIT_CONTEXT_RESOLVER_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    USER_ID_RESOLVER_TOKEN,
    type AuditContextResolver,
    type UserEmailResolver,
    type UserIdResolver,
} from '../billing/tenant-billing.tokens.js';

const DEFAULT_CONTEXT = 'admin';

/**
 * The actor a request describes when no resolver is bound: the JWT's subject
 * or id, its email, the session header. What `WebAuditLogger` falls back to
 * per field, exported so a controller without the logger derives the same tag
 * (`request-user.ts`).
 */
export function defaultActorFromRequest(req: unknown): AdminActor {
    return actorFromRequest(req, {}, DEFAULT_CONTEXT);
}

/** `web:<email>:<context>` — the origin marker as the audit log writes it. */
export function actorTagOf(actor: AuditActor): string {
    return `${actor.source}:${actor.email}:${actor.context}`;
}

@Injectable()
export class WebAuditLogger {
    constructor(
        @Optional()
        @Inject(AdminAuditService)
        private readonly auditService: AdminAuditService | null = null,
        @Optional()
        @Inject(USER_ID_RESOLVER_TOKEN)
        private readonly userIdResolver: UserIdResolver | null = null,
        @Optional()
        @Inject(USER_EMAIL_RESOLVER_TOKEN)
        private readonly userEmailResolver: UserEmailResolver | null = null,
        @Optional()
        @Inject(AUDIT_CONTEXT_RESOLVER_TOKEN)
        private readonly auditContextResolver: AuditContextResolver | null = null,
    ) {}

    /**
     * Resolves the user ID from the request (resolver token or JWT default) —
     * also usable for domain fields (e.g. `approvedBy`, #20), not just
     * for the audit log.
     */
    resolveUserId(req: unknown): string | null {
        return requestUserIdOf(req, this.userIdResolver);
    }

    /**
     * The actor behind a request, for a service that records the action
     * itself: the same derivation the log line and the tag use.
     */
    actorFromRequest(req: unknown): AdminActor {
        return this.buildActor(req);
    }

    private buildActor(req: unknown): AdminActor {
        return actorFromRequest(
            req,
            {
                userId: this.userIdResolver,
                email: this.userEmailResolver,
                context: this.auditContextResolver,
            },
            DEFAULT_CONTEXT,
        );
    }

    /**
     * The actor behind a request as the audit log writes it —
     * `web:<email>:<context>` — for a column that records who did something.
     * The same derivation as the log line, so the two never disagree about who
     * it was.
     */
    actorTagFromRequest(req: unknown): string {
        return actorTagOf(this.buildActor(req));
    }

    /**
     * Best-effort audit log from a web request. Writes nothing and never
     * throws when no AdminAuditService is injected; write errors are
     * swallowed (an observability gap is better than an outage).
     */
    async logFromRequest(
        req: unknown,
        entity: string,
        entityId: string,
        action: string,
        changes?: Record<string, unknown>,
    ): Promise<void> {
        if (!this.auditService) return;
        try {
            await this.auditService.log({
                actor: this.buildActor(req),
                entity,
                entityId,
                action,
                changes,
            });
        } catch {
            // Audit failures must not break the SuperAdmin write path.
        }
    }
}
