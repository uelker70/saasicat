// WebAuditLogger — geteilter Web-Request → Audit-Log-Helfer für SuperAdmin-
// Controller (#13).
//
// Baut einen AdminActor aus dem Request (User-ID/Email/Kontext via optionale
// Resolver mit sinnvollen Defaults) und loggt best-effort über den
// AdminAuditService, ohne den Write-Pfad zu brechen. Alle Abhängigkeiten sind
// @Optional: fehlt der AdminAuditService (minimaler Deploy ohne Admin-Modul im
// Scope), ist `logFromRequest` ein stiller No-op.
//
// SSOT für das Actor-/Audit-Muster (zuvor controller-privat in
// tenant-billing.controller.ts; dieser kann später hierauf migrieren).

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
     * Löst die User-ID aus dem Request auf (Resolver-Token oder JWT-Default) —
     * auch für fachliche Felder nutzbar (z. B. `approvedBy`, #20), nicht nur
     * fürs Audit-Log.
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
     * Best-effort Audit-Log aus einem Web-Request. Schreibt nichts und wirft
     * nie, wenn kein AdminAuditService injiziert ist; Schreibfehler werden
     * verschluckt (eine Beobachtungslücke ist besser als ein Outage).
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
            // Audit-Failures dürfen den SuperAdmin-Write-Pfad nicht brechen.
        }
    }
}
