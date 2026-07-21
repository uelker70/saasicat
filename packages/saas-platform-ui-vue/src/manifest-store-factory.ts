// createManifestStore — Pinia store factory that standardizes the
// `loaded`/`inflight`/`ensureLoaded()`/`reload()`/`clearCache()` boilerplate.
//
// Apps define their manifest store from this factory:
//
//     import { createManifestStore } from '@saasicat/ui-vue';
//     import { manifestLoader } from '@/services/platform-loaders';
//     export const useManifestStore = createManifestStore({ loader: manifestLoader });
//
// This keeps the cache/inflight logic in a single place, and apps no
// longer duplicate identical Pinia setups.

import { defineStore, type StoreDefinition } from 'pinia';
import { ref, type Ref } from 'vue';
import type { AdminManifest } from '@saasicat/types';
import type { ManifestLoader } from './manifest-loader.js';

export interface ManifestStoreState {
    manifest: Ref<AdminManifest | null>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    loaded: Ref<boolean>;
}

export interface ManifestStoreActions {
    /**
     * Loads once per session. Concurrent calls share the promise.
     *
     * **Behavior on loader error:** the store caches the error in
     * `error.value` and resets `loaded = false`/`manifest = null`, and the
     * promise REJECTS with the original error. Callers must either
     * call `.catch(...)` (defensive behavior) or let the rejection
     * propagate. The platform router guard
     * (`createSuperAdminApp({ manifestGuard.errorRoute })`) provides a
     * fail-closed path with a redirect to a dedicated error route.
     */
    ensureLoaded: () => Promise<void>;
    /** Discards cache + state (logout path). */
    clearCache: () => void;
    /** Forces a server refresh (e.g. after `manifest reload`). */
    reload: () => Promise<void>;
}

export interface CreateManifestStoreOptions {
    /** Platform `ManifestLoader` instance (typically via `createPlatformLoaders()`). */
    loader: ManifestLoader;
    /** Pinia store ID. Default `admin-manifest`. */
    id?: string;
}

export type ManifestStoreDefinition = StoreDefinition<
    string,
    ManifestStoreState,
    Record<string, never>,
    ManifestStoreActions
>;

/**
 * Returns a `useStore` function for the manifest store. Apps call the
 * factory once at module top level and export the result as
 * `useManifestStore`.
 */
export function createManifestStore(options: CreateManifestStoreOptions): ManifestStoreDefinition {
    return defineStore(options.id ?? 'admin-manifest', () => {
        const manifest = ref<AdminManifest | null>(null);
        const loading = ref(false);
        const error = ref<Error | null>(null);
        const loaded = ref(false);
        let inflight: Promise<void> | null = null;

        async function load(): Promise<void> {
            loading.value = true;
            error.value = null;
            try {
                manifest.value = await options.loader.load();
                loaded.value = true;
            } catch (err) {
                const wrapped = err instanceof Error ? err : new Error(String(err));
                error.value = wrapped;
                manifest.value = null;
                loaded.value = false;
                // Re-throw so callers (router guard, page setups) see the
                // error and can decide (fallback route, notification,
                // etc.). The state (`error.value`) is retained and can be
                // displayed reactively by components.
                throw wrapped;
            } finally {
                loading.value = false;
                inflight = null;
            }
        }

        function ensureLoaded(): Promise<void> {
            if (loaded.value) return Promise.resolve();
            if (inflight) return inflight;
            inflight = load();
            return inflight;
        }

        function clearCache(): void {
            options.loader.clearCache();
            manifest.value = null;
            loaded.value = false;
            inflight = null;
        }

        async function reload(): Promise<void> {
            clearCache();
            await ensureLoaded();
        }

        return { manifest, loading, error, loaded, ensureLoaded, clearCache, reload };
    }) as ManifestStoreDefinition;
}
