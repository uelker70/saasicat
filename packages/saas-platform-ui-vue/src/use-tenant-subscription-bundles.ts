// useTenantSubscriptionBundles — Vue-3-Composable für die Tenant-Self-
// Service-Seite „Meine Bundles" (P11.7.3). Spricht den Plattform-
// Endpunkt `/billing/subscription-bundles` (gemountet vom
// `SubscriptionBundleModule.forRoot({ controller: {...} })`).

import { ref, type Ref } from 'vue';
import type { SubscriptionBundleRecord } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export interface UseTenantSubscriptionBundlesOptions {
    /** App-globaler API-Prefix inkl. `/billing` (z. B. `/api/v1`). */
    billingEndpoint: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /** Bei `true` wird beim Mount geladen. Default `false`. */
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
            'useTenantSubscriptionBundles: `billingEndpoint` ist Pflicht (z. B. "/api/v1").',
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
                `SubscriptionBundle-API antwortete mit HTTP ${res.status}`,
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
            throw new TenantSubscriptionBundlesApiError(0, null, 'add gab keinen Body zurück');
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
            throw new TenantSubscriptionBundlesApiError(0, null, 'cancel gab keinen Body zurück');
        }
        const hydrated = rehydrateDates(result);
        bundles.value = bundles.value.map((b) => (b.id === subscriptionBundleId ? hydrated : b));
        return hydrated;
    }

    if (options.autoLoad) void load();

    return { bundles, loading, error, load, add, cancel };
}

/**
 * Wire-Format kommt als ISO-String pro Datumsfeld zurück; das Plattform-
 * Type ist `Date`. Wir mappen einmal an der HTTP-Grenze.
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
