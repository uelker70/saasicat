// Subscription — platform table wire format.

import type { PlanId, QuotaKey, FeatureKey } from './plan-catalog.types.js';
import type { BillingCycle } from './promo-code.types.js';

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'PENDING_SALES';

export interface Subscription {
    id: string;
    tenantId: string;
    planId: PlanId;
    /** FK to PlanVersion — binding for existing subscriptions (contract protection P1). */
    planVersionId: string;
    billingCycle: BillingCycle;
    status: SubscriptionStatus;

    /** Override per Tenant; unset fields fall back to the PlanVersion. */
    customLimits?: Partial<Record<QuotaKey, number>>;
    /** ENTERPRISE special contract. */
    customMonthlyNet?: number | null;

    isPilot: boolean;
    pilotEndsAt: string | null;
    pilotNote?: string | null;

    trialEndsAt: string | null;
    startedAt: string;
    canceledAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;

    /** Plan version migration (see ROADMAP §6). */
    pendingPlanVersionId: string | null;
    pendingPlanVersionEffectiveAt: string | null;
    pendingPlanVersionAccepted: boolean;
    pendingPlanVersionAcceptedAt: string | null;
    pendingPlanVersionAcceptedByUserId: string | null;
    pendingPlanVersionNotifiedAt: string | null;
    pendingPlanVersionReminderSentAt: string | null;

    /** Plan change at period end (orthogonal to pendingPlanVersionId). */
    pendingPlanId: PlanId | null;
    pendingBillingCycle: BillingCycle | null;
    pendingEffectiveAt: string | null;

    postTrialPlanId: PlanId | null;
    trialEntitlementPlanId: PlanId | null;

    createdAt: string;
    updatedAt: string;
}

// ──────────────────────────────────────────────────────────────────
// PlanVersion — contract protection model (ROADMAP §3.1)
// ──────────────────────────────────────────────────────────────────

export type VersionChangeDirection = 'IMPROVEMENT' | 'REGRESSION' | 'NEUTRAL';

export interface VersionChange {
    field: string;
    oldValue: unknown;
    newValue: unknown;
    direction: VersionChangeDirection;
}

export interface VersionedEntityBase {
    id: string;
    version: number;
    /** Predecessor the draft diffed against. */
    baseVersionId: string | null;
    /** null = draft, set = live or superseded. */
    publishedAt: string | null;
    /** set = no longer marketed, but contractually valid for existing subscriptions. */
    supersededAt: string | null;
    publishedChanges: VersionChange[] | null;
    /** Required on publish; quoted in notification emails. */
    changeNote: string;
    /** Computed on publish. */
    nonRegressive: boolean;
    /**
     * From when this version is active for *new* bookings (SPEC_V2 §4.2).
     * null = draft (no date yet). Required on publish; must lie strictly after
     * the `validFrom` of the predecessor version.
     */
    validFrom: string | null;
    /**
     * Until when this version is available for *new* bookings; null = unlimited.
     * Automatically set to `successor.validFrom - 1 day` when a successor
     * version is published (auto-succession).
     * Existing subscriptions (P1) are unaffected by this.
     */
    validUntil: string | null;
    createdByUserId: string | null;
    publishedByUserId: string | null;
    createdAt: string;
    updatedAt: string;

    /**
     * Computed on the list read in the service: `true` when no version with a
     * higher `version` number (same lineage) exists. Needed to keep a
     * published-but-future version editable — only the last one in the chain
     * may be readjusted, because successor versions would otherwise become
     * inconsistent. Optional, because adapter reads that do not set the field
     * are interpreted by the helper as `undefined → false` (= frozen).
     */
    isLatestInChain?: boolean;

    /**
     * Computed on the list read in the service: number of subscriptions that
     * bind this version. Needed to keep a published-but-future version
     * editable — as soon as a booking exists, the version is frozen because it
     * has become part of the contract. Optional for backwards-compat reasons;
     * the helper defensively interprets `undefined` as `>0` (= frozen). How the
     * adapter counts depends on the version type: PlanVersion via
     * `Subscription.planVersionId` (+ `pendingPlanVersionId`), BundleVersion
     * via the respective app-specific Subscription→Bundle binding.
     */
    subscriptionCount?: number;
}

/**
 * SubscriptionBundle — wire format of the `subscription_bundles` junction
 * (SPEC_V2 §11.1 M6 Pack 2e). Models a **standalone** bundle booking of a
 * subscription, analogous to the plan booking; bundles are maintained with
 * their own minimum term + their own cancellation (user requirement from
 * P11.7.3).
 *
 * - `bundleVersionId` binds the booking to an *exact* BundleVersion
 *   (immutable; bundle updates only take effect after a new version with its
 *   own migration).
 * - `startedAt` is the contract start of this booking.
 * - `minimumTermEndsAt` = end of the minimum term; `null` = no minimum term
 *   (platform default = 12 months, set service-side).
 * - `canceledAt` / `canceledEffectiveAt`: cancellation anchor vs. effective
 *   date. Before the minimum term ends, `canceledEffectiveAt =
 *   minimumTermEndsAt`, otherwise the subscription's period end.
 *
 * Existing-subscription protection: for SuperAdmin editor editability,
 * `SubscriptionRepository.countByBundleVersionId` counts the non-canceled
 * entries (`canceledAt IS NULL OR canceledEffectiveAt > NOW()`).
 */
export interface SubscriptionBundleRecord {
    id: string;
    subscriptionId: string;
    bundleVersionId: string;
    startedAt: Date;
    minimumTermEndsAt: Date | null;
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * API view for `GET /billing/subscription-bundles`: record + denormalized
 * bundle info (key/label/price) from the booked BundleVersion. This lets the
 * UI show booked bundles without a catalog join — the catalog may exclude
 * filtered/superseded versions, otherwise the display falls back to the raw
 * bundleVersionId (UUID).
 */
export interface SubscriptionBundleView extends SubscriptionBundleRecord {
    bundleKey: string | null;
    label: string | null;
    monthlyNet: string | null;
}

export interface CreateSubscriptionBundleData {
    subscriptionId: string;
    bundleVersionId: string;
    startedAt: Date;
    /** Default = startedAt + 12 months, unless set. */
    minimumTermEndsAt?: Date | null;
}

export interface CancelSubscriptionBundleData {
    canceledAt: Date;
    /**
     * Effective date the cancellation takes effect. The service computes it:
     * max(canceledAt + 1 period, minimumTermEndsAt).
     */
    canceledEffectiveAt: Date;
}

export interface PlanVersion extends VersionedEntityBase {
    planId: PlanId;
    features: FeatureKey[];
    quotas: Partial<Record<QuotaKey, number>>;
    monthlyNet: number;
    yearlyNet: number;
    marketed: boolean;
}
