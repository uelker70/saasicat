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
//   - The two keys can come apart — a quota eviction, another tab clearing
//     one of them, a store that took the first write and refused the second.
//     A 304 then answers a question this loader asked on behalf of a body it
//     no longer holds, and the repair is to forget the ETag and ask again
//     unconditionally. See `load()`.
//
// Spec: admin-api.openapi.yaml `GET /admin/manifest`.

import type { AdminManifest } from '@saasicat/types';
import { markPlatformError } from './admin-error.js';
import { requireServerAnswer } from './http-json.js';
import {
    defaultHttpClient,
    defaultKvStore,
    type HttpClient,
    type HttpResponse,
    type KvStore,
} from './types.js';

/** The conditional GET matched: no body was sent, so the cache has to answer. */
const NOT_MODIFIED = 304;

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

/**
 * The manifest could not be loaded. Its `message` is a diagnostic for the log,
 * never text for a screen — `markPlatformError` is what tells `toAdminError`
 * so, and it is a promise this class has to keep at every throw site.
 */
export class ManifestLoadError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'ManifestLoadError';
        // Identity, so `toAdminError` can tell this diagnostic from a
        // consumer error whose message an operator needs to read.
        markPlatformError(this);
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
     *
     * A 304 with no usable cached body is not a failure to report but one to
     * undo: the request only carried `If-None-Match` because this loader put
     * the ETag there, and the cache it validated against is this loader's own.
     * So it drops the pair and asks once more without the header, which is the
     * same recovery a person would have had to trigger by hand — except that
     * the person reading an admin screen has neither this loader nor a
     * console. Exactly one retry: a 304 to a request that asked nothing
     * conditional is a server fault, and no repetition fixes it.
     */
    async load(): Promise<AdminManifest> {
        const cachedEtag = this.storage.get(this.etagKey);
        const res = await this.request(cachedEtag);
        if (res.status !== NOT_MODIFIED) return this.acceptFresh(res);

        const cached = this.readCachedBody();
        if (cached) return cached.body;

        if (cachedEtag) {
            this.clearCache();
            const fresh = await this.request(null);
            if (fresh.status !== NOT_MODIFIED) return this.acceptFresh(fresh);
        }

        throw new ManifestLoadError(
            NOT_MODIFIED,
            'Manifest endpoint answered HTTP 304 to a request without If-None-Match',
        );
    }

    /** Sends the manifest GET, conditional when an ETag is supplied. */
    private request(etag: string | null): Promise<HttpResponse> {
        const headers: Record<string, string> = {};
        const token = this.getAuthToken?.();
        if (token) headers.Authorization = `Bearer ${token}`;
        if (etag) headers['If-None-Match'] = etag;
        return this.http(this.endpoint, { method: 'GET', headers });
    }

    /** Takes a non-304 response as the current manifest and caches it. */
    private async acceptFresh(res: HttpResponse): Promise<AdminManifest> {
        requireServerAnswer(
            res.status,
            'GET',
            this.endpoint,
            (diagnostic) => new ManifestLoadError(res.status, diagnostic),
        );
        if (res.status !== 200) {
            throw new ManifestLoadError(
                res.status,
                `Manifest endpoint responded with HTTP ${res.status}`,
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
