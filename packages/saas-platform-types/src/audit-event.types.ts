// AuditEvent — Format eines AuditLog-Eintrags.
// Schema-Quelle: @saasicat/spec/schemas/audit-event.schema.json

/** Format: 'web:<email>:<sessionId>' oder 'cli:<email>:<host>'. */
export type ActorTag = string;

export interface AuditEntry {
    id: string;
    /** null = Plattform-Aktion ohne Mandantenkontext (SUPER_ADMIN). */
    tenantId: string | null;
    /** null = System / Cron-getriggert. */
    userId: string | null;
    /** Convenience-Feld; Backend resolvet aus userId. */
    userEmail: string | null;
    /** z. B. 'Tenant', 'PromoCode', 'Subscription', 'PlanVersion', 'User'. */
    entity: string;
    entityId: string;
    /** SCREAMING_SNAKE_CASE; vergangenheitsform-orientiert. */
    action: string;
    /** Frei strukturiert. Konvention: { field: { old, new } } oder { reason, ... }. */
    changes: Record<string, unknown> | null;
    actorTag: ActorTag | null;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
}

export interface AuditQuery {
    tenantId?: string;
    userId?: string;
    entity?: string;
    entityId?: string;
    action?: string;
    /** Wildcard-fähig, z. B. 'cli:*'. */
    actorTag?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
}
