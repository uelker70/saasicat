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
export const TENANT_AUTH_GUARDS_TOKEN = Symbol.for('saasicat/nest/TenantAuthGuards');

/**
 * Resolver function `(req) => string` that extracts the `tenantId` from the
 * request. Default: `req.user.tenantId`.
 */
export const TENANT_ID_RESOLVER_TOKEN = Symbol.for('saasicat/nest/TenantIdResolver');

/**
 * Resolver function `(req) => string` that extracts the `userId` from the
 * request. Default: `req.user.sub ?? req.user.id`.
 */
export const USER_ID_RESOLVER_TOKEN = Symbol.for('saasicat/nest/UserIdResolver');

/**
 * Resolver function `(req) => string` that extracts the user email from the
 * request. Optional — used by the audit-log path to build the AdminActor
 * (`{userId, email, source: 'web', context}`). Default: `req.user.email`.
 * If the consumer's JWT does not carry an email, the resolver can return
 * `null` — the audit-log path then falls back to `'unknown'`.
 */
export const USER_EMAIL_RESOLVER_TOKEN = Symbol.for('saasicat/nest/UserEmailResolver');

/**
 * Resolver function `(req) => string` that extracts an audit context from the
 * request (e.g. session ID, trace ID). Default: `req.headers['x-session-id']`
 * or `'tenant-self-service'`.
 */
export const AUDIT_CONTEXT_RESOLVER_TOKEN = Symbol.for('saasicat/nest/AuditContextResolver');

/** Adapter token: consumer's `SubscriptionUsagePort` implementation. */
export const SUBSCRIPTION_USAGE_PORT_TOKEN = Symbol.for('saasicat/nest/SubscriptionUsagePort');

/** Adapter token: consumer's `UsageSnapshotPort` implementation. */
export const USAGE_SNAPSHOT_PORT_TOKEN = Symbol.for('saasicat/nest/UsageSnapshotPort');

/** Adapter token: consumer's `TenantSubscriptionWritePort` implementation. */
export const SUBSCRIPTION_WRITE_PORT_TOKEN = Symbol.for(
    'saasicat/nest/TenantSubscriptionWritePort',
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
export const TRIAL_PROJECTION_PORT_TOKEN = Symbol.for('saasicat/nest/TrialProjectionPort');

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
export const PENDING_PLAN_QUERY_PORT_TOKEN = Symbol.for('saasicat/nest/PendingPlanQueryPort');

/** A due scheduled plan change — minimal for materialization. */
export interface DuePendingPlanChange {
    tenantId: string;
    /** Target plan key of the scheduled change (`pendingPlan`). */
    pendingPlan: string;
    /** Target cycle (`pendingBillingCycle`); `null` → default MONTHLY. */
    pendingBillingCycle: string | null;
    /**
     * The subscription's cancellation, so materialization can decline.
     *
     * A change scheduled before the customer cancelled comes due anyway, and
     * applying it to a subscription that has already ended restarts the billing
     * period and runs the plan-change follow-up hooks on a contract that is
     * over. Required, and required together, for the reason the same pair is
     * required on `SubscriptionRecord`: a record that omits them cannot answer
     * the question, and the silent answer is to go ahead.
     *
     * A cancellation that has NOT landed does not decline anything — a customer
     * who bought a further period by cancelling late may still choose the plan
     * they spend it on.
     */
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
}

export interface PendingPlanQueryPort {
    /**
     * Returns all subscriptions with a due scheduled plan change:
     * `pendingPlan != null AND pendingEffectiveAt <= now AND status != 'TRIAL'`.
     * TRIAL is excluded — there the trial lifecycle drives the transition.
     *
     * Cancelled subscriptions are NOT excluded by the query: whether a landed
     * cancellation declines the change is a decision, and it is taken above
     * this port, from the two dates on the record.
     */
    findDuePendingPlanChanges(now: Date): Promise<DuePendingPlanChange[]>;
}

/**
 * Days before a term ends after which a cancellation lands one period later.
 *
 * Zero by default, and that is the value to leave it at unless someone asked
 * for otherwise: with no window there is no door to be shut out of, and a
 * customer who cancels on the last day of their year is out at the end of it.
 * Where a window is configured the cut is hard — four days late costs a year on
 * a yearly term — which is why `/plan` states the date before the confirmation
 * rather than after it.
 */
export const CANCELLATION_NOTICE_DAYS_TOKEN = Symbol.for('saasicat/nest/CancellationNoticeDays');
