// useBundleVersionsMap — loads the versions for each bundle in parallel and
// keeps the mapping `bundleId → BundleVersionRow[]` reactive. Used by the
// BundlesPage to correctly compute KPIs (live / scheduled / drafts) and a
// status filter across all bundles — before the user opens an accordion.
//
// Trade-off: 1+N HTTP requests on mount. Acceptable for SuperAdmin setups
// with few bundles (today typically < 20). A backend optimization via an
// aggregate endpoint (`/admin/catalog/bundles?include=versions` or
// `/admin/catalog/bundles/aggregates`) can come later additively, without
// breaking this composable API.

import { ref, watch, type Ref } from 'vue';
import type { BundleRow, BundleVersionRow } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseBundleVersionsMapOptions {
    adminEndpoint: string;
    /** Reactive list of bundle roots; the watcher reloads when the IDs change. */
    bundles: Ref<BundleRow[]>;
    http?: HttpClient;
    getAuthToken?: () => string | null;
}

export interface UseBundleVersionsMapResult {
    /** `bundleId → BundleVersionRow[]`. Empty list for bundles without versions. */
    versionsByBundle: Ref<Record<string, BundleVersionRow[]>>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** Forces a reload of all bundle versions. */
    refresh: () => Promise<void>;
    /** Refresh only a single bundle (e.g. after an inline-editor save). */
    refreshOne: (bundleId: string) => Promise<void>;
}

export function useBundleVersionsMap(
    options: UseBundleVersionsMapOptions,
): UseBundleVersionsMapResult {
    if (!options?.adminEndpoint) {
        throw new Error('useBundleVersionsMap: `adminEndpoint` ist Pflicht.');
    }
    if (!options?.bundles) {
        throw new Error('useBundleVersionsMap: `bundles` ist Pflicht.');
    }

    const http = options.http ?? defaultHttpClient();
    const versionsByBundle = ref<Record<string, BundleVersionRow[]>>({});
    const loading = ref(false);
    const error = ref<Error | null>(null);

    function authHeaders(): Record<string, string> {
        const token = options.getAuthToken?.();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function loadForBundle(bundleId: string): Promise<BundleVersionRow[]> {
        const res = await http(`${options.adminEndpoint}/catalog/bundles/${bundleId}/versions`, {
            method: 'GET',
            headers: { 'content-type': 'application/json', ...authHeaders() },
        });
        if (res.status >= 400) {
            throw new Error(`HTTP ${res.status} beim Laden der Versionen für Bundle '${bundleId}'`);
        }
        return ((await res.json().catch(() => null)) as BundleVersionRow[] | null) ?? [];
    }

    async function refresh(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const entries = await Promise.all(
                options.bundles.value.map(async (b) => {
                    try {
                        const versions = await loadForBundle(b.id);
                        return [b.id, versions] as const;
                    } catch (err) {
                        console.warn(
                            `useBundleVersionsMap: Bundle '${b.bundleKey}' Versions-Load failed`,
                            err,
                        );
                        return [b.id, []] as const;
                    }
                }),
            );
            versionsByBundle.value = Object.fromEntries(entries);
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function refreshOne(bundleId: string): Promise<void> {
        try {
            const versions = await loadForBundle(bundleId);
            versionsByBundle.value = { ...versionsByBundle.value, [bundleId]: versions };
        } catch (err) {
            console.warn(`useBundleVersionsMap: refreshOne('${bundleId}') failed`, err);
        }
    }

    // Auto-refresh when the bundle list changes (creation, soft-delete).
    watch(
        () => options.bundles.value.map((b) => b.id).join(','),
        () => {
            if (options.bundles.value.length > 0) void refresh();
            else versionsByBundle.value = {};
        },
        { immediate: true },
    );

    return { versionsByBundle, loading, error, refresh, refreshOne };
}
