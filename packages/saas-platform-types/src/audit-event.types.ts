// AuditEvent — format of an AuditLog entry.
// Schema source: @saasicat/spec/schemas/audit-event.schema.json

/** Format: 'web:<email>:<sessionId>' or 'cli:<email>:<host>'. */
export type ActorTag = string;

export interface AuditEntry {
    id: string;
    /** null = platform action without tenant context (SUPER_ADMIN). */
    tenantId: string | null;
    /** null = system / cron-triggered. */
    userId: string | null;
    /** Convenience field; backend resolves it from userId. */
    userEmail: string | null;
    /** e.g. 'Tenant', 'PromoCode', 'Subscription', 'PlanVersion', 'User'. */
    entity: string;
    entityId: string;
    /** SCREAMING_SNAKE_CASE; past-tense oriented. */
    action: string;
    /** Freely structured. Convention: { field: { old, new } } or { reason, ... }. */
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
    /** Wildcard-capable, e.g. 'cli:*'. */
    actorTag?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
}
