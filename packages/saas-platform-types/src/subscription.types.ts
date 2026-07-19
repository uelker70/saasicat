// Subscription — Plattform-Tabellen-Wire-Format.
// Schema-Quelle: autohauspro/handoff/saas/DATA_MODEL.md §1
// + ROADMAP_PLANS_AND_ENTITLEMENT.md §3 (Plan-Versionierung)

import type { PlanId, QuotaKey, FeatureKey } from './plan-catalog.types.js';
import type { BillingCycle } from './promo-code.types.js';

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'PENDING_SALES';

export interface Subscription {
    id: string;
    tenantId: string;
    planId: PlanId;
    /** FK auf PlanVersion — verbindlich für Bestand (Vertragsschutz P1). */
    planVersionId: string;
    billingCycle: BillingCycle;
    status: SubscriptionStatus;

    /** Override per Tenant; nicht-gesetzte Felder fallen auf PlanVersion zurück. */
    customLimits?: Partial<Record<QuotaKey, number>>;
    /** ENTERPRISE-Sondervertrag. */
    customMonthlyNet?: number | null;

    isPilot: boolean;
    pilotEndsAt: string | null;
    pilotNote?: string | null;

    trialEndsAt: string | null;
    startedAt: string;
    canceledAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;

    /** Plan-Version-Migration (siehe ROADMAP §6). */
    pendingPlanVersionId: string | null;
    pendingPlanVersionEffectiveAt: string | null;
    pendingPlanVersionAccepted: boolean;
    pendingPlanVersionAcceptedAt: string | null;
    pendingPlanVersionAcceptedByUserId: string | null;
    pendingPlanVersionNotifiedAt: string | null;
    pendingPlanVersionReminderSentAt: string | null;

    /** Plan-Wechsel zum Periodenende (orthogonal zu pendingPlanVersionId). */
    pendingPlanId: PlanId | null;
    pendingBillingCycle: BillingCycle | null;
    pendingEffectiveAt: string | null;

    postTrialPlanId: PlanId | null;
    trialEntitlementPlanId: PlanId | null;

    createdAt: string;
    updatedAt: string;
}

// ──────────────────────────────────────────────────────────────────
// PlanVersion — Vertragsschutz-Modell (ROADMAP §3.1)
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
    /** Vorgänger, gegen den der Draft diff'te. */
    baseVersionId: string | null;
    /** null = Draft, gesetzt = live oder superseded. */
    publishedAt: string | null;
    /** gesetzt = nicht mehr vermarktet, aber für Bestand vertraglich gültig. */
    supersededAt: string | null;
    publishedChanges: VersionChange[] | null;
    /** Pflicht beim Publish; in Notification-Mails zitiert. */
    changeNote: string;
    /** Beim Publish errechnet. */
    nonRegressive: boolean;
    /**
     * Ab wann diese Version für *neue* Buchungen aktiv ist (SPEC_V2 §4.2).
     * null = Draft (noch kein Datum). Pflicht beim Publish; muss strikt nach
     * `validFrom` der Vorgänger-Version liegen.
     */
    validFrom: string | null;
    /**
     * Bis wann diese Version für *neue* Buchungen verfügbar ist; null = unbegrenzt.
     * Wird beim Publish einer Nachfolge-Version automatisch auf
     * `nachfolger.validFrom - 1 Tag` gesetzt (Auto-Sukzession).
     * Bestand-Subscriptions (P1) bleiben davon unberührt.
     */
    validUntil: string | null;
    createdByUserId: string | null;
    publishedByUserId: string | null;
    createdAt: string;
    updatedAt: string;

    /**
     * Computed beim List-Read im Service: `true`, wenn keine Version mit
     * höherer `version`-Nummer (gleicher Stamm) existiert. Wird gebraucht,
     * um eine published-but-future Version editierbar zu halten — nur die
     * letzte in der Kette darf nachjustiert werden, weil Folgeversionen
     * sonst inkonsistent würden. Optional, weil Adapter-Reads, die das
     * Feld nicht setzen, vom Helper als `undefined → false` interpretiert
     * werden (= eingefroren).
     */
    isLatestInChain?: boolean;

    /**
     * Computed beim List-Read im Service: Anzahl Subscriptions, die diese
     * Version binden. Wird gebraucht, um eine published-but-future Version
     * editierbar zu halten — sobald eine Buchung existiert, ist die
     * Version eingefroren, weil sie zum Vertragsgegenstand wurde. Optional
     * aus Backwards-Compat-Gründen; der Helper interpretiert `undefined`
     * defensiv als `>0` (= eingefroren). Wie der Adapter zählt, hängt vom
     * Versions-Typ ab: PlanVersion über `Subscription.planVersionId`
     * (+ `pendingPlanVersionId`), BundleVersion über die jeweilige
     * App-spezifische Subscription→Bundle-Bindung.
     */
    subscriptionCount?: number;
}

/**
 * SubscriptionBundle — Wire-Format der `subscription_bundles`-Junction
 * (SPEC_V2 §11.1 M6 Pack 2e). Modelliert eine **eigenständige** Bundle-
 * Buchung einer Subscription analog zur Plan-Buchung; Bundles werden mit
 * eigener Mindestlaufzeit + eigener Kündigung gepflegt (User-Anforderung
 * aus P11.7.3).
 *
 * - `bundleVersionId` bindet die Buchung an eine *exakte* BundleVersion
 *   (immutable; Bundle-Updates wirken erst nach einer neuen Version mit
 *   eigener Migration).
 * - `startedAt` ist Vertragsbeginn dieser Buchung.
 * - `minimumTermEndsAt` = Mindestlaufzeit-Ende; `null` = keine
 *   Mindestlaufzeit (Plattform-Default = 12 Monate, Service-Side gesetzt).
 * - `canceledAt` / `canceledEffectiveAt`: Kündigungs-Anker vs.
 *   Wirksamkeits-Datum. Vor Mindestlaufzeit-Ende ist `canceledEffectiveAt =
 *   minimumTermEndsAt`, sonst Periodenende der Subscription.
 *
 * Bestand-Schutz: für die SuperAdmin-Editor-Editierbarkeit zählt
 * `SubscriptionRepository.countByBundleVersionId` die nicht-gekündigten
 * Einträge (`canceledAt IS NULL OR canceledEffectiveAt > NOW()`).
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
 * API-View für `GET /billing/subscription-bundles`: Record + denormalisierte
 * Bundle-Infos (Key/Label/Preis) aus der gebuchten BundleVersion. So zeigt die
 * UI gebuchte Bundles ohne Katalog-Join an — der Katalog kann gefilterte/
 * abgelöste Versionen ausschließen, sonst fällt die Anzeige auf die rohe
 * bundleVersionId (UUID) zurück.
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
    /** Default = startedAt + 12 Monate, sofern nicht gesetzt. */
    minimumTermEndsAt?: Date | null;
}

export interface CancelSubscriptionBundleData {
    canceledAt: Date;
    /**
     * Effektives Wirksamkeitsdatum der Kündigung. Service rechnet das
     * vor: max(canceledAt + 1 Periode, minimumTermEndsAt).
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
