// Entitlement-Types — Snapshot-Form für Pure-Function-Aggregation.
//
// Konsumenten mappen ihre Prisma-Models auf diese Snapshots; die Plattform-
// Aggregation arbeitet ausschließlich auf dieser Form (keine Prisma-Imports).
//
// Spec: yada-services/handoff/superadmin/UMSETZUNGSPLAN.md §3.2 (1.6).

import type { FeatureKey, PlanId, QuotaKey } from '@saasicat/types';

/**
 * Snapshot der bindenden `PlanVersion` einer Subscription. Quotas werden als
 * Record aus `quotaKey → number` geliefert; konkrete Keys deklariert der
 * Code via `@DefinesQuota`.
 *
 * `-1` ist Catalog-Konvention für „unbegrenzt" — Konsumenten müssen das
 * selbst auf `Number.POSITIVE_INFINITY` mappen, wenn sie damit rechnen.
 */
export interface PlanVersionSnapshot {
    planId: PlanId;
    quotas: Record<QuotaKey, number>;
    features: FeatureKey[];
}

/**
 * Snapshot einer published BundleVersion (für BusinessType-Aggregation).
 * Konsument löst die Bundle-Komposition vor dem `aggregateLimits()`-Aufruf
 * via Repository-Lookup auf.
 */
export interface BundleVersionSnapshot {
    bundleKey: string;
    quotas: Record<QuotaKey, number>;
    features: FeatureKey[];
}

/**
 * Snapshot der bindenden `BusinessTypeVersion` einer Subscription
 * (SPEC_V2 §11.1 M5). Enthält die aufgelösten Bundle-Snapshots in der
 * sortOrder-Reihenfolge, plus die Quota-Overrides der BusinessTypeVersion.
 *
 * Aggregation (siehe GESCHAEFTSTYP_SPEC §6.2):
 * - Quotas: Σ(Bundle-Quotas) pro QuotaKey, dann Override durch
 *   `quotaOverrides[k]` falls gesetzt
 * - Features: ⋃ aller Bundle-Features (Set-Union)
 */
export interface BusinessTypeVersionSnapshot {
    businessTypeKey: string;
    /** Bundles in sortOrder-Reihenfolge. */
    bundles: BundleVersionSnapshot[];
    /** Override pro QuotaKey. Fehlender Key → Σ(Bundle-Quotas) wird verwendet. */
    quotaOverrides: Partial<Record<QuotaKey, number>>;
}

/**
 * Snapshot einer aktiven SubscriptionBundle-Buchung (P11.7.3 +
 * SPEC_V2 §11.1 M6 Pack 2e). Wird vom EntitlementService aus der
 * `subscription_bundles`-Junction + BundleRepository.findVersionById
 * aufgelöst und an `aggregateLimits` gereicht.
 *
 * Aggregation: Quotas additiv mit -1-Dominanz, Features ⋃-Set-Union.
 * Filter (`canceledEffectiveAt > now`) liegt im Aggregator
 * (`filterActiveSubscriptionBundles`), damit der Caller einfach alle
 * Buchungen mitgeben kann.
 */
export interface SubscriptionBundleSnapshot {
    bundleKey: string;
    features: FeatureKey[];
    quotas: Record<QuotaKey, number>;
    /**
     * Datum, bis zu dem die Buchung effektiv läuft (= NULL bei
     * nicht-gekündigten Buchungen). Aggregator filtert
     * `canceledEffectiveAt > now` als aktiv.
     */
    canceledEffectiveAt: Date | null;
}

/**
 * Konsumenten-Override aus `Subscription.customLimits` (z. B. ENTERPRISE-
 * Sondervertrag oder Pilot). Feldweise — nicht gesetzte Quotas/Features
 * fallen auf den Plan-Default zurück.
 */
export interface CustomLimitsShape {
    quotas?: Record<QuotaKey, number>;
    features?: FeatureKey[];
}

/**
 * Eingabe für `aggregateLimits` — die Plattform erwartet, dass der
 * Konsument die Plan-Auflösung (Trial/Pilot/Pending) bereits durchgeführt
 * hat. `plan` und `planVersion` sind das Ergebnis dieser Auflösung; siehe
 * `resolveEntitlementPlan` für eine konfigurierbare Default-Strategie.
 *
 * `businessTypeVersion` ist optional (SPEC_V2 §11.1 M5). Wenn gesetzt,
 * wird die BusinessType-Komposition zusätzlich zu Plan + Add-ons in die
 * Aggregation einbezogen — siehe GESCHAEFTSTYP_SPEC §6.
 */
export interface SubscriptionLimitsInput {
    plan: PlanId;
    planVersion: PlanVersionSnapshot;
    businessTypeVersion?: BusinessTypeVersionSnapshot | null;
    /**
     * Aktive Bundle-Buchungen (P11.7.3). Aggregator filtert nach
     * `canceledEffectiveAt > now` und summiert Quotas + sammelt
     * Features in die effektiven Limits.
     */
    subscriptionBundles?: SubscriptionBundleSnapshot[];
    customLimits?: CustomLimitsShape | null;
}

/**
 * Effektive Limits eines Tenants: Plan-ID + aggregierte Quotas + Features.
 */
export interface EffectiveLimits {
    plan: PlanId;
    quotas: Record<QuotaKey, number>;
    features: Set<FeatureKey>;
}

/**
 * Serialisierbare Form für Snapshot-Felder (z. B. `Invoice.entitlementSnapshot`).
 * `features` ist ein sortiertes Array statt Set für stabile JSON-Serialisierung.
 */
export interface EffectiveLimitsSnapshot {
    plan: PlanId;
    quotas: Record<QuotaKey, number>;
    features: FeatureKey[];
}
