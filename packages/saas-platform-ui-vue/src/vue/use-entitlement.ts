// useEntitlement — Vue composable over the tenant entitlement endpoint.
//
// **Endpoint is mandatory** and is supplied by the app consumer
// (e.g. `/api/billing/entitlement` or `/api/v1/billing/entitlement`).
//
// Returns a tenant's effective limits as a reactive Ref. The consumer
// backend exposes the endpoint via the platform `EntitlementService.computeLimits`
// (see @saasicat/nest).
//
// Output is the `EffectiveLimitsSnapshot` shape from saas-platform-nest —
// mapped here as a generic shape because the platform types package does not
// expose the snapshot (it lives in saas-platform-nest/entitlement).

import { ref, type Ref } from 'vue';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface EntitlementSnapshotShape {
    plan: string;
    quotas: Record<string, number>;
    features: string[];
}

export interface UseEntitlementOptions {
    /**
     * Fully-qualified entitlement endpoint including the app globalPrefix
     * (`/api/billing/entitlement`, `/api/v1/billing/entitlement`, …). Mandatory.
     */
    endpoint: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /** Default `true`. */
    autoLoad?: boolean;
}

export interface UseEntitlementResult {
    entitlement: Ref<EntitlementSnapshotShape | null>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    load: () => Promise<void>;
    /** Convenience: checks whether a FeatureKey is in the set. */
    hasFeature: (key: string) => boolean;
}

export function useEntitlement(options: UseEntitlementOptions): UseEntitlementResult {
    if (!options?.endpoint) {
        throw new Error(
            'useEntitlement: `endpoint` ist Pflicht (z. B. "/api/billing/entitlement" ' +
                'oder "/api/v1/billing/entitlement"). Plattform hat keinen Default, weil ' +
                'Apps unterschiedliche globalPrefix-Konventionen haben.',
        );
    }
    const endpoint = options.endpoint;
    const http = options.http ?? defaultHttpClient();
    const entitlement = ref<EntitlementSnapshotShape | null>(null);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    async function load() {
        loading.value = true;
        error.value = null;
        try {
            const headers: Record<string, string> = {};
            const token = options.getAuthToken?.();
            if (token) headers.Authorization = `Bearer ${token}`;
            const res = await http(endpoint, { method: 'GET', headers });
            if (res.status !== 200) {
                throw new Error(`Entitlement-Endpoint → HTTP ${res.status}`);
            }
            entitlement.value = (await res.json()) as EntitlementSnapshotShape;
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
            entitlement.value = null;
        } finally {
            loading.value = false;
        }
    }

    function hasFeature(key: string): boolean {
        return entitlement.value?.features.includes(key) ?? false;
    }

    if (options.autoLoad !== false) {
        Promise.resolve().then(() => void load());
    }

    return { entitlement, loading, error, load, hasFeature };
}
