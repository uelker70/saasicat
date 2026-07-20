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
 * Snapshot-Form einer `Subscription`-Row für die EntitlementService-
 * Berechnung. Konsument mappt seine Prisma-Struktur auf diese Form.
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

/** Snapshot einer `PlanVersion`-Row. */
export interface PlanVersionRecord {
    planId: string;
    quotas: Record<string, number>;
    features: string[];
}

/**
 * Lese-Adapter für Subscriptions. Konsument-Implementation lädt aus seiner
 * eigenen `Subscription`-Tabelle inkl. eager-loaded `planVersion`
 * und mappt auf `SubscriptionRecord`.
 */
export interface SubscriptionRepository {
    /** Liefert die Subscription eines Tenants oder null. */
    findByTenantId(tenantId: string): Promise<SubscriptionRecord | null>;
    /**
     * Wie `findByTenantId`, aber innerhalb der Transaktion mit Row-Lock
     * (`SELECT ... FOR UPDATE`). Wird vom transactional `enforceLimit`-
     * Pfad benutzt, um konkurrierende Anlagen am gleichen Tenant zu
     * serialisieren.
     */
    findByTenantIdLocked(
        tenantId: string,
        tx: TransactionContext,
    ): Promise<SubscriptionRecord | null>;

    /**
     * Zählt Subscriptions, die eine konkrete PlanVersion binden — sowohl
     * via aktivem `planVersionId` als auch via geplantem `pendingPlanVersionId`.
     * Wird vom `PlanVersionsService` zur Editierbarkeits-Entscheidung
     * benötigt: eine published-but-future PlanVersion bleibt nur dann
     * korrigierbar, solange keine Buchung sie referenziert.
     *
     * Optional aus Backwards-Compat-Gründen — wenn ein Adapter die Methode
     * nicht implementiert, behandelt der Service die Version defensiv als
     * eingefroren (fail-closed). Implementierungs-Hinweis: zähle in einem
     * COUNT(*) über die Subscription-Tabelle mit OR-Verknüpfung der beiden
     * FK-Spalten — nicht in zwei separaten Queries, um Race-Conditions zu
     * vermeiden.
     */
    countByPlanVersionId?(planVersionId: string): Promise<number>;

    /**
     * Zählt aktive (= nicht-gekündigte oder Kündigung noch in der Zukunft)
     * SubscriptionBundle-Einträge, die eine konkrete BundleVersion binden.
     * Bundles werden eigenständig versioniert und vermarktet (analog zu
     * Plänen); der `BundlesService` braucht den Count zur Editierbarkeits-
     * Entscheidung einer published-but-future BundleVersion.
     *
     * Implementierung seit P11.7.3: direkter COUNT auf
     * `subscription_bundles WHERE bundleVersionId = ? AND
     * (canceledAt IS NULL OR canceledEffectiveAt > NOW())`. Apps ohne
     * SubscriptionBundle-Schema (oder ohne Plattform-Migration) können
     * weiterhin 0 liefern; das Editierbarkeits-Feature ist dann nicht
     * mehr fail-closed gegen Buchungen, aber weiterhin latest-in-chain +
     * validFrom-Future.
     *
     * Optional — wenn nicht implementiert, behandelt der Service die
     * Version defensiv als eingefroren (fail-closed).
     */
    countByBundleVersionId?(bundleVersionId: string): Promise<number>;

    /**
     * Zählt aktive Subscriptions (status `ACTIVE` oder `TRIAL`) je Plan-Key,
     * plattformweit über alle Tenants des Projekts — speist die Mandanten-
     * Spalte der SuperAdmin-Plan-Liste (`GET /admin/catalog/plans/tenant-counts`).
     * Versions-übergreifend: zählt den Plan, nicht eine einzelne PlanVersion
     * (Subscriptions auf supersedeten Versionen zählen mit). `projectKey` ist
     * für Single-Project-Konsumenten informativ.
     *
     * Liefert eine Map `planKey → Anzahl`; Pläne ohne aktive Subscription
     * fehlen (UI defaultet auf 0). Plattform-Zählung über alle Tenants →
     * Adapter müssen RLS-exempt zählen.
     *
     * Optional — wenn nicht implementiert, bleibt die Mandanten-Spalte 0.
     */
    countActiveByPlanKey?(projectKey: string): Promise<Record<string, number>>;
}

/**
 * Adapter für `subscription_bundles`-Junction (SPEC_V2 §11.1 M6 Pack 2e).
 * Konsumenten implementieren das gegen ihre Prisma-Tabelle. Schreiben
 * über `add` / `cancel` ist immer Side-Effect der Subscription-Service-
 * Methoden — der Repository ist dumb persistence, keine fachlichen
 * Constraints (Plan-Kompat, Mindestlaufzeit-Default) hier.
 */
export interface SubscriptionBundleRepository {
    /** Alle Bundle-Buchungen einer Subscription, neueste zuerst. */
    listBySubscription(subscriptionId: string): Promise<SubscriptionBundleRecord[]>;
    /** Eine einzelne Buchung (für Cancel-/Detail-Flow). */
    findById(subscriptionBundleId: string): Promise<SubscriptionBundleRecord | null>;
    /**
     * Aktive Buchungen einer Subscription (`canceledAt IS NULL OR
     * canceledEffectiveAt > NOW()`). Wird vom Entitlement-Pfad genutzt.
     */
    listActiveBySubscription(
        subscriptionId: string,
        asOf?: Date,
    ): Promise<SubscriptionBundleRecord[]>;
    add(data: CreateSubscriptionBundleData): Promise<SubscriptionBundleRecord>;
    /**
     * Setzt `canceledAt` + `canceledEffectiveAt`. Wirft auf bereits
     * gekündigten Buchungen — der Service bietet ggf. „Kündigung
     * rückgängig" als separaten Pfad an (nicht in dieser Iter).
     */
    cancel(
        subscriptionBundleId: string,
        data: CancelSubscriptionBundleData,
    ): Promise<SubscriptionBundleRecord>;
    /**
     * „Kündigung rückgängig": setzt `canceledAt` + `canceledEffectiveAt` auf
     * NULL. Nur sinnvoll, solange die Kündigung noch nicht wirksam ist
     * (`canceledEffectiveAt > NOW()`); die Gültigkeitsprüfung macht der Service.
     */
    reactivate(subscriptionBundleId: string): Promise<SubscriptionBundleRecord>;
    /**
     * Zählt aktive Bundle-Buchungen für eine BundleVersion (gleiche
     * Semantik wie `SubscriptionRepository.countByBundleVersionId`, nur
     * direkt am Junction-Adapter). Wird von beiden Repository-
     * Implementierungen geteilt, um Drift zu vermeiden.
     */
    countActiveByBundleVersionId(bundleVersionId: string, asOf?: Date): Promise<number>;
}

/**
 * Append-only Repository für V3 SubscriptionContracts. Contracts sind die
 * vertragsfeste Quelle für Billing und Entitlement; Katalog-FKs sind nur
 * Trace-Daten. Implementierungen dürfen bestehende Contracts nur über
 * `terminate` fachlich schließen, nicht LineItems/Snapshots überschreiben.
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
// Tenant-Billing-Ports (Phase B — UI-/Display-Form für GET /billing/usage)
// -----------------------------------------------------------------------------

/**
 * Display-Form einer Subscription für die Tenant-Self-Service-UI.
 * Reicher als `SubscriptionRecord` (das nur die Aggregation-Form ist), enthält
 * Zusatzfelder wie `billingCycle`, Pilot-/Trial-Datum und vollständige
 * Plan-Version-Metadaten.
 *
 * Plattform-Controller `GET /billing/usage` mappt diese Form 1:1 in den
 * Response-Body. Konsumenten-Adapter lädt aus seiner eigenen Subscription-
 * Tabelle (Prisma include planVersion + pendingPlanVersion).
 */
export interface SubscriptionUsageRecord {
    /**
     * Subscription-Primary-Key. Optional, weil bestehende Adapter die Spalte
     * möglicherweise noch nicht durchreichen — der Plattform-Service nutzt sie
     * nur für nachgelagerte Schritte wie atomares Promo-Redeem im
     * Onboarding-Endpoint. Adapter, die `POST /billing/onboarding/initial-subscription`
     * mit Promo-Code unterstützen wollen, müssen `id` setzen.
     */
    id?: string;
    plan: string;
    billingCycle: string;
    status: string;
    isPilot: boolean;
    pilotEndsAt: Date | null;
    trialEndsAt: Date | null;
    /** Subscription-Start (= Periodenfenster-Anker für `periodEndAfter`). */
    startedAt: Date | null;
    /** Aktuelles Periodenfenster — für Proration und Wechsel-Effektiv-Datum. */
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
        /** Catalog-Diff-Form aus version-publish; freie JSON-Struktur. */
        publishedChanges: unknown;
    } | null;
    pendingPlanVersionEffectiveAt: Date | null;
    pendingPlanVersionAccepted: boolean;
    pendingPlanVersionAcceptedAt: Date | null;
    /**
     * P11.4 (METAMODELL §17a): eingefrorener Paket-Snapshot aus dem
     * `CheckoutOffer`, der beim Onboarding aktiviert wurde. Read-only —
     * dient nur der Anzeige in der Tenant-Self-Service-UI, damit der
     * Tenant weiß, *welches* beworbene Paket konkret gebucht wurde.
     * `null` für Subscriptions, die nicht aus einem CheckoutOffer
     * entstanden sind (Direkt-Anlage, Migration).
     */
    packageSnapshot?: unknown | null;
    /**
     * P11.4: Referenz auf den ursprünglichen `CheckoutOffer.id`. Für die UI
     * meist nicht nötig (Snapshot ist self-contained), aber für Support-
     * Werkzeuge und Audit nützlich.
     */
    checkoutOfferId?: string | null;
}

/**
 * Lese-Adapter für die UI-/Display-Form einer Subscription. Wird von
 * `TenantBillingController.getUsage` benutzt.
 */
export interface SubscriptionUsagePort {
    findForTenant(tenantId: string): Promise<SubscriptionUsageRecord | null>;
}

/**
 * Liefert den aktuellen Verbrauch für alle via `@DefinesQuota` deklarierten
 * quotaKeys eines Tenants (z. B. `{ users: 4, members: 850, storageGb: 1.2 }`).
 * Konsument darf eigene Counter-Strategien verwenden (Prisma-Counts,
 * DMS-Service-Roundtrip, Cached-Storage-Tracker, …) und muss soft-fail-
 * Verhalten selbst entscheiden.
 *
 * Fehlt ein quotaKey im Rückgabe-Objekt, mappt der Plattform-Controller
 * auf `0` — robuste Anzeige, auch wenn ein Counter (noch) nicht implementiert ist.
 */
export interface UsageSnapshotPort {
    snapshot(tenantId: string): Promise<Record<string, number>>;
}

// -----------------------------------------------------------------------------
// Tenant-Billing-Write-Port (Phase C — Plan-Wechsel)
// -----------------------------------------------------------------------------

/** Eingabe für `changePlanImmediate` mit optionalem Periodenfenster-Reset. */
export interface ImmediatePlanChangeInput {
    planId: string;
    cycle: string;
    /** Periodenfenster zurücksetzen (Pro-rata-Wechsel). NULL bei TRIAL. */
    periodStart: Date | null;
    periodEnd: Date | null;
    /** Zielstatus — bei TRIAL wird der Status nicht überschrieben. */
    nextStatus: string | null;
    /**
     * Trial-Carry-over (#17): neues Trial-Ende beim Wechsel WÄHREND des Trials.
     * Vom Plattform-`changePlan`-Pfad aus dem `TrialProjectionPort` berechnet.
     * `undefined`/`null` → Adapter lässt `trialEndsAt` unverändert (kein Trial-
     * Wechsel bzw. Ziel-Paket ohne Trial). Ein `Date` wird persistiert.
     */
    trialEndsAt?: Date | null;
}

/** Eingabe für `schedulePlanChange` (Wechsel zum Periodenende). */
export interface ScheduledPlanChangeInput {
    pendingPlan: string;
    pendingBillingCycle: string;
    pendingEffectiveAt: Date;
}

/**
 * Eingabe für `applyOnboardingSelection`. Plan-Change-Felder, die der
 * Adapter atomar in einer einzigen Transaktion persistiert.
 */
export interface ApplyOnboardingSelectionInput {
    planId: string;
    cycle: string;
    /** Bei TRIAL → null, sonst Periodenstart aus `initialPeriodWindow`. */
    periodStart: Date | null;
    periodEnd: Date | null;
    /** Bei TRIAL → null, sonst typisch `'ACTIVE'`. */
    nextStatus: string | null;
}

/**
 * Ergebnis des atomar-ausgeführten Onboarding-Schritts. Enthält alle
 * Effekte, die der Plattform-Service downstream loggen / responsen kann.
 */
export interface ApplyOnboardingSelectionResult {
    plan: string;
    billingCycle: string;
    subscriptionId: string;
    /** null, wenn kein redeemPromo-Callback geliefert oder der Callback null lieferte. */
    promoRedemption: PromoCodeRedemptionRecord | null;
}

/**
 * Callback-Signatur für die Promo-Code-Einlösung INNERHALB der Onboarding-
 * Transaktion. Plattform-Service injiziert eine Closure, die `PromoCodesService.
 * redeemInTransaction(...)` aufruft; der Adapter ruft sie nach dem
 * Subscription-Update auf, sodass alles in einer DB-Transaktion lebt.
 */
export type RedeemPromoInTransactionCallback = (
    tx: TransactionContext,
    subscriptionId: string,
) => Promise<PromoCodeRedemptionRecord>;

/**
 * Schreibe-Adapter für Tenant-Self-Service-Mutationen
 * (`POST /billing/plan`, `/billing/cancel` etc.).
 *
 * Konsument-Implementation persistiert in seine Subscription-Tabelle.
 * Atomicity liegt im Adapter, weil Transaction-Client-Typen App-spezifisch
 * sind. Plattform-Service ruft `invalidateTenant` im EntitlementService
 * nach erfolgreichem Adapter-Call.
 */
export interface TenantSubscriptionWritePort {
    /** Sofort-Wechsel: Plan + Cycle setzen, Pending-Felder löschen, Periode optional resetten. */
    changePlanImmediate(
        tenantId: string,
        input: ImmediatePlanChangeInput,
    ): Promise<{ plan: string; billingCycle: string }>;

    /** Wechsel zum Periodenende: Pending-Felder setzen. */
    schedulePlanChange(tenantId: string, input: ScheduledPlanChangeInput): Promise<void>;

    /**
     * Markiert die Pending-PlanVersion als akzeptiert. Idempotent — doppelter
     * Accept ist no-op. Liefert `alreadyAccepted: true`, wenn der Status schon
     * gesetzt war.
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
     * Subscription kündigen. `immediate=true` → Status CANCELED ab now;
     * `false` → canceledAt = currentPeriodEnd, Status bleibt erhalten.
     */
    cancelSubscription(
        tenantId: string,
        immediate: boolean,
        now: Date,
    ): Promise<{ canceledAt: Date | null; status: string }>;

    /**
     * Atomare Onboarding-Anlage: setzt Plan + Cycle + Periodenfenster
     * UND ruft optional einen Promo-Redeem-Callback — alles in einer
     * einzigen Konsumenten-Transaktion. Ohne diese Methode fällt der
     * Plattform-Service auf sequenzielle `changePlanImmediate +
     * promoCodes.redeem`-Calls zurück (best-effort,
     * P10.1.1-Übergangslösung).
     *
     * Optional, weil bestehende Adapter die Unterstützung schrittweise
     * nachziehen können — fehlende Implementation ist kein Hard-Error.
     */
    applyOnboardingSelection?(
        tenantId: string,
        input: ApplyOnboardingSelectionInput,
        redeemPromo: RedeemPromoInTransactionCallback | null,
    ): Promise<ApplyOnboardingSelectionResult>;
}

/** Lese-Adapter für PlanVersions. */
export interface PlanVersionRepository {
    /**
     * Aktuell veröffentlichte (= live) PlanVersion eines Plans:
     * `publishedAt IS NOT NULL AND supersededAt IS NULL`. Optional in einer
     * Transaktion.
     *
     * Hinweis: ignoriert `validFrom`/`validUntil`. Für zeit-bewusste
     * Resolution (Onboarding, Plan-Fallback bei TRIAL) `findActive` nutzen.
     */
    findLatestLive(planId: string, tx?: TransactionContext): Promise<PlanVersionRecord | null>;

    /**
     * Zu `asOf` aktive PlanVersion eines Plans:
     *   `publishedAt IS NOT NULL`
     *   `validFrom <= asOf`
     *   `(validUntil IS NULL OR validUntil > asOf)`
     *
     * Wenn mehrere matchen: höchstes `validFrom`. Adapter, die noch keine
     * `validFrom`/`validUntil`-Spalten haben, dürfen das Feld weglassen
     * (Consumer fallen auf `findLatestLive` zurück).
     */
    findActive?(
        planId: string,
        asOf?: Date,
        tx?: TransactionContext,
    ): Promise<PlanVersionRecord | null>;
}
