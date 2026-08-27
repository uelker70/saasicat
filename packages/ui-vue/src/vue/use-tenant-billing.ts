// useTenantBilling — Vue composable for the tenant self-service endpoints
// (`/billing/usage`, `/billing/entitlement`, `/billing/plan/preview`,
// `/billing/plan`, `/billing/subscription-bundles`, `/billing/cancel`).
//
// The consumer supplies the HTTP adapter (axios wrapper with auth header) and
// optionally an `apiPrefix`. **Convention**: `apiPrefix` is the sub-path UNDER
// the app API base URL that the HTTP adapter itself holds. Examples:
//   - HTTP adapter baseURL `/api`        + apiPrefix `/billing` → `/api/billing/...`
//   - HTTP adapter baseURL `/api/v1`     + apiPrefix `/billing` → `/api/v1/billing/...`
// Do **NOT** set `apiPrefix='/api/billing'` when the HTTP adapter already
// has `/api` as its baseURL — the result would be `/api/api/billing/...` (404).

import { ref, type Ref } from 'vue';
import { defaultHttpClient, type HttpClient } from '../client/types.js';
import { trimTrailingSlashes } from '../client/http-json.js';

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
    /** When a cancellation was declared. Null while none was. */
    canceledAt: string | null;
    /**
     * When it lands, and until then nothing changes.
     *
     * A subscription cancelled inside its term keeps running, keeps being
     * billed and keeps its entitlements. Rendering it as "cancelled, gone" is
     * how a tenant loses access they paid for.
     */
    canceledEffectiveAt: string | null;
    /** What cancelling right now would do. A projection, not a state. */
    cancellation: {
        effectiveAt: string;
        termEndsAt: string;
        noticeDeadline: string | null;
        afterNoticeDeadline: boolean;
    };
    limits: {
        plan: string;
        quotas: Record<string, number>;
        features: string[];
    };
    usage: Record<string, number>;
    /**
     * P11.4: Read-only package snapshot from the
     * original CheckoutOffer. `null` for subscriptions without a
     * CheckoutOffer origin. The JSON structure matches the Offer
     * schema; the UI can read `bundleVersionIds`, `currency`,
     * `priceTotal` and more from it.
     */
    packageSnapshot: PackageSnapshotShape | null;
    /** P11.4: Optional reference to the original CheckoutOffer. */
    checkoutOfferId: string | null;
}

/**
 * Self-contained package snapshot (shape of `CheckoutOffer.snapshot`).
 * All fields are optional because the snapshot schema may grow and older
 * subscriptions can carry leaner snapshots. The UI must stay defensive
 * against missing fields.
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
    /**
     * The two answers `changeType` collapses into one.
     *
     * A page needs them apart to explain a deferred upgrade: the plan went up,
     * the period got shorter, and it is the second that decided the date.
     */
    planDirection: 'UP' | 'DOWN' | 'SAME';
    cycleDirection: 'LONGER' | 'SHORTER' | 'SAME';
    current: { plan: PlanSnapshotShape; billingCycle: BillingCycleStr };
    target: { plan: PlanSnapshotShape; billingCycle: BillingCycleStr };
    effectiveAt: string | null;
    isImmediate: boolean;
    /** Projected new trial end (ISO) after the change, otherwise null. */
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
 * Booked catalog bundle (wire shape of `SubscriptionBundleRecord`, dates
 * as ISO strings). Source: `GET /billing/subscription-bundles`. The label/
 * price is joined by the consumer via `bundleVersionId` against the bundle
 * catalog (`GET /billing/bundles`) — the record itself carries only the
 * version reference.
 */
/**
 * A bundle's list price in both rhythms, resolved for one tenant's plan —
 * `null` where no price is maintained for that combination, which the booking
 * refuses with `BUNDLE_NOT_PRICED_FOR_THIS_PLAN`.
 */
export interface ResolvedBundlePrice {
    monthlyNet: number | null;
    yearlyNet: number | null;
}

export interface SubscriptionBundleShape {
    id: string;
    subscriptionId: string;
    bundleVersionId: string;
    /** Denormalized (server-side from the booked bundleVersion): label/
     *  key/price, so that booked bundles can be shown without a catalog join. */
    bundleKey?: string | null;
    label?: string | null;
    /**
     * What this booking is billed at: the price for the rhythm it was booked
     * in, with the plan's pricing override applied.
     *
     * It was `monthlyNet` and always carried the bundle's base monthly figure,
     * so a yearly booking reported a number nobody is charged.
     */
    priceNet?: number | null;
    /**
     * The rhythm this booking is billed in, which need not be the plan's: a
     * yearly plan may carry monthly add-ons.
     *
     * Optional because an adapter predating the column answers without it; a
     * reader without an answer falls back to the plan's rhythm, which is what
     * the booking would have taken by default.
     */
    billingCycle?: string | null;
    startedAt: string;
    minimumTermEndsAt: string | null;
    canceledAt: string | null;
    canceledEffectiveAt: string | null;
}

/**
 * What a cancellation answers with.
 *
 * `canceledAt` is when it was declared, `canceledEffectiveAt` when it lands —
 * and a page has to show the second, because a subscription cancelled inside
 * its term keeps running, keeps being billed and keeps its entitlements until
 * then. Rendering it as "cancelled, gone" is how a tenant loses access they
 * paid for.
 *
 * The three below it explain the date rather than merely stating it, which
 * matters where an installation has configured a notice period: a declaration
 * four days late lands a whole period further out, and that is the sentence a
 * customer disputes if they read it afterwards instead of before.
 */
export interface CancellationResultShape {
    /** True when the subscription was already cancelled and nothing changed. */
    alreadyCanceled?: boolean;
    canceledAt: string | null;
    canceledEffectiveAt: string | null;
    status: string;
    /**
     * The term end the effective date was measured against, and whether the
     * notice window had closed.
     *
     * Both are null on a repeat: the decision was taken once and is not stored,
     * so recomputing it from the effective date would report a late declaration
     * as on time. The date it lands on is `canceledEffectiveAt` and is always
     * there.
     */
    termEndsAt: string | null;
    /** The moment after which a cancellation lands one period later, if any. */
    noticeDeadline: string | null;
    /** True when the declaration arrived after that moment. */
    afterNoticeDeadline: boolean | null;
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

/** AK-13: Feature is already paid for elsewhere — double-payment hint. */
export interface RedundantFeatureHintShape {
    featureKey: string;
    coveredBy: 'PLAN' | 'BUNDLE';
    coveredByKey: string;
}

/**
 * Wire shape of `SubscriptionBundleAddPreviewDto` (#37,
 * `POST /billing/subscription-bundles/preview` with `bundleVersionId`).
 * `proration` is `null` during TRIAL or without a maintained list price.
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
    /**
     * End of the first billing period — on the plan's billing day, so usually
     * shorter than a full cycle and charged pro rata for that stretch. Null
     * where the plan has no period to align to.
     */
    firstPeriodEnd: string | null;
    /**
     * The day the plan takes the bundle down with it, or null while the plan
     * runs on. Not a cancellation, and the period it happens in is not
     * credited — which is what the alignment exists to make rare.
     */
    endsWithPlanAt: string | null;
    redundantFeatures: RedundantFeatureHintShape[];
    missingRequires: string[];
    blockers: BundlePreviewIssueShape[];
    warnings: BundlePreviewIssueShape[];
}

/**
 * Wire shape of `SubscriptionBundleCancelPreviewDto` (#37, preview with
 * `subscriptionBundleId`). `effectiveAt` = max(period end, minimum term).
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
     * Default `'/billing'`. The app HTTP adapter sets the API base URL
     * (e.g. `/api` or `/api/v1`); `apiPrefix` is
     * the sub-path below it. A doubled `/api` prefix leads to HTTP 404.
     */
    apiPrefix?: string;
    http?: HttpClient;
    /** Default `true`. */
    autoLoad?: boolean;
}

/**
 * What a caller may decide about a booking, beyond which bundle it is.
 *
 * An object rather than two more positional parameters, and both halves matter
 * to a tenant: `billingCycle` is the rhythm the bundle is billed in, and
 * leaving it out means the plan's. A monthly bundle beside a yearly plan is the
 * case it exists for — the platform has accepted it since bundles gained a
 * rhythm of their own, and until this was plumbed through, no shipped client
 * could ask for it, so a monthly-only bundle simply read as unpriced to every
 * tenant on a yearly plan.
 */
export interface BundleBookingOptions {
    /** Months of commitment. `0` = none. Omitted = the platform default. */
    minimumTermMonths?: number;
    /** The bundle's own rhythm. Omitted = the plan's. Never longer than it. */
    billingCycle?: BillingCycleStr;
}

/** The request body both the preview and the booking send. */
function bundleBookingBody(
    bundleVersionId: string,
    options: BundleBookingOptions,
): Record<string, unknown> {
    const body: Record<string, unknown> = { bundleVersionId };
    // Omitted rather than sent as undefined: the route reads an absent field as
    // "the platform decides", and `JSON.stringify` would drop it anyway — but
    // only by accident, and an accident is not a contract.
    if (options.minimumTermMonths !== undefined) {
        body.minimumTermMonths = options.minimumTermMonths;
    }
    if (options.billingCycle !== undefined) body.billingCycle = options.billingCycle;
    return body;
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
    changePlan: (plan: string, billingCycle: BillingCycleStr) => Promise<void>;
    acceptPendingPlanVersion: () => Promise<void>;
    /**
     * Declares a cancellation. Takes no argument, and that is the point.
     *
     * It used to take `immediately`, which the platform honoured — and a tenant
     * could end a term they were still inside. When a cancellation lands is now
     * decided from the minimum term and the configured notice period, so there
     * is nothing here to pass. Ending a contract on the spot is an operator's
     * act and goes through the operator's own path.
     */
    cancelSubscription: (expectedEffectiveAt?: string) => Promise<CancellationResultShape>;
    /** True if `usage.value.features` contains the FeatureKey. */
    hasFeature: (key: string) => boolean;

    /**
     * The tenant's booked catalog bundles (`/billing/subscription-bundles`).
     * Loaded along with `reload()`. If the endpoint is missing (consumer
     * without `SubscriptionBundleModule`), the list stays empty without
     * setting the main `error` — the page degrades gracefully.
     */
    subscriptionBundles: Ref<SubscriptionBundleShape[]>;
    /**
     * List prices for the given bundle versions, resolved for this tenant's
     * plan. Returns `{}` where the endpoint is absent, so a consumer without it
     * keeps the public catalogue's own figures.
     */
    loadBundlePrices(bundleVersionIds: string[]): Promise<Record<string, ResolvedBundlePrice>>;
    /** Reloads only the booked bundles (non-fatal). */
    loadBundles: () => Promise<void>;
    /** Books a bundle via `bundleVersionId` + reloads the list. */
    addBundle: (bundleVersionId: string, options?: BundleBookingOptions) => Promise<void>;
    /** Cancels a booked bundle via SubscriptionBundle PK + reloads. */
    cancelBundle: (subscriptionBundleId: string) => Promise<void>;
    /** Reverses a cancellation that has not yet taken effect + reloads. */
    reactivateBundle: (subscriptionBundleId: string) => Promise<void>;
    /**
     * Add preview (#37): proration, next-period price, redundancy hint,
     * requires check and blockers — show BEFORE booking.
     */
    previewAddBundle: (
        bundleVersionId: string,
        options?: BundleBookingOptions,
    ) => Promise<BundleAddPreviewShape>;
    /** Cancel preview (#37): effective date + savings from the next period on. */
    previewCancelBundle: (subscriptionBundleId: string) => Promise<BundleCancelPreviewShape>;
}

export function useTenantBilling(options: UseTenantBillingOptions = {}): UseTenantBillingResult {
    const apiPrefix = trimTrailingSlashes(options.apiPrefix ?? '/billing');
    const http = options.http ?? defaultHttpClient();

    const usage = ref<UsageSnapshotShape | null>(null);
    const loading = ref(false);
    const error = ref<Error | null>(null);
    const subscriptionBundles = ref<SubscriptionBundleShape[]>([]);

    function authHeaders(): Record<string, string> {
        const headers: Record<string, string> = {};
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
            // Wrapper error with status — the caller (UI) decides whether specific
            // codes (402 Payment Required, 403 Feature Locked) get special handling.
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
        // Reload bundles non-fatally — a missing/4xx endpoint must not tip the
        // plan page into an error state.
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

    /**
     * List prices for the bundles a store is about to show, resolved for this
     * tenant's plan.
     *
     * The public catalogue serves base prices and has no plan to resolve a
     * `BundlePricingOverride` against, so a bundle priced only through an
     * override reads there as having no price at all. Non-fatal: a consumer
     * without the endpoint keeps the catalogue's own figures, which is what
     * every consumer had before.
     */
    async function loadBundlePrices(
        bundleVersionIds: string[],
    ): Promise<Record<string, ResolvedBundlePrice>> {
        if (bundleVersionIds.length === 0) return {};
        try {
            return (
                (await fetchOrThrow<Record<string, ResolvedBundlePrice>>(
                    '/subscription-bundles/prices',
                    { method: 'POST', body: { bundleVersionIds } },
                )) ?? {}
            );
        } catch {
            return {};
        }
    }

    async function addBundle(bundleVersionId: string, options: BundleBookingOptions = {}) {
        await fetchOrThrow('/subscription-bundles', {
            method: 'POST',
            body: bundleBookingBody(bundleVersionId, options),
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
        options: BundleBookingOptions = {},
    ): Promise<BundleAddPreviewShape> {
        return fetchOrThrow<BundleAddPreviewShape>('/subscription-bundles/preview', {
            method: 'POST',
            body: bundleBookingBody(bundleVersionId, options),
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

    async function changePlan(plan: string, billingCycle: BillingCycleStr) {
        // No timing in the body. The server decides when a change lands from
        // the plan direction, the cycle direction and the minimum term — none
        // of which a browser can see, and all of which it used to be trusted to
        // report back. A caller that sent `effectiveImmediately: true` could
        // end a term it was inside.
        await fetchOrThrow('/plan', { method: 'POST', body: { plan, billingCycle } });
        await reload();
    }

    async function acceptPendingPlanVersion() {
        await fetchOrThrow('/subscription/accept-pending-version', { method: 'POST' });
        await reload();
    }

    async function cancelSubscription(
        expectedEffectiveAt?: string,
    ): Promise<CancellationResultShape> {
        // The date the page showed, sent back for the server to check. It
        // refuses with `CANCELLATION_TERMS_CHANGED` if its own answer differs —
        // a dialog opened before a notice deadline and confirmed after it would
        // otherwise deliver a date a year past the one on the button.
        const result = await fetchOrThrow<CancellationResultShape>('/cancel', {
            method: 'POST',
            body: expectedEffectiveAt ? { expectedEffectiveAt } : undefined,
        });
        await reload();
        return result;
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
        loadBundlePrices,
        cancelBundle,
        reactivateBundle,
        previewAddBundle,
        previewCancelBundle,
    };
}
