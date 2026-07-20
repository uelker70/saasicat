// DI tokens for the TenantBillingModule.
//
// Consumers register their app-specific implementations
// (auth guards, tenant/user resolvers, adapter ports) via `forRoot()` —
// platform code only references the tokens.

import type { CanActivate } from '@nestjs/common';

/**
 * List of all auth guards the platform controller should iterate in order
 * (analogous to `@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)`).
 * Provided via `forRoot.authGuards` — can be an array of existing instances
 * or a factory provider.
 */
export const TENANT_AUTH_GUARDS_TOKEN = Symbol.for('saas-platform/TenantAuthGuards');

/**
 * Resolver function `(req) => string` that extracts the `tenantId` from the
 * request. Default: `req.user.tenantId`.
 */
export const TENANT_ID_RESOLVER_TOKEN = Symbol.for('saas-platform/TenantIdResolver');

/**
 * Resolver function `(req) => string` that extracts the `userId` from the
 * request. Default: `req.user.sub ?? req.user.id`.
 */
export const USER_ID_RESOLVER_TOKEN = Symbol.for('saas-platform/UserIdResolver');

/**
 * Resolver function `(req) => string` that extracts the user email from the
 * request. Optional — used by the audit-log path to build the AdminActor
 * (`{userId, email, source: 'web', context}`). Default: `req.user.email`.
 * If the consumer's JWT does not carry an email, the resolver can return
 * `null` — the audit-log path then falls back to `'unknown'`.
 */
export const USER_EMAIL_RESOLVER_TOKEN = Symbol.for('saas-platform/UserEmailResolver');

/**
 * Resolver function `(req) => string` that extracts an audit context from the
 * request (e.g. session ID, trace ID). Default: `req.headers['x-session-id']`
 * or `'tenant-self-service'`.
 */
export const AUDIT_CONTEXT_RESOLVER_TOKEN = Symbol.for('saas-platform/AuditContextResolver');

/** Adapter token: consumer's `SubscriptionUsagePort` implementation. */
export const SUBSCRIPTION_USAGE_PORT_TOKEN = Symbol.for('saas-platform/SubscriptionUsagePort');

/** Adapter token: consumer's `UsageSnapshotPort` implementation. */
export const USAGE_SNAPSHOT_PORT_TOKEN = Symbol.for('saas-platform/UsageSnapshotPort');

/** Adapter token: consumer's `TenantSubscriptionWritePort` implementation. */
export const SUBSCRIPTION_WRITE_PORT_TOKEN = Symbol.for(
    'saas-platform/TenantSubscriptionWritePort',
);

export type TenantIdResolver = (req: unknown) => string | null | undefined;
export type UserIdResolver = (req: unknown) => string | null | undefined;
export type UserEmailResolver = (req: unknown) => string | null | undefined;
export type AuditContextResolver = (req: unknown) => string | null | undefined;
export type AuthGuardList = ReadonlyArray<CanActivate>;

/**
 * Optional adapter token: projects the new trial end of a change
 * (app-specific trial logic, e.g. carry-over of the remaining time). Without a
 * port, `PlanChangePreviewDto.projectedTrialEndsAt` stays `null` and the wizard
 * falls back to the current trial end.
 */
export const TRIAL_PROJECTION_PORT_TOKEN = Symbol.for('saas-platform/TrialProjectionPort');

export interface TrialProjectionInput {
    /** Current plan key of the subscription. */
    currentPlan: string;
    /** Target plan key of the change. */
    targetPlan: string;
    /** Current trial end (null = no trial). */
    currentTrialEndsAt: Date | null;
    /** Subscription status (e.g. 'TRIAL'/'ACTIVE'). */
    status: string;
    now: Date;
}

export interface TrialProjectionPort {
    /**
     * Projected new trial end after the change. `null` if nothing changes or
     * the target package does not support a trial.
     */
    projectTrialEndsAt(input: TrialProjectionInput): Promise<Date | null>;
}

/**
 * Optional adapter token: provides due scheduled plan changes for the
 * `PendingPlanMaterializationService`. Without a port, the service is not
 * registered (materialization is opt-in).
 */
export const PENDING_PLAN_QUERY_PORT_TOKEN = Symbol.for('saas-platform/PendingPlanQueryPort');

/** A due scheduled plan change — minimal for materialization. */
export interface DuePendingPlanChange {
    tenantId: string;
    /** Target plan key of the scheduled change (`pendingPlan`). */
    pendingPlan: string;
    /** Target cycle (`pendingBillingCycle`); `null` → default MONTHLY. */
    pendingBillingCycle: string | null;
}

export interface PendingPlanQueryPort {
    /**
     * Returns all subscriptions with a due scheduled plan change:
     * `pendingPlan != null AND pendingEffectiveAt <= now AND status != 'TRIAL'`.
     * TRIAL is excluded — there the trial lifecycle drives the transition.
     */
    findDuePendingPlanChanges(now: Date): Promise<DuePendingPlanChange[]>;
}
