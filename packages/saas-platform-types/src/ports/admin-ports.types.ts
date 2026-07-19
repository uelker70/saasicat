import type { AdminManifest } from '../admin-manifest.types.js';
import type { AuditEntry, AuditQuery } from '../audit-event.types.js';

// -----------------------------------------------------------------------------
// Admin stats and platform operation ports
// -----------------------------------------------------------------------------

/** Aggregat-Snapshot der Subscriptions, von `AdminStatsService` orchestriert. */
export interface SubscriptionStatsSnapshot {
    /** Summe aller nicht-soft-gelöschten Subscriptions. */
    total: number;
    /** Summe der Subscriptions mit `isPilot: true`. */
    pilots: number;
    /** Summe der Subscriptions mit `status: 'TRIAL'`. */
    trialing: number;
    /** Map planId → Count. */
    byPlan: Record<string, number>;
    /** Map status → Count (ACTIVE / TRIAL / PAST_DUE / CANCELED / PENDING_SALES). */
    byStatus: Record<string, number>;
}

/**
 * Stats-Adapter für Subscriptions. Konsumenten implementieren das anhand ihrer
 * Prisma-`subscription.groupBy(...)` / `count(...)`-Calls.
 */
export interface SubscriptionStatsPort {
    getStats(): Promise<SubscriptionStatsSnapshot>;
}

/** Top-Promo-Code-Eintrag (höchste Redemption-Zahl). */
export interface TopPromoCode {
    code: string;
    redemptionsCount: number;
    status: string;
}

/** Aggregat-Snapshot der Promo-Codes. */
export interface PromoCodeStatsSnapshot {
    /** Summe aller nicht-soft-gelöschten Promo-Codes. */
    total: number;
    /** Map status → Count (ACTIVE / PAUSED / EXPIRED / EXHAUSTED). */
    byStatus: Record<string, number>;
    /** Höchste-Redemption-Code; null wenn keine Codes existieren. */
    top: TopPromoCode | null;
}

/** Stats-Adapter für PromoCodes. */
export interface PromoCodeStatsPort {
    getStats(): Promise<PromoCodeStatsSnapshot>;
}

/** Aggregat-Snapshot des Audit-Logs. */
export interface AuditStatsSnapshot {
    /** Anzahl Einträge in den letzten N Tagen. */
    countLastNDays: number;
    /** Default 7. Konfigurierbar via `forRoot.auditWindowDays`. */
    nDays: number;
}

/** Stats-Adapter für AuditLog. */
export interface AuditStatsPort {
    /** Anzahl Audit-Events seit `since`. */
    countSince(since: Date): Promise<number>;
}

/**
 * Identifier eines Admin-Akteurs für den Audit-Log. `source` unterscheidet
 * Web-UI (`'web'`) und CLI (`'cli'`); `context` ist die Session-ID (Web)
 * oder der Hostname (CLI).
 */
export interface AdminActor {
    userId: string;
    email: string;
    source: 'web' | 'cli';
    context: string;
}

/**
 * Audit-Adapter: Plattform-Services schreiben über diese Schnittstelle in
 * den Audit-Log. Konsument-Implementation persistiert die Records (z. B.
 * Prisma `auditLog.create`, Django `AuditLog.objects.create`).
 *
 * `action` ist SCREAMING_SNAKE_CASE (siehe `audit-event.schema.json`).
 * `changes` ist ein freies Objekt; Plattform-Services hängen `actor`-Tag
 * automatisch an.
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
 * Lese-/Query-Adapter für Audit-Logs. Wird vom CLI `<app> audit tail` und
 * UI-Audit-Pages benutzt. Konsumenten-Implementation übersetzt das Filter-
 * Objekt (siehe `audit-event.types.ts.AuditQuery`) in die jeweilige
 * DB-Abfrage. Die zurückgelieferten Records folgen `AuditEntry` aus dem
 * gleichen File.
 */
export interface AuditQueryPort {
    list(filter: AuditQuery): Promise<AuditEntry[]>;
}

/**
 * Lese-Adapter für das aktuelle AdminManifest. Konsument-Implementation
 * delegiert an seinen `AdminManifestService.getManifest()`. Plattform-CLI
 * nutzt das für `<app> manifest dump|hash|check` etc.
 */
export interface ManifestAccessPort {
    getManifest(): AdminManifest;
    /** Optional: erzwingt Re-Build aus den Contributions (z. B. nach Code-Reload). */
    rebuild?(): AdminManifest;
}

/**
 * Adapter für RLS-Bypass-Kontext. Plattform-Code ruft `runWithBypass`,
 * Konsument-Implementation triggert die Postgres-Session-Variable
 * (`set_config('app.bypass_rls', 'true', true)`) bzw. das Pendant in
 * Django/anderen Stacks. Der Ausführungskontext lebt für genau eine
 * Request-Pipeline (AsyncLocalStorage / `contextvars` etc.).
 *
 * SuperAdmin-Operationen sind plattform-weit ohne Tenant-Scope — ohne
 * Bypass würden alle RLS-geschützten Reads leer zurückkommen.
 */
export interface RlsBypassPort {
    runWithBypass<T>(fn: () => Promise<T>): Promise<T>;
}
