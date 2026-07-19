// useTenantManifest — Vue-Composable für den Tenant-Manifest-Endpoint
// (siehe @saasicat/nest §P14: `GET /tenant/manifest`).
//
// Liefert Plan-ID, Features, Quotas und die gefilterte Navigation, die das
// Backend pro Tenant rendert. Damit kann die App-UI die Navigation
// deklarativ aus dem Manifest aufbauen statt selbst zu filtern.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P14.

import { ref, type Ref } from 'vue';
import { defaultHttpClient, type HttpClient } from './types.js';

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
    /** z. B. `/api/tenant/manifest` (Pflicht). */
    endpoint: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /** Default `true`. */
    autoLoad?: boolean;
}

export interface UseTenantManifestResult {
    manifest: Ref<TenantManifestShape | null>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    load: () => Promise<void>;
    hasFeature: (key: string) => boolean;
    /** Quota-Limit (`null` falls Quota nicht im Plan). */
    quotaLimit: (key: string) => number | null;
}

export function useTenantManifest(options: UseTenantManifestOptions): UseTenantManifestResult {
    if (!options?.endpoint) {
        throw new Error(
            'useTenantManifest: `endpoint` ist Pflicht (z. B. "/api/tenant/manifest").',
        );
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
