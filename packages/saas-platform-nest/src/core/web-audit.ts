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
import type { AdminActor } from '@saasicat/types';

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
            (this.userIdResolver ??
                ((r: unknown) =>
                    (r as RequestLike).user?.sub ?? (r as RequestLike).user?.id ?? null))(req) ??
            null
        );
    }

    private buildActor(req: unknown): AdminActor {
        const userId = this.resolveUserId(req) ?? 'unknown';
        const email =
            (this.userEmailResolver ?? ((r: unknown) => (r as RequestLike).user?.email ?? null))(
                req,
            ) ?? 'unknown';
        const context =
            (this.auditContextResolver ??
                ((r: unknown) => {
                    const sid = (r as RequestLike).headers?.['x-session-id'];
                    return Array.isArray(sid) ? (sid[0] ?? null) : (sid ?? null);
                }))(req) ?? DEFAULT_CONTEXT;
        return { userId, email, source: 'web', context };
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
