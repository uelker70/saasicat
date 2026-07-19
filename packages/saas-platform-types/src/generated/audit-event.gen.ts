// AUTO-GENERATED — nicht manuell editieren.
//
// Quelle: @saasicat/spec/schemas/audit-event.schema.json
// Regenerieren: `pnpm --filter @saasicat/types gen:types`
// Drift-Gate: tests/codegen-drift.test.js bricht den PR, wenn Schema und
// generierter Output auseinanderlaufen.

/**
 * Sprach-neutrales Format eines AuditLog-Eintrags. Pro Konsument-App eigene AuditLog-Tabelle, gleiche Struktur.
 */
export interface AuditEvent {
    id: string;
    /**
     * null = Plattform-Aktion (z. B. SUPER_ADMIN ohne Mandantenkontext).
     */
    tenantId?: string | null;
    /**
     * null = System / Cron-getriggert.
     */
    userId?: string | null;
    /**
     * Convenience-Lookup für die Anzeige; Backend resolvet aus userId.
     */
    userEmail?: string | null;
    /**
     * z. B. 'Tenant', 'PromoCode', 'Subscription', 'PlanVersion', 'User'.
     */
    entity: string;
    entityId: string;
    /**
     * SCREAMING_SNAKE_CASE, vergangenheitsform-orientiert. Beispiele: TENANT_SUSPEND, PILOT_GRANT, PROMO_CODE_CREATE, PLAN_VERSION_PUBLISH.
     */
    action: string;
    /**
     * Frei strukturiertes JSON. Konvention für Feld-Diffs: { field: { old, new } }. Für Workflow-Aktionen: { reason, actor_tag, ... }.
     */
    changes?: {
        [k: string]: unknown;
    } | null;
    /**
     * Herkunfts-Marker. Format: 'web:<email>:<sessionId>' oder 'cli:<email>:<host>'.
     */
    actorTag?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    createdAt: string;
}

/**
 * Verbindliches Format für actorTag.
 */
export type ActorTagPattern = string;

/**
 * Query-Parameter für GET /api/v1/admin/audit. Vorlage admin-api.openapi.yaml.
 */
export interface AuditQuery {
    tenantId?: string;
    userId?: string;
    entity?: string;
    entityId?: string;
    action?: string;
    /**
     * Wildcard-fähig, z. B. 'cli:*'.
     */
    actorTag?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
}
