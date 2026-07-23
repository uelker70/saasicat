// ManifestLoader — fetches the admin manifest endpoint with an ETag cache.
//
// **The endpoint is mandatory** and is supplied by the app consumer, because
// apps have different `globalPrefix` conventions (e.g. `api`
// or `api/v1`).
//
// Cache behavior:
//   - First call: GET without If-None-Match → read body + ETag header,
//     persist both in `KvStore` (key suffix `manifest:body` and
//     `manifest:etag`).
//   - Subsequent call: GET with `If-None-Match: <etag>` → on 304 the
//     cached body is returned, no re-parse needed. On 200 the
//     cache is overwritten.
//
// Spec: admin-api.openapi.yaml `GET /admin/manifest`.

import type { AdminManifest } from '@saasicat/types';
import { defaultHttpClient, defaultKvStore, type HttpClient, type KvStore } from './types.js';

export interface ManifestLoaderOptions {
    /**
     * Fully-qualified manifest endpoint incl. app globalPrefix
     * (`/api/admin/manifest`, `/api/v1/admin/manifest`, …). Mandatory.
     */
    endpoint: string;
    http?: HttpClient;
    storage?: KvStore;
    /**
     * Storage key prefix — consumers with multiple apps under one domain
     * set this to e.g. `'ma:'` or `'da:'`, so that the caches
     * are separated.
     */
    storageKeyPrefix?: string;
    /**
     * Auth header for `Authorization: Bearer <token>`. Sent with every
     * request. The consumer supplies a function that pulls the
     * current token from the auth store.
     */
    getAuthToken?: () => string | null;
}

export class ManifestLoadError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'ManifestLoadError';
    }
}

export interface CachedManifestEntry {
    etag: string;
    body: AdminManifest;
}

export class ManifestLoader {
    private readonly endpoint: string;
    private readonly http: HttpClient;
    private readonly storage: KvStore;
    private readonly bodyKey: string;
    private readonly etagKey: string;
    private readonly getAuthToken?: () => string | null;

    constructor(options: ManifestLoaderOptions) {
        if (!options?.endpoint) {
            throw new Error(
                'ManifestLoader: `endpoint` is required (e.g. "/api/admin/manifest" ' +
                    'or "/api/v1/admin/manifest"). The platform has no default ' +
                    'because apps use different globalPrefix conventions.',
            );
        }
        this.endpoint = options.endpoint;
        this.http = options.http ?? defaultHttpClient();
        this.storage = options.storage ?? defaultKvStore();
        const prefix = options.storageKeyPrefix ?? '';
        this.bodyKey = `${prefix}manifest:body`;
        this.etagKey = `${prefix}manifest:etag`;
        this.getAuthToken = options.getAuthToken;
    }

    /**
     * Loads the current manifest. On a cache hit (304) the cached
     * body is returned — otherwise the fresh server body.
     */
    async load(): Promise<AdminManifest> {
        const cachedEtag = this.storage.get(this.etagKey);
        const headers: Record<string, string> = {};
        const token = this.getAuthToken?.();
        if (token) headers.Authorization = `Bearer ${token}`;
        if (cachedEtag) headers['If-None-Match'] = cachedEtag;

        const res = await this.http(this.endpoint, { method: 'GET', headers });

        if (res.status === 304) {
            const cachedBody = this.readCachedBody();
            if (!cachedBody) {
                throw new ManifestLoadError(
                    304,
                    'Server returned 304 but the cache body is missing — call clearCache() and reload',
                );
            }
            return cachedBody.body;
        }

        if (res.status !== 200) {
            throw new ManifestLoadError(
                res.status,
                `Manifest-Endpunkt antwortete HTTP ${res.status}`,
            );
        }

        const body = (await res.json()) as AdminManifest;
        const etag = res.headers.get('ETag') ?? res.headers.get('etag');
        if (etag) {
            this.storage.set(this.etagKey, etag);
            this.storage.set(this.bodyKey, JSON.stringify(body));
        }
        return body;
    }

    /** Reads the cached manifest body from storage; null if absent. */
    readCachedBody(): CachedManifestEntry | null {
        const etag = this.storage.get(this.etagKey);
        const bodyStr = this.storage.get(this.bodyKey);
        if (!etag || !bodyStr) return null;
        try {
            return { etag, body: JSON.parse(bodyStr) as AdminManifest };
        } catch {
            return null;
        }
    }

    /** Clears the cache — e.g. on logout or after `manifest reload`. */
    clearCache(): void {
        this.storage.remove(this.etagKey);
        this.storage.remove(this.bodyKey);
    }
}
