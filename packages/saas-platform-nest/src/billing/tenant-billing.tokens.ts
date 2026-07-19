// DI-Tokens für das TenantBillingModule.
//
// Konsumenten registrieren ihre App-spezifischen Implementierungen
// (Auth-Guards, Tenant-/User-Resolver, Adapter-Ports) per `forRoot()` —
// Plattform-Code referenziert nur die Tokens.

import type { CanActivate } from '@nestjs/common';

/**
 * Liste aller Auth-Guards, die der Plattform-Controller in der Reihenfolge
 * iterieren soll (analog `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)`).
 * Wird per `forRoot.authGuards` zur Verfügung gestellt — kann ein Array
 * vorhandener Instanzen oder ein Factory-Provider sein.
 */
export const TENANT_AUTH_GUARDS_TOKEN = Symbol.for('saas-platform/TenantAuthGuards');

/**
 * Resolver-Funktion `(req) => string`, die die `tenantId` aus dem Request
 * zieht. Default: `req.user.tenantId`.
 */
export const TENANT_ID_RESOLVER_TOKEN = Symbol.for('saas-platform/TenantIdResolver');

/**
 * Resolver-Funktion `(req) => string`, die die `userId` aus dem Request
 * zieht. Default: `req.user.sub ?? req.user.id`.
 */
export const USER_ID_RESOLVER_TOKEN = Symbol.for('saas-platform/UserIdResolver');

/**
 * Resolver-Funktion `(req) => string`, die die User-Email aus dem Request
 * zieht. Optional — wird vom Audit-Log-Pfad genutzt, um den AdminActor zu
 * bauen (`{userId, email, source: 'web', context}`). Default: `req.user.email`.
 * Wenn der Konsumenten-JWT keine Email mitliefert, kann der Resolver `null`
 * zurückgeben — der Audit-Log-Pfad fällt dann auf `'unknown'` zurück.
 */
export const USER_EMAIL_RESOLVER_TOKEN = Symbol.for('saas-platform/UserEmailResolver');

/**
 * Resolver-Funktion `(req) => string`, die einen Audit-Kontext aus dem
 * Request zieht (z. B. Session-ID, Trace-ID). Default: `req.headers['x-session-id']`
 * oder `'tenant-self-service'`.
 */
export const AUDIT_CONTEXT_RESOLVER_TOKEN = Symbol.for('saas-platform/AuditContextResolver');

/** Adapter-Token: `SubscriptionUsagePort`-Implementation des Konsumenten. */
export const SUBSCRIPTION_USAGE_PORT_TOKEN = Symbol.for('saas-platform/SubscriptionUsagePort');

/** Adapter-Token: `UsageSnapshotPort`-Implementation des Konsumenten. */
export const USAGE_SNAPSHOT_PORT_TOKEN = Symbol.for('saas-platform/UsageSnapshotPort');

/** Adapter-Token: `TenantSubscriptionWritePort`-Implementation des Konsumenten. */
export const SUBSCRIPTION_WRITE_PORT_TOKEN = Symbol.for(
    'saas-platform/TenantSubscriptionWritePort',
);

export type TenantIdResolver = (req: unknown) => string | null | undefined;
export type UserIdResolver = (req: unknown) => string | null | undefined;
export type UserEmailResolver = (req: unknown) => string | null | undefined;
export type AuditContextResolver = (req: unknown) => string | null | undefined;
export type AuthGuardList = ReadonlyArray<CanActivate>;

/**
 * Optionaler Adapter-Token: projiziert das neue Trial-Ende eines Wechsels
 * (App-spezifische Trial-Logik, z. B. Carry-over der Restzeit). Ohne Port
 * bleibt `PlanChangePreviewDto.projectedTrialEndsAt` `null` und der Wizard
 * fällt auf das aktuelle Trial-Ende zurück.
 */
export const TRIAL_PROJECTION_PORT_TOKEN = Symbol.for('saas-platform/TrialProjectionPort');

export interface TrialProjectionInput {
    /** Aktueller Plan-Key der Subscription. */
    currentPlan: string;
    /** Ziel-Plan-Key des Wechsels. */
    targetPlan: string;
    /** Aktuelles Trial-Ende (null = kein Trial). */
    currentTrialEndsAt: Date | null;
    /** Subscription-Status (z. B. 'TRIAL'/'ACTIVE'). */
    status: string;
    now: Date;
}

export interface TrialProjectionPort {
    /**
     * Projiziertes neues Trial-Ende nach dem Wechsel. `null`, wenn sich nichts
     * ändert oder das Ziel-Paket keinen Trial unterstützt.
     */
    projectTrialEndsAt(input: TrialProjectionInput): Promise<Date | null>;
}

/**
 * Optionaler Adapter-Token: liefert fällige geplante Plan-Wechsel für die
 * `PendingPlanMaterializationService`. Ohne Port wird der Service nicht
 * registriert (Materialisierung ist Opt-in).
 */
export const PENDING_PLAN_QUERY_PORT_TOKEN = Symbol.for('saas-platform/PendingPlanQueryPort');

/** Ein fälliger geplanter Plan-Wechsel — minimal für die Materialisierung. */
export interface DuePendingPlanChange {
    tenantId: string;
    /** Ziel-Plan-Key des geplanten Wechsels (`pendingPlan`). */
    pendingPlan: string;
    /** Ziel-Cycle (`pendingBillingCycle`); `null` → Default MONTHLY. */
    pendingBillingCycle: string | null;
}

export interface PendingPlanQueryPort {
    /**
     * Liefert alle Subscriptions mit fälligem geplanten Plan-Wechsel:
     * `pendingPlan != null AND pendingEffectiveAt <= now AND status != 'TRIAL'`.
     * TRIAL ist ausgenommen — dort steuert der Trial-Lifecycle den Übergang.
     */
    findDuePendingPlanChanges(now: Date): Promise<DuePendingPlanChange[]>;
}
