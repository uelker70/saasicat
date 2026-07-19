// useBundleVersionsMap — lädt parallel pro Bundle die Versionen und
// hält das Mapping `bundleId → BundleVersionRow[]` reactive. Wird von der
// BundlesPage gebraucht, um KPI (live / scheduled / drafts) und einen
// Status-Filter über alle Bundles korrekt zu berechnen — bevor der User
// ein Akkordeon öffnet.
//
// Trade-off: 1+N HTTP-Requests beim Mount. Für SuperAdmin-Setups mit
// wenigen Bundles (heute typisch < 20) akzeptabel. Eine Backend-
// Optimierung über einen Aggregate-Endpoint (`/admin/catalog/bundles?
// include=versions` oder `/admin/catalog/bundles/aggregates`) kann später
// additiv kommen, ohne diese Composable-API zu brechen.

import { ref, watch, type Ref } from 'vue';
import type { BundleRow, BundleVersionRow } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export interface UseBundleVersionsMapOptions {
    adminEndpoint: string;
    /** Reactive Liste der Bundle-Stämme; Watcher lädt neu, wenn sich die IDs ändern. */
    bundles: Ref<BundleRow[]>;
    http?: HttpClient;
    getAuthToken?: () => string | null;
}

export interface UseBundleVersionsMapResult {
    /** `bundleId → BundleVersionRow[]`. Leere Liste bei Bundles ohne Versionen. */
    versionsByBundle: Ref<Record<string, BundleVersionRow[]>>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** Erzwingt Neuladen aller Bundle-Versionen. */
    refresh: () => Promise<void>;
    /** Refresh nur für ein einzelnes Bundle (z. B. nach Inline-Editor-Save). */
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

    // Auto-Refresh, wenn sich die Bundle-Liste ändert (Anlage, Soft-Delete).
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
