// WebAuditLogger — shared web-request → audit-log helper for SuperAdmin
// controllers (#13).
//
// Builds an AdminActor from the request (user ID/email/context via optional
// resolvers with sensible defaults) and logs best-effort via the
// AdminAuditService, without breaking the write path. All dependencies are
// @Optional: if the AdminAuditService is missing (minimal deploy without the admin
// module in scope), `logFromRequest` is a silent no-op.
//
// SSOT for the actor/audit pattern (previously controller-private in
// tenant-billing.controller.ts; that one can migrate here later).

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { AdminActor, AuditActor } from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import {
    AUDIT_CONTEXT_RESOLVER_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    USER_ID_RESOLVER_TOKEN,
    type AuditContextResolver,
    type UserEmailResolver,
    type UserIdResolver,
} from '../billing/tenant-billing.tokens.js';

interface RequestLike {
    user?: { sub?: string; id?: string; email?: string };
    headers?: Record<string, string | string[] | undefined>;
}

const DEFAULT_CONTEXT = 'admin';

/** The resolvers an application may bind to name the user behind a request. */
export interface RequestActorResolvers {
    userId?: UserIdResolver | null;
    email?: UserEmailResolver | null;
    context?: AuditContextResolver | null;
}

/**
 * The actor behind a request: per field the resolver the application bound,
 * otherwise the JWT's subject or id, its email and the session header — and
 * `fallbackContext` where nothing names a context. One derivation for every
 * place that records who did something, so two records never disagree about
 * who it was.
 */
export function actorFromRequest(
    req: unknown,
    resolvers: RequestActorResolvers,
    fallbackContext: string,
): AdminActor {
    const request = req as RequestLike;
    const userId = (resolvers.userId ?? (() => request.user?.sub ?? request.user?.id ?? null))(req);
    const email = (resolvers.email ?? (() => request.user?.email ?? null))(req);
    const context = (
        resolvers.context ??
        (() => {
            const sid = request.headers?.['x-session-id'];
            return Array.isArray(sid) ? (sid[0] ?? null) : (sid ?? null);
        })
    )(req);
    return {
        userId: userId ?? 'unknown',
        email: email ?? 'unknown',
        source: 'web',
        context: context ?? fallbackContext,
    };
}

/**
 * The actor a request describes when no resolver is bound: the JWT's subject
 * or id, its email, the session header. What `WebAuditLogger` falls back to
 * per field, exported so a controller without the logger derives the same tag.
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
        return (
            (
                this.userIdResolver ??
                ((r: unknown) =>
                    (r as RequestLike).user?.sub ?? (r as RequestLike).user?.id ?? null)
            )(req) ?? null
        );
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
