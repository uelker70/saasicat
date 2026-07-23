// useTenantSubscriptionBundles — Vue 3 composable for the tenant self-service
// page "Meine Bundles" (P11.7.3). Talks to the platform endpoint
// `/billing/subscription-bundles` (mounted by
// `SubscriptionBundleModule.forRoot({ controller: {...} })`).

import { ref, type Ref } from 'vue';
import type { SubscriptionBundleRecord } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseTenantSubscriptionBundlesOptions {
    /** App-global API prefix incl. `/billing` (e.g. `/api/v1`). */
    billingEndpoint: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /** With `true`, loads on mount. Default `false`. */
    autoLoad?: boolean;
}

export interface UseTenantSubscriptionBundlesResult {
    bundles: Ref<SubscriptionBundleRecord[]>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;

    load: () => Promise<void>;
    add: (data: {
        bundleVersionId: string;
        minimumTermMonths?: number;
    }) => Promise<SubscriptionBundleRecord>;
    cancel: (
        subscriptionBundleId: string,
        opts?: { canceledAt?: string },
    ) => Promise<SubscriptionBundleRecord>;
}

export class TenantSubscriptionBundlesApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        message: string,
    ) {
        super(message);
        this.name = 'TenantSubscriptionBundlesApiError';
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

    const bundles = ref<SubscriptionBundleRecord[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    function authHeaders(): Record<string, string> {
        const token = options.getAuthToken?.();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function fetchJson<T>(url: string, init?: Parameters<HttpClient>[1]): Promise<T | null> {
        const res = await http(url, {
            method: init?.method ?? 'GET',
            headers: { 'content-type': 'application/json', ...authHeaders(), ...init?.headers },
            body: init?.body,
        });
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
            const data = await fetchJson<SubscriptionBundleRecord[]>(baseUrl);
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
    }): Promise<SubscriptionBundleRecord> {
        const result = await fetchJson<SubscriptionBundleRecord>(baseUrl, {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!result) {
            throw new TenantSubscriptionBundlesApiError(0, null, 'add returned no body');
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
            throw new TenantSubscriptionBundlesApiError(0, null, 'cancel returned no body');
        }
        const hydrated = rehydrateDates(result);
        bundles.value = bundles.value.map((b) => (b.id === subscriptionBundleId ? hydrated : b));
        return hydrated;
    }

    if (options.autoLoad) void load();

    return { bundles, loading, error, load, add, cancel };
}

/**
 * The wire format returns an ISO string per date field; the platform type is
 * `Date`. We map once at the HTTP boundary.
 */
function rehydrateDates(raw: SubscriptionBundleRecord): SubscriptionBundleRecord {
    return {
        ...raw,
        startedAt: new Date(raw.startedAt),
        minimumTermEndsAt: raw.minimumTermEndsAt ? new Date(raw.minimumTermEndsAt) : null,
        canceledAt: raw.canceledAt ? new Date(raw.canceledAt) : null,
        canceledEffectiveAt: raw.canceledEffectiveAt ? new Date(raw.canceledEffectiveAt) : null,
        createdAt: new Date(raw.createdAt),
        updatedAt: new Date(raw.updatedAt),
    };
}
