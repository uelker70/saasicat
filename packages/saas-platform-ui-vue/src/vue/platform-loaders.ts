// createPlatformLoaders — factory that builds `BootLoader` + `ManifestLoader`
// from the same `SuperAdminEndpoints` shape that `createSuperAdminApp()` also
// consumes. This keeps the endpoint configuration (`apiBase`,
// `publicBootEndpoint`, `manifestEndpoint`) in exactly one place per app:
// a single constant that `main.ts` passes to `createSuperAdminApp()` and that
// the loader wiring from this helper consumes.

import { BootLoader } from '../client/boot-loader.js';
import { ManifestLoader } from '../client/manifest-loader.js';
import type { SuperAdminEndpoints } from './super-admin-context.js';
import type { HttpClient, KvStore } from '../client/types.js';

export interface CreatePlatformLoadersOptions {
    /**
     * Same endpoint configuration as for `createSuperAdminApp()`.
     * `publicBootEndpoint` / `manifestEndpoint` are derived from `apiBase`
     * when not set explicitly.
     */
    endpoints: SuperAdminEndpoints;
    /** HTTP adapter. App-specific, because auth-header / base-URL conventions vary. */
    http: HttpClient;
    /** Storage for the `ManifestLoader` ETag cache. Defaults to `defaultKvStore()`. */
    storage?: KvStore;
    /**
     * Storage key prefix — consumers with multiple apps under one domain
     * set this to e.g. `'ma:'` or `'da:'` so the caches stay separate.
     * Only forwarded to the `ManifestLoader`.
     */
    storageKeyPrefix?: string;
    /** Auth-token provider for `Authorization: Bearer …` (ManifestLoader only). */
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
 * Builds `BootLoader` + `ManifestLoader` from a single endpoint constant.
 * Apps use the same constant for `createSuperAdminApp({ endpoints })`.
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
