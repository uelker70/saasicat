// Onboarding & promo preview — wire format of the newly introduced REST endpoints
// in `@saasicat/nest`:
//   - POST /billing/promo/preview  (PromoCodePublicController, unbound
//     marketing/onboarding call, rate-limited)
//   - POST /billing/onboarding/initial-subscription  (TenantBillingController,
//     one-time onboarding step: plan + bundles + optional promo)
//
// Spec reference: handoff/superadmin/OPEN_ISSUES.md §Onboarding-Konfigurator
// (Phase 1).

import type { BillingCycle } from './promo-code.types.js';
import type { FeatureKey, PlanId, QuotaKey } from './plan-catalog.types.js';

// -----------------------------------------------------------------------------
// Promo preview (public endpoint)
// -----------------------------------------------------------------------------

export interface PromoPreviewRequest {
    /** Promo code (case-insensitive, normalized to uppercase in the service). */
    code: string;
    /** Plan ID the code is validated against. */
    plan: PlanId;
    billingCycle: BillingCycle;
    /** Optional — for the firstTimeCustomersOnly check. */
    email?: string;
}

/**
 * Wire format of the service response. Decimals as string (two decimal places),
 * dates as ISO-8601 string. Corresponds 1:1 to the service return type
 * `PreviewResult` (saas-platform-nest/promo).
 */
export type PromoPreviewResponse =
    | { valid: false; reason: PromoPreviewInvalidReason }
    | PromoPreviewValidResponse;

export type PromoPreviewInvalidReason =
    | 'NOT_FOUND'
    | 'EXPIRED'
    | 'EXHAUSTED'
    | 'PAUSED'
    | 'PLAN_MISMATCH'
    | 'BILLING_MISMATCH'
    | 'BELOW_MINIMUM_AMOUNT'
    | 'WOULD_PRODUCE_ZERO_INVOICE'
    | 'NOT_FIRST_TIME_CUSTOMER'
    | 'RATE_LIMITED';

export interface PromoPreviewValidResponse {
    valid: true;
    code: string;
    label: string;
    discount: {
        valueType: 'PERCENT' | 'ABSOLUTE';
        /** Decimal-as-string. */
        value: string;
        durationType: 'ONCE' | 'MONTHS' | 'BILLING_CYCLES';
        durationValue: number | null;
    };
    price: {
        /** Decimal-as-string, e.g. "199.00". */
        originalGross: string;
        discountGross: string;
        discountedGross: string;
        includedVat: string;
        nextRegularAmountGross: string;
        /** ISO date from which the regular price applies, or null for ONCE. */
        regularStartsAt: string | null;
    };
}

// -----------------------------------------------------------------------------
// Onboarding initial subscription (tenant-authenticated)
// -----------------------------------------------------------------------------

export interface OnboardingSelectionRequest {
    plan: PlanId;
    billingCycle: BillingCycle;
    /**
     * Optional: live BundleVersion IDs of independently bookable bundles.
     * These are booked best-effort by the backend after the plan setup.
     */
    bundleVersionIds?: string[];
    /** Optional — if set, the code is redeemed atomically with the plan selection. */
    promoCode?: string;
}

export interface OnboardingSelectionResponse {
    plan: PlanId;
    billingCycle: BillingCycle;
    /**
     * Number of bundles actually booked (P11.7.3). Bundles are added
     * best-effort **after** the plan change — failed bookings end up as
     * warnings without rolling back the plan change.
     */
    bundlesAdded: number;
    /**
     * Promo redemption — `null` if no code was sent or the redemption
     * failed (plan change + bundles are then persisted anyway; the UI shows
     * a hint and lets the tenant redeem the code later via
     * `POST /billing/promo/redeem`).
     */
    promoRedemption: OnboardingPromoRedemption | null;
    /**
     * Additional quota hints or warnings the service produced during
     * onboarding (e.g. plan-downgrade blockers that were not applied, or
     * bundle-booking errors). Empty on success without anomalies.
     */
    warnings: string[];
}

export interface OnboardingPromoRedemption {
    code: string;
    discount: {
        valueType: 'PERCENT' | 'ABSOLUTE';
        value: string;
        durationType: 'ONCE' | 'MONTHS' | 'BILLING_CYCLES';
        durationValue: number | null;
    };
    /** ISO date. */
    startsAt: string;
    /** ISO date or null for ONCE. */
    endsAt: string | null;
}

// Re-exports for the convenience of UI/client consumers.
export type { BillingCycle, PlanId, FeatureKey, QuotaKey };
