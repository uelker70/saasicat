import type { TransactionContext } from './core-ports.types.js';
import type { PromoCodeRedemptionRecord } from './promo-ports.types.js';
import type {
    CancelSubscriptionBundleData,
    CreateSubscriptionBundleData,
    SubscriptionBundleRecord,
} from '../subscription.types.js';
import type {
    CreateSubscriptionContractData,
    SubscriptionContractFilter,
    SubscriptionContractRecord,
    TerminateSubscriptionContractData,
} from '../subscription-contract.types.js';

// -----------------------------------------------------------------------------
// Billing repository and tenant self-service ports
// -----------------------------------------------------------------------------

/**
 * Snapshot form of a `Subscription` row for the EntitlementService
 * computation. The consumer maps its Prisma structure onto this form.
 */
export interface SubscriptionRecord {
    id: string;
    tenantId: string;
    plan: string;
    status: string;
    isPilot?: boolean;
    trialEntitlementPlan?: string | null;
    pendingPlan?: string | null;
    pendingEffectiveAt?: Date | null;
    customLimits?: { quotas?: Record<string, number>; features?: string[] } | null;
    planVersionId: string;
    planVersion: PlanVersionRecord;
}

/** Snapshot of a `PlanVersion` row. */
export interface PlanVersionRecord {
    planId: string;
    quotas: Record<string, number>;
    features: string[];
}

/**
 * Read adapter for subscriptions. The consumer implementation loads from its
 * own `Subscription` table incl. eager-loaded `planVersion`
 * and maps to `SubscriptionRecord`.
 */
export interface SubscriptionRepository {
    /** Returns a tenant's subscription or null. */
    findByTenantId(tenantId: string): Promise<SubscriptionRecord | null>;
    /**
     * Like `findByTenantId`, but within the transaction with a row lock
     * (`SELECT ... FOR UPDATE`). Used by the transactional `enforceLimit`
     * path to serialize concurrent creations on the same tenant.
     */
    findByTenantIdLocked(
        tenantId: string,
        tx: TransactionContext,
    ): Promise<SubscriptionRecord | null>;

    /**
     * Counts subscriptions that bind a specific PlanVersion — both
     * via the active `planVersionId` and via the scheduled `pendingPlanVersionId`.
     * Needed by the `PlanVersionsService` for the editability decision:
     * a published-but-future PlanVersion stays correctable only as long
     * as no booking references it.
     *
     * Optional for backwards-compat reasons — if an adapter does not
     * implement the method, the service defensively treats the version as
     * frozen (fail-closed). Implementation hint: count in a single
     * COUNT(*) over the subscription table with an OR over the two
     * FK columns — not in two separate queries, to avoid race conditions.
     */
    countByPlanVersionId?(planVersionId: string): Promise<number>;

    /**
     * Counts active (= not-canceled, or cancellation still in the future)
     * SubscriptionBundle entries that bind a specific BundleVersion.
     * Bundles are versioned and marketed independently (analogous to
     * plans); the `BundlesService` needs the count for the editability
     * decision of a published-but-future BundleVersion.
     *
     * Implementation since P11.7.3: direct COUNT on
     * `subscription_bundles WHERE bundleVersionId = ? AND
     * (canceledAt IS NULL OR canceledEffectiveAt > NOW())`. Apps without
     * a SubscriptionBundle schema (or without the platform migration) can
     * still return 0; the editability feature is then no longer
     * fail-closed against bookings, but still latest-in-chain +
     * validFrom-future.
     *
     * Optional — if not implemented, the service defensively treats the
     * version as frozen (fail-closed).
     */
    countByBundleVersionId?(bundleVersionId: string): Promise<number>;

    /**
     * Counts active subscriptions (status `ACTIVE` or `TRIAL`) per plan key,
     * platform-wide across all tenants of the project — feeds the tenant
     * column of the SuperAdmin plan list (`GET /admin/catalog/plans/tenant-counts`).
     * Cross-version: counts the plan, not a single PlanVersion
     * (subscriptions on superseded versions are included). `projectKey` is
     * informational for single-project consumers.
     *
     * Returns a map `planKey → count`; plans without an active subscription
     * are missing (UI defaults to 0). Platform-wide count across all tenants →
     * adapters must count RLS-exempt.
     *
     * Optional — if not implemented, the tenant column stays 0.
     */
    countActiveByPlanKey?(projectKey: string): Promise<Record<string, number>>;
}

/**
 * Adapter for the `subscription_bundles` junction (SPEC_V2 §11.1 M6 Pack 2e).
 * Consumers implement it against their Prisma table. Writing
 * via `add` / `cancel` is always a side effect of the subscription-service
 * methods — the repository is dumb persistence, no domain
 * constraints (plan compatibility, minimum-term default) here.
 */
export interface SubscriptionBundleRepository {
    /** All bundle bookings of a subscription, newest first. */
    listBySubscription(subscriptionId: string): Promise<SubscriptionBundleRecord[]>;
    /** A single booking (for the cancel/detail flow). */
    findById(subscriptionBundleId: string): Promise<SubscriptionBundleRecord | null>;
    /**
     * Active bookings of a subscription (`canceledAt IS NULL OR
     * canceledEffectiveAt > NOW()`). Used by the Entitlement path.
     */
    listActiveBySubscription(
        subscriptionId: string,
        asOf?: Date,
    ): Promise<SubscriptionBundleRecord[]>;
    add(data: CreateSubscriptionBundleData): Promise<SubscriptionBundleRecord>;
    /**
     * Sets `canceledAt` + `canceledEffectiveAt`. Throws on already
     * canceled bookings — the service may offer "undo cancellation"
     * as a separate path (not in this iteration).
     */
    cancel(
        subscriptionBundleId: string,
        data: CancelSubscriptionBundleData,
    ): Promise<SubscriptionBundleRecord>;
    /**
     * "Undo cancellation": resets `canceledAt` + `canceledEffectiveAt` to
     * NULL. Only meaningful as long as the cancellation is not yet effective
     * (`canceledEffectiveAt > NOW()`); the validity check is done by the service.
     */
    reactivate(subscriptionBundleId: string): Promise<SubscriptionBundleRecord>;
    /**
     * Counts active bundle bookings for a BundleVersion (same
     * semantics as `SubscriptionRepository.countByBundleVersionId`, only
     * directly on the junction adapter). Shared by both repository
     * implementations to avoid drift.
     */
    countActiveByBundleVersionId(bundleVersionId: string, asOf?: Date): Promise<number>;
}

/**
 * Append-only repository for V3 SubscriptionContracts. Contracts are the
 * contractually binding source for billing and entitlement; catalog FKs are only
 * trace data. Implementations may close existing contracts (at the domain level)
 * only via `terminate`, not overwrite LineItems/Snapshots.
 */
export interface SubscriptionContractRepository {
    list(filter: SubscriptionContractFilter): Promise<SubscriptionContractRecord[]>;
    findById(contractId: string): Promise<SubscriptionContractRecord | null>;
    findActiveByTenantId(tenantId: string, asOf?: Date): Promise<SubscriptionContractRecord | null>;
    create(data: CreateSubscriptionContractData): Promise<SubscriptionContractRecord>;
    terminate(
        contractId: string,
        data: TerminateSubscriptionContractData,
    ): Promise<SubscriptionContractRecord>;
}

// -----------------------------------------------------------------------------
// Tenant billing ports (Phase B — UI/display form for GET /billing/usage)
// -----------------------------------------------------------------------------

/**
 * Display form of a subscription for the tenant self-service UI.
 * Richer than `SubscriptionRecord` (which is only the aggregation form); contains
 * additional fields such as `billingCycle`, pilot/trial date and full
 * plan-version metadata.
 *
 * The platform controller `GET /billing/usage` maps this form 1:1 into the
 * response body. The consumer adapter loads from its own subscription
 * table (Prisma include planVersion + pendingPlanVersion).
 */
export interface SubscriptionUsageRecord {
    /**
     * Subscription primary key. Optional, because existing adapters may not
     * yet pass the column through — the platform service uses it
     * only for downstream steps such as atomic promo-redeem in the
     * onboarding endpoint. Adapters that want to support `POST /billing/onboarding/initial-subscription`
     * with a promo code must set `id`.
     */
    id?: string;
    plan: string;
    billingCycle: string;
    status: string;
    isPilot: boolean;
    pilotEndsAt: Date | null;
    trialEndsAt: Date | null;
    /** Subscription start (= period-window anchor for `periodEndAfter`). */
    startedAt: Date | null;
    /** Current period window — for proration and change-effective date. */
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    pendingPlan: string | null;
    pendingBillingCycle: string | null;
    pendingEffectiveAt: Date | null;
    planVersion: {
        id: string;
        planId: string;
        version: number;
        publishedAt: Date | null;
        supersededAt: Date | null;
        changeNote: string | null;
    };
    pendingPlanVersion: {
        id: string;
        planId: string;
        version: number;
        nonRegressive: boolean;
        changeNote: string | null;
        /** Catalog diff form from version-publish; free-form JSON structure. */
        publishedChanges: unknown;
    } | null;
    pendingPlanVersionEffectiveAt: Date | null;
    pendingPlanVersionAccepted: boolean;
    pendingPlanVersionAcceptedAt: Date | null;
    /**
     * P11.4 (METAMODELL §17a): frozen package snapshot from the
     * `CheckoutOffer` that was activated during onboarding. Read-only —
     * serves only for display in the tenant self-service UI, so that the
     * tenant knows *which* advertised package was concretely booked.
     * `null` for subscriptions that did not originate from a CheckoutOffer
     * (direct creation, migration).
     */
    packageSnapshot?: unknown | null;
    /**
     * P11.4: reference to the original `CheckoutOffer.id`. Mostly not needed
     * for the UI (the snapshot is self-contained), but useful for support
     * tools and audit.
     */
    checkoutOfferId?: string | null;
}

/**
 * Read adapter for the UI/display form of a subscription. Used by
 * `TenantBillingController.getUsage`.
 */
export interface SubscriptionUsagePort {
    findForTenant(tenantId: string): Promise<SubscriptionUsageRecord | null>;
}

/**
 * Returns the current usage for all quotaKeys of a tenant declared via
 * `@DefinesQuota` (e.g. `{ users: 4, members: 850, storageGb: 1.2 }`).
 * The consumer may use its own counter strategies (Prisma counts,
 * DMS-service roundtrip, cached storage tracker, …) and must decide
 * soft-fail behavior itself.
 *
 * If a quotaKey is missing from the return object, the platform controller
 * maps it to `0` — robust display, even if a counter is not (yet) implemented.
 */
export interface UsageSnapshotPort {
    snapshot(tenantId: string): Promise<Record<string, number>>;
}

// -----------------------------------------------------------------------------
// Tenant billing write port (Phase C — plan change)
// -----------------------------------------------------------------------------

/** Input for `changePlanImmediate` with optional period-window reset. */
export interface ImmediatePlanChangeInput {
    planId: string;
    cycle: string;
    /** Reset the period window (pro-rata change). NULL for TRIAL. */
    periodStart: Date | null;
    periodEnd: Date | null;
    /** Target status — for TRIAL the status is not overwritten. */
    nextStatus: string | null;
    /**
     * Trial carry-over (#17): new trial end when changing DURING the trial.
     * Computed by the platform `changePlan` path from the `TrialProjectionPort`.
     * `undefined`/`null` → adapter leaves `trialEndsAt` unchanged (no trial
     * change, or target package without trial). A `Date` is persisted.
     */
    trialEndsAt?: Date | null;
}

/** Input for `schedulePlanChange` (change at period end). */
export interface ScheduledPlanChangeInput {
    pendingPlan: string;
    pendingBillingCycle: string;
    pendingEffectiveAt: Date;
}

/**
 * Input for `applyOnboardingSelection`. Plan-change fields that the
 * adapter persists atomically in a single transaction.
 */
export interface ApplyOnboardingSelectionInput {
    planId: string;
    cycle: string;
    /** For TRIAL → null, otherwise period start from `initialPeriodWindow`. */
    periodStart: Date | null;
    periodEnd: Date | null;
    /** For TRIAL → null, otherwise typically `'ACTIVE'`. */
    nextStatus: string | null;
}

/**
 * Result of the atomically executed onboarding step. Contains all
 * effects that the platform service can log / respond with downstream.
 */
export interface ApplyOnboardingSelectionResult {
    plan: string;
    billingCycle: string;
    subscriptionId: string;
    /** null if no redeemPromo callback was provided or the callback returned null. */
    promoRedemption: PromoCodeRedemptionRecord | null;
}

/**
 * Callback signature for promo-code redemption WITHIN the onboarding
 * transaction. The platform service injects a closure that calls `PromoCodesService.
 * redeemInTransaction(...)`; the adapter calls it after the
 * subscription update, so that everything lives in a single DB transaction.
 */
export type RedeemPromoInTransactionCallback = (
    tx: TransactionContext,
    subscriptionId: string,
) => Promise<PromoCodeRedemptionRecord>;

/**
 * Write adapter for tenant self-service mutations
 * (`POST /billing/plan`, `/billing/cancel` etc.).
 *
 * The consumer implementation persists into its subscription table.
 * Atomicity lies in the adapter, because transaction-client types are
 * app-specific. The platform service calls `invalidateTenant` in the
 * EntitlementService after a successful adapter call.
 */
export interface TenantSubscriptionWritePort {
    /** Immediate change: set plan + cycle, clear pending fields, optionally reset the period. */
    changePlanImmediate(
        tenantId: string,
        input: ImmediatePlanChangeInput,
    ): Promise<{ plan: string; billingCycle: string }>;

    /** Change at period end: set pending fields. */
    schedulePlanChange(tenantId: string, input: ScheduledPlanChangeInput): Promise<void>;

    /**
     * Marks the pending PlanVersion as accepted. Idempotent — a duplicate
     * accept is a no-op. Returns `alreadyAccepted: true` if the status was
     * already set.
     */
    acceptPendingPlanVersion(
        tenantId: string,
        userId: string,
        now: Date,
    ): Promise<{
        accepted: boolean;
        acceptedAt: Date | null;
        effectiveAt: Date | null;
        alreadyAccepted: boolean;
    }>;

    /**
     * Cancel the subscription. `immediate=true` → status CANCELED from now;
     * `false` → canceledAt = currentPeriodEnd, status is preserved.
     */
    cancelSubscription(
        tenantId: string,
        immediate: boolean,
        now: Date,
    ): Promise<{ canceledAt: Date | null; status: string }>;

    /**
     * Atomic onboarding creation: sets plan + cycle + period window
     * AND optionally calls a promo-redeem callback — all in a
     * single consumer transaction. Without this method the
     * platform service falls back to sequential `changePlanImmediate +
     * promoCodes.redeem` calls (best-effort,
     * P10.1.1 transitional solution).
     *
     * Optional, because existing adapters can add the support
     * incrementally — a missing implementation is not a hard error.
     */
    applyOnboardingSelection?(
        tenantId: string,
        input: ApplyOnboardingSelectionInput,
        redeemPromo: RedeemPromoInTransactionCallback | null,
    ): Promise<ApplyOnboardingSelectionResult>;
}

/** Read adapter for PlanVersions. */
export interface PlanVersionRepository {
    /**
     * Currently published (= live) PlanVersion of a plan:
     * `publishedAt IS NOT NULL AND supersededAt IS NULL`. Optionally within a
     * transaction.
     *
     * Note: ignores `validFrom`/`validUntil`. For time-aware
     * resolution (onboarding, plan fallback for TRIAL) use `findActive`.
     */
    findLatestLive(planId: string, tx?: TransactionContext): Promise<PlanVersionRecord | null>;

    /**
     * PlanVersion of a plan active at `asOf`:
     *   `publishedAt IS NOT NULL`
     *   `validFrom <= asOf`
     *   `(validUntil IS NULL OR validUntil > asOf)`
     *
     * If multiple match: highest `validFrom`. Adapters that do not yet have
     * `validFrom`/`validUntil` columns may omit the field
     * (consumers fall back to `findLatestLive`).
     */
    findActive?(
        planId: string,
        asOf?: Date,
        tx?: TransactionContext,
    ): Promise<PlanVersionRecord | null>;
}
