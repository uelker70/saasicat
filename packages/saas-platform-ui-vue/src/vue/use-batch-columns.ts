// useBatchColumns — Vue 3 composable on top of BatchColumnFetcher.
//
// Reactively reloads the custom TenantColumn data whenever either the
// `tenantIds` list (pagination → different tenant IDs) or the Manifest
// changes (e.g. after `manifest reload`). Loading and error state are
// aggregated per column; granular per-column loading state can be added
// by consumers via a direct `fetcher.fetchOne` call.

import { ref, watch, type Ref } from 'vue';
import type { AdminManifest } from '@saasicat/types';
import {
    BatchColumnFetcher,
    type BatchColumnData,
    type BatchColumnFetcherOptions,
} from '../client/batch-column-fetcher.js';

export interface UseBatchColumnsResult {
    /** Data per column key (`columnKey → tenantId → value`). */
    data: Ref<BatchColumnData>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** Manual re-fetch (e.g. after a mutation). */
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

    // Reactive: reloads as soon as the Manifest or tenantIds change.
    watch([manifest, tenantIds], () => {
        void load();
    });

    return { data, loading, error, reload: load };
}
