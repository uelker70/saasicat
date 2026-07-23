// useTenantManifest — Vue composable for the Tenant manifest endpoint
// (see @saasicat/nest §P14: `GET /tenant/manifest`).
//
// Returns the plan ID, features, quotas and the filtered navigation that the
// backend renders per Tenant. This lets the app UI build the navigation
// declaratively from the Manifest instead of filtering it itself.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P14.

import { ref, type Ref } from 'vue';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface TenantManifestNavItem {
    id: string;
    label: string;
    path: string;
    icon?: string;
    order?: number;
}

export interface TenantManifestShape {
    schemaVersion: 1;
    tenant: { id: string };
    planId: string | null;
    features: string[];
    quotas: Record<string, number>;
    navigation: TenantManifestNavItem[];
}

export interface UseTenantManifestOptions {
    /** e.g. `/api/tenant/manifest` (mandatory). */
    endpoint: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /** Defaults to `true`. */
    autoLoad?: boolean;
}

export interface UseTenantManifestResult {
    manifest: Ref<TenantManifestShape | null>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    load: () => Promise<void>;
    hasFeature: (key: string) => boolean;
    /** Quota limit (`null` if the Quota is not in the Plan). */
    quotaLimit: (key: string) => number | null;
}

export function useTenantManifest(options: UseTenantManifestOptions): UseTenantManifestResult {
    if (!options?.endpoint) {
        throw new Error('useTenantManifest: `endpoint` is required (e.g. "/api/tenant/manifest").');
    }
    const http = options.http ?? defaultHttpClient();
    const manifest = ref<TenantManifestShape | null>(null);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const headers: Record<string, string> = {};
            const token = options.getAuthToken?.();
            if (token) headers.Authorization = `Bearer ${token}`;
            const res = await http(options.endpoint, { method: 'GET', headers });
            if (res.status !== 200) {
                throw new Error(`Tenant-Manifest-Endpoint → HTTP ${res.status}`);
            }
            manifest.value = (await res.json()) as TenantManifestShape;
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
            manifest.value = null;
        } finally {
            loading.value = false;
        }
    }

    function hasFeature(key: string): boolean {
        return manifest.value?.features.includes(key) ?? false;
    }

    function quotaLimit(key: string): number | null {
        const v = manifest.value?.quotas[key];
        return v === undefined ? null : v;
    }

    if (options.autoLoad !== false) {
        Promise.resolve().then(() => void load());
    }

    return { manifest, loading, error, load, hasFeature, quotaLimit };
}
