// createManifestStore — Pinia-Store-Factory, die `loaded`/`inflight`/
// `ensureLoaded()`/`reload()`/`clearCache()`-Boilerplate standardisiert.
//
// Apps definieren ihren Manifest-Store aus dieser Factory:
//
//     import { createManifestStore } from '@saasicat/ui-vue';
//     import { manifestLoader } from '@/services/platform-loaders';
//     export const useManifestStore = createManifestStore({ loader: manifestLoader });
//
// Damit liegt die Cache-/Inflight-Logik nur an einer Stelle, und Apps
// duplizieren keine identischen Pinia-Setups mehr.

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
     * Lädt einmalig pro Session. Concurrent-Aufrufe teilen sich den Promise.
     *
     * **Verhalten bei Loader-Fehler:** der Store cached den Fehler in
     * `error.value` und resettet `loaded = false`/`manifest = null`, und der
     * Promise REJECTED mit dem Original-Error. Caller müssen entweder
     * `.catch(...)` aufrufen (defensives Verhalten) oder die Rejection
     * propagieren lassen. Der Plattform-Router-Guard
     * (`createSuperAdminApp({ manifestGuard.errorRoute })`) bietet einen
     * fail-closed-Pfad mit Redirect auf eine dedizierte Error-Route.
     */
    ensureLoaded: () => Promise<void>;
    /** Verwirft Cache + State (Logout-Pfad). */
    clearCache: () => void;
    /** Erzwingt Server-Refresh (z. B. nach `manifest reload`). */
    reload: () => Promise<void>;
}

export interface CreateManifestStoreOptions {
    /** Plattform-`ManifestLoader`-Instanz (typisch via `createPlatformLoaders()`). */
    loader: ManifestLoader;
    /** Pinia-Store-ID. Default `admin-manifest`. */
    id?: string;
}

export type ManifestStoreDefinition = StoreDefinition<
    string,
    ManifestStoreState,
    Record<string, never>,
    ManifestStoreActions
>;

/**
 * Liefert eine `useStore`-Funktion für den Manifest-Store. Apps rufen die
 * Factory einmal auf Modul-Top-Level auf und exportieren das Ergebnis als
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
                // Re-throw, damit Caller (Router-Guard, Page-Setups) den Fehler
                // sehen und entscheiden können (Fallback-Route, Notification,
                // etc.). Der State (`error.value`) bleibt erhalten und kann
                // reaktiv von Komponenten angezeigt werden.
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
