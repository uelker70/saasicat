// useManifest — Vue 3 composable over ManifestLoader with ETag cache.
//
// Usage in the shell app after login:
//
//     const { manifest, loading, error, load, reload } = useManifest({
//       getAuthToken: () => authStore.token,
//     });
//     await load();

import { ref, type Ref } from 'vue';
import type { AdminManifest } from '@saasicat/types';
import { ManifestLoader, type ManifestLoaderOptions } from './manifest-loader.js';

export interface UseManifestResult {
    manifest: Ref<AdminManifest | null>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** Loads once (or returns the cache); does not abort on re-call. */
    load: () => Promise<void>;
    /** Discards the cache and loads fresh (e.g. after manifest/reload). */
    reload: () => Promise<void>;
    /** Clears the cache — e.g. on logout. */
    clearCache: () => void;
}

export function useManifest(options: ManifestLoaderOptions): UseManifestResult {
    const loader = new ManifestLoader(options);
    const manifest = ref<AdminManifest | null>(null);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    async function load() {
        loading.value = true;
        error.value = null;
        try {
            manifest.value = await loader.load();
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
            manifest.value = null;
        } finally {
            loading.value = false;
        }
    }

    async function reload() {
        loader.clearCache();
        manifest.value = null;
        await load();
    }

    function clearCache() {
        loader.clearCache();
        manifest.value = null;
    }

    return { manifest, loading, error, load, reload, clearCache };
}
