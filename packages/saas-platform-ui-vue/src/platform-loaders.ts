// createPlatformLoaders — Factory, die `BootLoader` + `ManifestLoader` aus
// derselben `SuperAdminEndpoints`-Shape baut, die auch `createSuperAdminApp()`
// konsumiert. Damit liegt die Endpoint-Konfiguration (`apiBase`,
// `publicBootEndpoint`, `manifestEndpoint`) pro App an genau einer Stelle:
// eine Konstante, die `main.ts` an `createSuperAdminApp()` übergibt und die
// das Loader-Wiring aus diesem Helper konsumiert.

import { BootLoader } from './boot-loader.js';
import { ManifestLoader } from './manifest-loader.js';
import type { SuperAdminEndpoints } from './create-super-admin-app.js';
import type { HttpClient, KvStore } from './types.js';

export interface CreatePlatformLoadersOptions {
    /**
     * Gleiche Endpoint-Konfiguration wie bei `createSuperAdminApp()`.
     * `publicBootEndpoint` / `manifestEndpoint` werden aus `apiBase`
     * abgeleitet, wenn sie nicht explizit gesetzt sind.
     */
    endpoints: SuperAdminEndpoints;
    /** HTTP-Adapter. App-spezifisch, weil Auth-Header / Base-URL-Konventionen variieren. */
    http: HttpClient;
    /** Storage für `ManifestLoader` ETag-Cache. Default `defaultKvStore()`. */
    storage?: KvStore;
    /**
     * Storage-Key-Prefix — Konsumenten mit mehreren Apps unter einer Domain
     * setzen das auf z. B. `'ma:'` oder `'da:'`, damit die Caches getrennt
     * sind. Wird nur an den `ManifestLoader` weitergereicht.
     */
    storageKeyPrefix?: string;
    /** Auth-Token-Provider für `Authorization: Bearer …` (nur ManifestLoader). */
    getAuthToken?: () => string | null;
}

export interface PlatformLoaders {
    bootLoader: BootLoader;
    manifestLoader: ManifestLoader;
}

function resolveEndpoints(endpoints: SuperAdminEndpoints): Required<SuperAdminEndpoints> {
    return {
        apiBase: endpoints.apiBase,
        publicBootEndpoint: endpoints.publicBootEndpoint ?? `${endpoints.apiBase}/boot`,
        manifestEndpoint: endpoints.manifestEndpoint ?? `${endpoints.apiBase}/manifest`,
    };
}

/**
 * Baut `BootLoader` + `ManifestLoader` aus einer einzigen Endpoint-Konstante.
 * Apps verwenden dieselbe Konstante für `createSuperAdminApp({ endpoints })`.
 */
export function createPlatformLoaders(options: CreatePlatformLoadersOptions): PlatformLoaders {
    const resolved = resolveEndpoints(options.endpoints);

    const bootLoader = new BootLoader({
        endpoint: resolved.publicBootEndpoint,
        http: options.http,
    });

    const manifestLoader = new ManifestLoader({
        endpoint: resolved.manifestEndpoint,
        http: options.http,
        storage: options.storage,
        storageKeyPrefix: options.storageKeyPrefix,
        getAuthToken: options.getAuthToken,
    });

    return { bootLoader, manifestLoader };
}
