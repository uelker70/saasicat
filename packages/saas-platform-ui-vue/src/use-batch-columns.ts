// useBatchColumns — Vue-3-Composable über BatchColumnFetcher.
//
// Lädt die Custom-TenantColumn-Daten reaktiv neu, wenn sich entweder die
// `tenantIds`-Liste (Pagination → andere Tenant-IDs) oder das Manifest
// ändert (z. B. nach `manifest reload`). Loading- und Error-State werden
// pro Spalte aggregiert; granulares Loading-State pro Spalte können
// Konsumenten via direkter `fetcher.fetchOne` nachrüsten.

import { ref, watch, type Ref } from 'vue';
import type { AdminManifest } from '@saasicat/types';
import {
    BatchColumnFetcher,
    type BatchColumnData,
    type BatchColumnFetcherOptions,
} from './batch-column-fetcher.js';

export interface UseBatchColumnsResult {
    /** Daten pro Spalten-Key (`columnKey → tenantId → value`). */
    data: Ref<BatchColumnData>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** Manueller Re-Fetch (z. B. nach Mutation). */
    reload: () => Promise<void>;
}

export function useBatchColumns(
    manifest: Ref<AdminManifest | null>,
    tenantIds: Ref<string[]>,
    options: BatchColumnFetcherOptions = {},
): UseBatchColumnsResult {
    const fetcher = new BatchColumnFetcher(options);
    const data = ref<BatchColumnData>({});
    const loading = ref(false);
    const error = ref<Error | null>(null);

    async function load() {
        if (!manifest.value || tenantIds.value.length === 0) {
            data.value = {};
            return;
        }
        loading.value = true;
        error.value = null;
        try {
            data.value = await fetcher.fetchAll(manifest.value, tenantIds.value);
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
            data.value = {};
        } finally {
            loading.value = false;
        }
    }

    // Reaktiv: lädt neu, sobald sich Manifest oder tenantIds ändern.
    watch([manifest, tenantIds], () => {
        void load();
    });

    return { data, loading, error, reload: load };
}
