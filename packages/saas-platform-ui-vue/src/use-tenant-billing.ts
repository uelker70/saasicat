// useTenantBilling — Vue-Composable für die Tenant-Self-Service-Endpunkte
// (`/billing/usage`, `/billing/entitlement`, `/billing/plan/preview`,
// `/billing/plan`, `/billing/subscription-bundles`, `/billing/cancel`).
//
// Konsument liefert HTTP-Adapter (axios-Wrapper mit Auth-Header) und
// optional `apiPrefix`. **Konvention**: `apiPrefix` ist der Sub-Pfad UNTER
// der App-API-Base-URL, die der HTTP-Adapter selbst hält. Beispiele:
//   - HTTP-Adapter baseURL `/api`        + apiPrefix `/billing` → `/api/billing/...`
//   - HTTP-Adapter baseURL `/api/v1`     + apiPrefix `/billing` → `/api/v1/billing/...`
// **NICHT** `apiPrefix='/api/billing'` setzen, wenn der HTTP-Adapter bereits
// `/api` als baseURL hat — das Resultat wäre `/api/api/billing/...` (404).

import { ref, type Ref } from 'vue';
import { defaultHttpClient, type HttpClient } from './types.js';

export type BillingCycleStr = 'MONTHLY' | 'YEARLY';

export interface UsageSnapshotShape {
    plan: string;
    effectivePlan: string;
    billingCycle: BillingCycleStr;
    status: string;
    isPilot: boolean;
    pilotEndsAt: string | null;
    trialEndsAt: string | null;
    startedAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    pendingPlan: string | null;
    pendingBillingCycle: BillingCycleStr | null;
    pendingEffectiveAt: string | null;
    planVersion: {
        id: string;
        planId: string;
        version: number;
        publishedAt: string | null;
        supersededAt: string | null;
        changeNote: string | null;
    };
    pendingPlanVersion: {
        id: string;
        planId: string;
        version: number;
        nonRegressive: boolean;
        changeNote: string | null;
        publishedChanges: unknown;
    } | null;
    pendingPlanVersionEffectiveAt: string | null;
    pendingPlanVersionAccepted: boolean;
    pendingPlanVersionAcceptedAt: string | null;
    limits: {
        plan: string;
        quotas: Record<string, number>;
        features: string[];
    };
    usage: Record<string, number>;
    /**
     * P11.4 (METAMODELL §17a): Read-only Paket-Snapshot aus dem
     * ursprünglichen CheckoutOffer. `null` für Subscriptions ohne
     * CheckoutOffer-Herkunft. JSON-Struktur entspricht dem Offer-
     * Schema; UI kann u. a. `bundleVersionIds`, `currency`,
     * `priceTotal` daraus lesen.
     */
    packageSnapshot: PackageSnapshotShape | null;
    /** P11.4: Optionaler Verweis auf den ursprünglichen CheckoutOffer. */
    checkoutOfferId: string | null;
}

/**
 * Self-contained Paket-Snapshot (Form von `CheckoutOffer.snapshot`).
 * Felder sind alle optional, weil das Snapshot-Schema sich erweitern darf
 * und ältere Subscriptions schmälere Snapshots haben können. Die UI muss
 * defensive gegen fehlende Felder bleiben.
 */
export interface PackageSnapshotShape {
    planId?: string;
    planVersionId?: string;
    billingCycle?: BillingCycleStr;
    bundleVersionIds?: string[];
    currency?: string;
    priceMonthlyNet?: number | null;
    priceYearlyNet?: number | null;
    priceTotalNet?: number | null;
    label?: string;
    capturedAt?: string;
    [key: string]: unknown;
}

export interface PlanChangePreviewShape {
    changeType: 'UPGRADE' | 'DOWNGRADE' | 'CYCLE_CHANGE' | 'NOOP';
    current: { plan: PlanSnapshotShape; billingCycle: BillingCycleStr };
    target: { plan: PlanSnapshotShape; billingCycle: BillingCycleStr };
    effectiveAt: string | null;
    isImmediate: boolean;
    /** Projiziertes neues Trial-Ende (ISO) nach dem Wechsel, sonst null. */
    projectedTrialEndsAt: string | null;
    proration: {
        daysRemainingInPeriod: number;
        daysInPeriod: number;
        periodStart: string;
        periodEnd: string;
        currentPriceNet: number;
        targetPriceNet: number;
        prorataDeltaNet: number;
    } | null;
    limitsCheck: Record<
        string,
        {
            used: number;
            currentMax: number;
            targetMax: number;
            exceeded: boolean;
        }
    >;
    featuresLost: string[];
    featuresGained: string[];
    blockers: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
}

export interface PlanSnapshotShape {
    id: string;
    name: string;
    monthlyNet: number | null;
    yearlyNet: number | null;
    quotas: Record<string, number>;
    features: string[];
}

/**
 * Gebuchtes Catalog-Bundle (Wire-Form von `SubscriptionBundleRecord`, Daten
 * als ISO-Strings). Quelle: `GET /billing/subscription-bundles`. Das Label/
 * der Preis wird vom Konsumenten über `bundleVersionId` gegen den Bundle-
 * Katalog (`GET /billing/bundles`) gejoint — der Record selbst trägt nur die
 * Version-Referenz.
 */
export interface SubscriptionBundleShape {
    id: string;
    subscriptionId: string;
    bundleVersionId: string;
    /** Denormalisiert (server-seitig aus der gebuchten bundleVersion): Label/
     *  Key/Preis, damit gebuchte Bundles ohne Katalog-Join angezeigt werden. */
    bundleKey?: string | null;
    label?: string | null;
    monthlyNet?: string | null;
    startedAt: string;
    minimumTermEndsAt: string | null;
    canceledAt: string | null;
    canceledEffectiveAt: string | null;
}

export interface BundlePreviewIssueShape {
    code: string;
    message: string;
}

export interface BundlePreviewSnapshotShape {
    bundleKey: string;
    label: string;
    bundleVersionId: string;
    features: string[];
    quotas: Record<string, number>;
}

/** AK-13: Feature ist bereits anderweitig bezahlt — Doppelbezahlungs-Hinweis. */
export interface RedundantFeatureHintShape {
    featureKey: string;
    coveredBy: 'PLAN' | 'BUNDLE';
    coveredByKey: string;
}

/**
 * Wire-Form von `SubscriptionBundleAddPreviewDto` (#37,
 * `POST /billing/subscription-bundles/preview` mit `bundleVersionId`).
 * `proration` ist `null` im TRIAL oder ohne gepflegten Listenpreis.
 */
export interface BundleAddPreviewShape {
    action: 'add';
    bundle: BundlePreviewSnapshotShape;
    billingCycle: string;
    proration: {
        daysRemainingInPeriod: number;
        daysInPeriod: number;
        periodStart: string;
        periodEnd: string;
        currentPriceNet: number;
        targetPriceNet: number;
        prorataDeltaNet: number;
    } | null;
    nextPeriodPriceNet: number | null;
    minimumTermMonths: number;
    minimumTermEndsAt: string | null;
    redundantFeatures: RedundantFeatureHintShape[];
    missingRequires: string[];
    blockers: BundlePreviewIssueShape[];
    warnings: BundlePreviewIssueShape[];
}

/**
 * Wire-Form von `SubscriptionBundleCancelPreviewDto` (#37, Preview mit
 * `subscriptionBundleId`). `effectiveAt` = max(Periodenende, Mindestlaufzeit).
 */
export interface BundleCancelPreviewShape {
    action: 'cancel';
    subscriptionBundleId: string;
    bundle: BundlePreviewSnapshotShape;
    billingCycle: string;
    effectiveAt: string;
    nextPeriodSavingsNet: number | null;
    blockers: BundlePreviewIssueShape[];
    warnings: BundlePreviewIssueShape[];
}

export type BundlePreviewShape = BundleAddPreviewShape | BundleCancelPreviewShape;

export interface UseTenantBillingOptions {
    /**
     * Default `'/billing'`. Der App-HTTP-Adapter setzt die API-Base-URL
     * (z. B. `/api` oder `/api/v1`); `apiPrefix` ist
     * der Sub-Pfad darunter. Doppelter `/api`-Prefix führt zu HTTP 404.
     */
    apiPrefix?: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /** Default `true`. */
    autoLoad?: boolean;
}

export interface UseTenantBillingResult {
    usage: Ref<UsageSnapshotShape | null>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    reload: () => Promise<void>;
    previewPlanChange: (
        plan: string,
        billingCycle: BillingCycleStr,
    ) => Promise<PlanChangePreviewShape>;
    changePlan: (
        plan: string,
        billingCycle: BillingCycleStr,
        effectiveImmediately: boolean,
    ) => Promise<void>;
    acceptPendingPlanVersion: () => Promise<void>;
    cancelSubscription: (immediately: boolean) => Promise<void>;
    /** True wenn `usage.value.features` den FeatureKey enthält. */
    hasFeature: (key: string) => boolean;

    /**
     * Gebuchte Catalog-Bundles des Tenants (`/billing/subscription-bundles`).
     * Wird beim `reload()` mitgeladen. Fehlt der Endpoint (Konsument ohne
     * `SubscriptionBundleModule`), bleibt die Liste leer ohne den Haupt-
     * `error` zu setzen — die Seite degradiert sauber.
     */
    subscriptionBundles: Ref<SubscriptionBundleShape[]>;
    /** Lädt nur die gebuchten Bundles neu (non-fatal). */
    loadBundles: () => Promise<void>;
    /** Bucht ein Bundle per `bundleVersionId` + lädt die Liste neu. */
    addBundle: (bundleVersionId: string, minimumTermMonths?: number) => Promise<void>;
    /** Kündigt ein gebuchtes Bundle per SubscriptionBundle-PK + lädt neu. */
    cancelBundle: (subscriptionBundleId: string) => Promise<void>;
    /** Macht eine (noch nicht wirksame) Kündigung rückgängig + lädt neu. */
    reactivateBundle: (subscriptionBundleId: string) => Promise<void>;
    /**
     * Add-Preview (#37): Proration, Folgeperioden-Preis, Redundanz-Hinweis,
     * requires-Check und Blocker — VOR der Buchung anzeigen.
     */
    previewAddBundle: (
        bundleVersionId: string,
        minimumTermMonths?: number,
    ) => Promise<BundleAddPreviewShape>;
    /** Cancel-Preview (#37): Wirksamkeits-Datum + Ersparnis ab Folgeperiode. */
    previewCancelBundle: (subscriptionBundleId: string) => Promise<BundleCancelPreviewShape>;
}

export function useTenantBilling(options: UseTenantBillingOptions = {}): UseTenantBillingResult {
    const apiPrefix = (options.apiPrefix ?? '/billing').replace(/\/+$/, '');
    const http = options.http ?? defaultHttpClient();

    const usage = ref<UsageSnapshotShape | null>(null);
    const loading = ref(false);
    const error = ref<Error | null>(null);
    const subscriptionBundles = ref<SubscriptionBundleShape[]>([]);

    function authHeaders(): Record<string, string> {
        const headers: Record<string, string> = {};
        const token = options.getAuthToken?.();
        if (token) headers.Authorization = `Bearer ${token}`;
        return headers;
    }

    async function fetchOrThrow<T>(
        path: string,
        init?: { method?: string; body?: unknown },
    ): Promise<T> {
        const res = await http(`${apiPrefix}${path}`, {
            method: init?.method ?? 'GET',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
        if (res.status >= 400) {
            // Wrapper-Error mit Status — Caller (UI) entscheidet, ob spezifische
            // Codes (402 Payment Required, 403 Feature Locked) sonderbehandelt werden.
            let body: unknown;
            try {
                body = await res.json();
            } catch {
                body = await res.text();
            }
            const err = new Error(
                `${apiPrefix}${path} → HTTP ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
            ) as Error & { status?: number; body?: unknown };
            err.status = res.status;
            err.body = body;
            throw err;
        }
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
    }

    async function reload() {
        loading.value = true;
        error.value = null;
        try {
            usage.value = await fetchOrThrow<UsageSnapshotShape>('/usage');
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
            usage.value = null;
        } finally {
            loading.value = false;
        }
        // Bundles non-fatal nachladen — ein fehlender/4xx Endpoint darf die
        // Plan-Seite nicht in den Fehlerzustand kippen.
        await loadBundles();
    }

    async function loadBundles() {
        try {
            subscriptionBundles.value =
                (await fetchOrThrow<SubscriptionBundleShape[]>('/subscription-bundles')) ?? [];
        } catch {
            subscriptionBundles.value = [];
        }
    }

    async function addBundle(bundleVersionId: string, minimumTermMonths?: number) {
        await fetchOrThrow('/subscription-bundles', {
            method: 'POST',
            body:
                minimumTermMonths !== undefined
                    ? { bundleVersionId, minimumTermMonths }
                    : { bundleVersionId },
        });
        await loadBundles();
    }

    async function cancelBundle(subscriptionBundleId: string) {
        await fetchOrThrow(`/subscription-bundles/${subscriptionBundleId}`, {
            method: 'DELETE',
            body: {},
        });
        await loadBundles();
    }

    async function reactivateBundle(subscriptionBundleId: string) {
        await fetchOrThrow(`/subscription-bundles/${subscriptionBundleId}/reactivate`, {
            method: 'POST',
            body: {},
        });
        await loadBundles();
    }

    async function previewAddBundle(
        bundleVersionId: string,
        minimumTermMonths?: number,
    ): Promise<BundleAddPreviewShape> {
        return fetchOrThrow<BundleAddPreviewShape>('/subscription-bundles/preview', {
            method: 'POST',
            body:
                minimumTermMonths !== undefined
                    ? { bundleVersionId, minimumTermMonths }
                    : { bundleVersionId },
        });
    }

    async function previewCancelBundle(
        subscriptionBundleId: string,
    ): Promise<BundleCancelPreviewShape> {
        return fetchOrThrow<BundleCancelPreviewShape>('/subscription-bundles/preview', {
            method: 'POST',
            body: { subscriptionBundleId },
        });
    }

    async function previewPlanChange(plan: string, billingCycle: BillingCycleStr) {
        return fetchOrThrow<PlanChangePreviewShape>('/plan/preview', {
            method: 'POST',
            body: { plan, billingCycle },
        });
    }

    async function changePlan(
        plan: string,
        billingCycle: BillingCycleStr,
        effectiveImmediately: boolean,
    ) {
        await fetchOrThrow('/plan', {
            method: 'POST',
            body: { plan, billingCycle, effectiveImmediately },
        });
        await reload();
    }

    async function acceptPendingPlanVersion() {
        await fetchOrThrow('/subscription/accept-pending-version', { method: 'POST' });
        await reload();
    }

    async function cancelSubscription(immediately: boolean) {
        await fetchOrThrow('/cancel', {
            method: 'POST',
            body: { immediately },
        });
        await reload();
    }

    function hasFeature(key: string): boolean {
        return usage.value?.limits.features.includes(key) ?? false;
    }

    if (options.autoLoad !== false) {
        Promise.resolve().then(() => void reload());
    }

    return {
        usage,
        loading,
        error,
        reload,
        previewPlanChange,
        changePlan,
        acceptPendingPlanVersion,
        cancelSubscription,
        hasFeature,
        subscriptionBundles,
        loadBundles,
        addBundle,
        cancelBundle,
        reactivateBundle,
        previewAddBundle,
        previewCancelBundle,
    };
}
