// Onboarding & Promo-Preview — Wire-Format der neu eingeführten REST-Endpoints
// in `@saasicat/nest`:
//   - POST /billing/promo/preview  (PromoCodePublicController, ungebundener
//     Marketing-/Onboarding-Aufruf, rate-limitiert)
//   - POST /billing/onboarding/initial-subscription  (TenantBillingController,
//     einmaliger Onboarding-Schritt: Plan + Bundles + ggf. Promo)
//
// Spec-Referenz: handoff/superadmin/OPEN_ISSUES.md §Onboarding-Konfigurator
// (Phase 1).

import type { BillingCycle } from './promo-code.types.js';
import type { FeatureKey, PlanId, QuotaKey } from './plan-catalog.types.js';

// -----------------------------------------------------------------------------
// Promo-Preview (öffentlicher Endpoint)
// -----------------------------------------------------------------------------

export interface PromoPreviewRequest {
    /** Promo-Code (case-insensitive, wird im Service auf Uppercase normalisiert). */
    code: string;
    /** Plan-ID, gegen die der Code geprüft wird. */
    plan: PlanId;
    billingCycle: BillingCycle;
    /** Optional — für firstTimeCustomersOnly-Check. */
    email?: string;
}

/**
 * Wire-Format der Service-Antwort. Decimals als String (zwei Nachkommastellen),
 * Datumsangaben als ISO-8601-String. Entspricht 1:1 dem Service-Return-Type
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
        /** Decimal-as-string, z. B. "199.00". */
        originalGross: string;
        discountGross: string;
        discountedGross: string;
        includedVat: string;
        nextRegularAmountGross: string;
        /** ISO-Datum, ab dem der reguläre Preis greift, oder null bei ONCE. */
        regularStartsAt: string | null;
    };
}

// -----------------------------------------------------------------------------
// Onboarding-Initial-Subscription (Tenant-authenticated)
// -----------------------------------------------------------------------------

export interface OnboardingSelectionRequest {
    plan: PlanId;
    billingCycle: BillingCycle;
    /**
     * Optional: Live-BundleVersion-IDs eigenständig buchbarer Bundles.
     * Diese werden vom Backend nach dem Plan-Setup best-effort gebucht.
     */
    bundleVersionIds?: string[];
    /** Optional — falls gesetzt, wird der Code atomar mit der Plan-Auswahl eingelöst. */
    promoCode?: string;
}

export interface OnboardingSelectionResponse {
    plan: PlanId;
    billingCycle: BillingCycle;
    /**
     * Anzahl tatsächlich gebuchter Bundles (P11.7.3). Bundles werden
     * **nach** dem Plan-Wechsel best-effort hinzugefügt — fehlgeschlagene
     * Buchungen landen als Warnings, ohne den Plan-Wechsel zurückzurollen.
     */
    bundlesAdded: number;
    /**
     * Promo-Einlösung — `null`, wenn kein Code geschickt wurde oder die
     * Einlösung fehlgeschlagen ist (Plan-Wechsel + Bundles sind dann trotzdem
     * persistiert; die UI zeigt einen Hinweis und erlaubt dem Tenant, den Code
     * später per `POST /billing/promo/redeem` einzulösen).
     */
    promoRedemption: OnboardingPromoRedemption | null;
    /**
     * Zusätzliche Quota-Hinweise oder Warnungen, die der Service während des
     * Onboardings produziert hat (z. B. Plan-Downgrade-Blocker, die nicht
     * angewendet wurden, oder Bundle-Buchungs-Fehler). Leer bei Erfolg ohne
     * Auffälligkeiten.
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
    /** ISO-Datum. */
    startsAt: string;
    /** ISO-Datum oder null bei ONCE. */
    endsAt: string | null;
}

// Re-Exports zur Bequemlichkeit der UI/Client-Konsumenten.
export type { BillingCycle, PlanId, FeatureKey, QuotaKey };
