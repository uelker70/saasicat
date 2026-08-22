// AUTO-GENERATED — do not edit manually.
//
// Source: @saasicat/spec/schemas/audit-event.schema.json
// Regenerate: `pnpm --filter @saasicat/types gen:types`
// Drift gate: tests/codegen-drift.test.js fails the PR when the schema and
// the generated output diverge.

/**
 * Language-neutral format of an AuditLog entry. Each consumer app has its own AuditLog table, same structure.
 */
export interface AuditEvent {
    id: string;
    /**
     * null = platform action (e.g. SUPER_ADMIN without tenant context).
     */
    tenantId?: string | null;
    /**
     * null = system / cron-triggered.
     */
    userId?: string | null;
    /**
     * Convenience lookup for display; backend resolves from userId.
     */
    userEmail?: string | null;
    /**
     * e.g. 'Tenant', 'PromoCode', 'Subscription', 'PlanVersion', 'User'.
     */
    entity: string;
    entityId: string;
    /**
     * SCREAMING_SNAKE_CASE, past-tense oriented. Examples: TENANT_SUSPEND, PILOT_GRANT, PROMO_CODE_CREATE, PLAN_VERSION_PUBLISH.
     */
    action: string;
    /**
     * Freely structured JSON. Convention for field diffs: { field: { old, new } }. For workflow actions: { reason, actor_tag, ... }.
     */
    changes?: {
        [k: string]: unknown;
    } | null;
    /**
     * Origin marker. Format: 'web:<email>:<sessionId>' or 'cli:<email>:<host>'.
     */
    actorTag?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    createdAt: string;
}

/**
 * Mandatory format for actorTag.
 */
export type ActorTagPattern = string;

/**
 * Query parameters for GET /api/v1/admin/audit. Template admin-api.openapi.yaml.
 */
export interface AuditQuery {
    tenantId?: string;
    userId?: string;
    entity?: string;
    entityId?: string;
    action?: string;
    /**
     * Wildcard-capable, e.g. 'cli:*'.
     */
    actorTag?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
}
