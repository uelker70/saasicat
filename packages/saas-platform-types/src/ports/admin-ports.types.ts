import type { AdminManifest } from '../admin-manifest.types.js';
import type { AuditEntry, AuditQuery } from '../audit-event.types.js';

// -----------------------------------------------------------------------------
// Admin stats and platform operation ports
// -----------------------------------------------------------------------------

/** Aggregate snapshot of subscriptions, orchestrated by `AdminStatsService`. */
export interface SubscriptionStatsSnapshot {
    /** Sum of all non-soft-deleted subscriptions. */
    total: number;
    /** Sum of subscriptions with `isPilot: true`. */
    pilots: number;
    /** Sum of subscriptions with `status: 'TRIAL'`. */
    trialing: number;
    /** Map planId → count. */
    byPlan: Record<string, number>;
    /** Map status → count (ACTIVE / TRIAL / PAST_DUE / CANCELED / PENDING_SALES). */
    byStatus: Record<string, number>;
}

/**
 * Stats adapter for subscriptions. Consumers implement this based on their
 * Prisma `subscription.groupBy(...)` / `count(...)` calls.
 */
export interface SubscriptionStatsPort {
    getStats(): Promise<SubscriptionStatsSnapshot>;
}

/** Top promo-code entry (highest redemption count). */
export interface TopPromoCode {
    code: string;
    redemptionsCount: number;
    status: string;
}

/** Aggregate snapshot of promo codes. */
export interface PromoCodeStatsSnapshot {
    /** Sum of all non-soft-deleted promo codes. */
    total: number;
    /** Map status → count (ACTIVE / PAUSED / EXPIRED / EXHAUSTED). */
    byStatus: Record<string, number>;
    /** Highest-redemption code; null when no codes exist. */
    top: TopPromoCode | null;
}

/** Stats adapter for promo codes. */
export interface PromoCodeStatsPort {
    getStats(): Promise<PromoCodeStatsSnapshot>;
}

/** Aggregate snapshot of the audit log. */
export interface AuditStatsSnapshot {
    /** Number of entries in the last N days. */
    countLastNDays: number;
    /** Default 7. Configurable via `forRoot.auditWindowDays`. */
    nDays: number;
}

/** Stats adapter for the audit log. */
export interface AuditStatsPort {
    /** Number of audit events since `since`. */
    countSince(since: Date): Promise<number>;
}

/**
 * Identifier of an admin actor for the audit log. `source` distinguishes
 * web UI (`'web'`) and CLI (`'cli'`); `context` is the session ID (web)
 * or the hostname (CLI).
 */
export interface AdminActor {
    userId: string;
    email: string;
    source: 'web' | 'cli';
    context: string;
}

/**
 * Audit adapter: platform services write to the audit log through this
 * interface. The consumer implementation persists the records (e.g.
 * Prisma `auditLog.create`, Django `AuditLog.objects.create`).
 *
 * `action` is SCREAMING_SNAKE_CASE (see `audit-event.schema.json`).
 * `changes` is a free-form object; platform services attach the `actor` tag
 * automatically.
 */
export interface AuditPort {
    write(input: {
        actor: AdminActor;
        entity: string;
        entityId: string;
        action: string;
        changes?: Record<string, unknown>;
    }): Promise<void>;
}

/**
 * Read/query adapter for audit logs. Used by the CLI `<app> audit tail` and
 * UI audit pages. The consumer implementation translates the filter object
 * (see `audit-event.types.ts.AuditQuery`) into the respective DB query. The
 * returned records follow `AuditEntry` from the same file.
 */
export interface AuditQueryPort {
    list(filter: AuditQuery): Promise<AuditEntry[]>;
}

/**
 * Read adapter for the current AdminManifest. The consumer implementation
 * delegates to its `AdminManifestService.getManifest()`. The platform CLI
 * uses this for `<app> manifest dump|hash|check` etc.
 */
export interface ManifestAccessPort {
    getManifest(): AdminManifest;
    /** Optional: forces a rebuild from the contributions (e.g. after code reload). */
    rebuild?(): AdminManifest;
}

/**
 * Adapter for the RLS bypass context. Platform code calls `runWithBypass`,
 * the consumer implementation triggers the Postgres session variable
 * (`set_config('app.bypass_rls', 'true', true)`) or the equivalent in
 * Django/other stacks. The execution context lives for exactly one
 * request pipeline (AsyncLocalStorage / `contextvars` etc.).
 *
 * SuperAdmin operations are platform-wide without tenant scope — without
 * bypass, all RLS-protected reads would come back empty.
 */
export interface RlsBypassPort {
    runWithBypass<T>(fn: () => Promise<T>): Promise<T>;
}
