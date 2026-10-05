// useTenantSubscriptionBundles — Vue 3 composable for the tenant self-service
// page "Meine Bundles" (P11.7.3). Talks to the platform endpoint
// `/billing/subscription-bundles` (mounted by
// `SubscriptionBundleModule.forRoot({ controller: {...} })`).

import { ref, type Ref } from 'vue';
import { markEmptyResponse, markPlatformError } from '../client/admin-error.js';
import type {
    BundleRetirementSwitchResult,
    BundleVersionOfferView,
    BundleVersionRetiredNotice,
    BundleRetirementSwitchTerms,
    BundleVersionSwitchResult,
    SubscriptionBundleRecord,
} from '@saasicat/core';
import { requireServerAnswer } from '../client/http-json.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseTenantSubscriptionBundlesOptions {
    /** App-global API prefix incl. `/billing` (e.g. `/api/v1`). */
    billingEndpoint: string;
    http?: HttpClient;
    /** With `true`, loads on mount. Default `false`. */
    autoLoad?: boolean;
}

/**
 * A booking as the tenant's list answers it: the record, the retirement of the
 * version booked as the subscriber was told it, where one stands, what
 * switching to its replacement now would cost, where the booking may, and a
 * newer version offered beside it, where there is one it could take. A
 * platform without add-on retirements answers without the first two, and one
 * that does not read bookings in tenant billing without the third.
 */
export type TenantSubscriptionBundle = SubscriptionBundleRecord & {
    readonly retirement?: BundleVersionRetiredNotice | null;
    readonly retirementSwitch?: BundleRetirementSwitchTerms | null;
    readonly offer?: BundleVersionOfferView | null;
    /** The number of the version a switch scheduled for the end of its term moves it to. */
    readonly pendingVersion?: number | null;
};

export interface UseTenantSubscriptionBundlesResult {
    bundles: Ref<TenantSubscriptionBundle[]>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;

    load: () => Promise<void>;
    add: (data: {
        bundleVersionId: string;
        minimumTermMonths?: number;
        /**
         * The bundle's own rhythm. Omitted = the plan's, and never longer than
         * it. A monthly bundle beside a yearly plan is what this is for.
         */
        billingCycle?: 'MONTHLY' | 'YEARLY';
    }) => Promise<SubscriptionBundleRecord>;
    cancel: (
        subscriptionBundleId: string,
        opts?: { canceledAt?: string },
    ) => Promise<SubscriptionBundleRecord>;
    /**
     * Switches the booking to the replacement its retirement names —
     * `bundleVersionId`, the version the page showed — before the date, and
     * reloads. Refused with `RETIREMENT_SWITCH_CHANGED` when that is no longer
     * the replacement; the refusal carries the retirement as it stands.
     */
    switchToReplacement: (
        subscriptionBundleId: string,
        bundleVersionId: string,
    ) => Promise<BundleRetirementSwitchResult>;
    /**
     * Takes the newer version offered beside the booking — `bundleVersionId`,
     * the version the page showed — and reloads. Refused with
     * `BUNDLE_VERSION_OFFER_CHANGED` when that is no longer the version
     * offered; the refusal carries the offer as it stands.
     */
    acceptVersionOffer: (
        subscriptionBundleId: string,
        bundleVersionId: string,
    ) => Promise<BundleVersionSwitchResult>;
}

export class TenantSubscriptionBundlesApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        message: string,
    ) {
        super(message);
        this.name = 'TenantSubscriptionBundlesApiError';
        // Identity, so `toAdminError` can tell this diagnostic from a
        // consumer error whose message an operator needs to read.
        markPlatformError(this);
    }
}

export function useTenantSubscriptionBundles(
    options: UseTenantSubscriptionBundlesOptions,
): UseTenantSubscriptionBundlesResult {
    if (!options?.billingEndpoint) {
        throw new Error(
            'useTenantSubscriptionBundles: `billingEndpoint` is required (e.g. "/api/v1").',
        );
    }
    const http = options.http ?? defaultHttpClient();
    const baseUrl = `${options.billingEndpoint}/billing/subscription-bundles`;

    const bundles = ref<TenantSubscriptionBundle[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    function authHeaders(): Record<string, string> {
        return {};
    }

    async function fetchJson<T>(url: string, init?: Parameters<HttpClient>[1]): Promise<T | null> {
        const method = init?.method ?? 'GET';
        const res = await http(url, {
            method,
            headers: { 'content-type': 'application/json', ...authHeaders(), ...init?.headers },
            body: init?.body,
        });
        // Before any body is read: `null` below has to mean "the server
        // answered without one", which is what the callers' empty-response
        // sentinels claim.
        requireServerAnswer(
            res.status,
            method,
            url,
            (diagnostic) => new TenantSubscriptionBundlesApiError(res.status, null, diagnostic),
        );
        if (res.status === 204) return null;
        const body = await res.json().catch(() => null);
        if (res.status >= 400) {
            throw new TenantSubscriptionBundlesApiError(
                res.status,
                body,
                `SubscriptionBundle API responded with HTTP ${res.status}`,
            );
        }
        return body as T;
    }

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchJson<TenantSubscriptionBundle[]>(baseUrl);
            bundles.value = (data ?? []).map(rehydrateDates);
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function add(data: {
        bundleVersionId: string;
        minimumTermMonths?: number;
        billingCycle?: 'MONTHLY' | 'YEARLY';
    }): Promise<SubscriptionBundleRecord> {
        const result = await fetchJson<SubscriptionBundleRecord>(baseUrl, {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!result) {
            throw markEmptyResponse(
                new TenantSubscriptionBundlesApiError(0, null, 'add returned no body'),
            );
        }
        const hydrated = rehydrateDates(result);
        bundles.value = [hydrated, ...bundles.value];
        return hydrated;
    }

    async function cancel(
        subscriptionBundleId: string,
        opts: { canceledAt?: string } = {},
    ): Promise<SubscriptionBundleRecord> {
        const result = await fetchJson<SubscriptionBundleRecord>(
            `${baseUrl}/${subscriptionBundleId}`,
            { method: 'DELETE', body: JSON.stringify(opts) },
        );
        if (!result) {
            throw markEmptyResponse(
                new TenantSubscriptionBundlesApiError(0, null, 'cancel returned no body'),
            );
        }
        const hydrated = rehydrateDates(result);
        bundles.value = bundles.value.map((b) => (b.id === subscriptionBundleId ? hydrated : b));
        return hydrated;
    }

    async function switchToReplacement(
        subscriptionBundleId: string,
        bundleVersionId: string,
    ): Promise<BundleRetirementSwitchResult> {
        const result = await fetchJson<BundleRetirementSwitchResult>(
            `${baseUrl}/${subscriptionBundleId}/retirement/switch`,
            { method: 'POST', body: JSON.stringify({ bundleVersionId }) },
        );
        if (!result) {
            throw markEmptyResponse(
                new TenantSubscriptionBundlesApiError(0, null, 'switch returned no body'),
            );
        }
        // The booking is on another version now, with another price beside it.
        await load();
        return result;
    }

    async function acceptVersionOffer(
        subscriptionBundleId: string,
        bundleVersionId: string,
    ): Promise<BundleVersionSwitchResult> {
        const result = await fetchJson<BundleVersionSwitchResult>(
            `${baseUrl}/${subscriptionBundleId}/version-offer/accept`,
            { method: 'POST', body: JSON.stringify({ bundleVersionId }) },
        );
        if (!result) {
            throw markEmptyResponse(
                new TenantSubscriptionBundlesApiError(0, null, 'accept returned no body'),
            );
        }
        // At once, the booking is on another version with another price; for
        // the end of its term, it carries the switch scheduled.
        await load();
        return result;
    }

    if (options.autoLoad) void load();

    return {
        bundles,
        loading,
        error,
        load,
        add,
        cancel,
        switchToReplacement,
        acceptVersionOffer,
    };
}

/**
 * The wire format returns an ISO string per date field; the platform type is
 * `Date`. We map once at the HTTP boundary.
 */
function rehydrateDates(raw: TenantSubscriptionBundle): TenantSubscriptionBundle {
    return {
        ...raw,
        startedAt: new Date(raw.startedAt),
        minimumTermEndsAt: raw.minimumTermEndsAt ? new Date(raw.minimumTermEndsAt) : null,
        canceledAt: raw.canceledAt ? new Date(raw.canceledAt) : null,
        canceledEffectiveAt: raw.canceledEffectiveAt ? new Date(raw.canceledEffectiveAt) : null,
        currentPeriodStart: raw.currentPeriodStart ? new Date(raw.currentPeriodStart) : null,
        currentPeriodEnd: raw.currentPeriodEnd ? new Date(raw.currentPeriodEnd) : null,
        pendingBundleVersionId: raw.pendingBundleVersionId ?? null,
        pendingVersionEffectiveAt: raw.pendingVersionEffectiveAt
            ? new Date(raw.pendingVersionEffectiveAt)
            : null,
        createdAt: new Date(raw.createdAt),
        updatedAt: new Date(raw.updatedAt),
    };
}
