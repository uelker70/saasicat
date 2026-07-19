// useManifest — Vue-3-Composable über ManifestLoader mit ETag-Cache.
//
// Verwendung in der Shell-App nach Login:
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
    /** Lädt einmalig (oder liefert Cache); bricht bei Re-Aufruf nicht ab. */
    load: () => Promise<void>;
    /** Verwirft den Cache und lädt frisch (z. B. nach manifest/reload). */
    reload: () => Promise<void>;
    /** Räumt den Cache — z. B. bei Logout. */
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
