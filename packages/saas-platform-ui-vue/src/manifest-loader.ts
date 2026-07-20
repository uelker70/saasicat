// ManifestLoader — fetcht den Admin-Manifest-Endpoint mit ETag-Cache.
//
// **Endpoint ist Pflicht** und wird vom App-Konsumenten geliefert, weil
// Apps unterschiedliche `globalPrefix`-Konventionen haben (z. B. `api`
// oder `api/v1`).
//
// Cache-Verhalten:
//   - Erster Aufruf: GET ohne If-None-Match → Body + ETag-Header lesen,
//     beides in `KvStore` persistieren (Key-Suffix `manifest:body` und
//     `manifest:etag`).
//   - Folgeaufruf: GET mit `If-None-Match: <etag>` → bei 304 wird der
//     gecachte Body zurückgegeben, kein Re-Parse nötig. Bei 200 wird der
//     Cache überschrieben.
//
// Spec: admin-api.openapi.yaml `GET /admin/manifest`.

import type { AdminManifest } from '@saasicat/types';
import { defaultHttpClient, defaultKvStore, type HttpClient, type KvStore } from './types.js';

export interface ManifestLoaderOptions {
    /**
     * Voll-qualifizierter Manifest-Endpoint inkl. App-globalPrefix
     * (`/api/admin/manifest`, `/api/v1/admin/manifest`, …). Pflicht.
     */
    endpoint: string;
    http?: HttpClient;
    storage?: KvStore;
    /**
     * Storage-Key-Prefix — Konsumenten mit mehreren Apps unter einer Domain
     * setzen das auf z. B. `'ma:'` oder `'da:'`, damit die Caches
     * separiert sind.
     */
    storageKeyPrefix?: string;
    /**
     * Auth-Header für `Authorization: Bearer <token>`. Wird bei jedem
     * Request mitgeschickt. Konsument liefert eine Funktion, die den
     * aktuellen Token aus dem Auth-Store zieht.
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
                'ManifestLoader: `endpoint` ist Pflicht (z. B. "/api/admin/manifest" ' +
                    'oder "/api/v1/admin/manifest"). Plattform hat keinen Default, ' +
                    'weil Apps unterschiedliche globalPrefix-Konventionen haben.',
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
     * Lädt das aktuelle Manifest. Bei Cache-Hit (304) wird der gecachte
     * Body zurückgegeben — sonst der frische Server-Body.
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
                    'Server lieferte 304, aber Cache-Body fehlt — bitte clearCache() + reload',
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

    /** Liest den gecachten Manifest-Body aus dem Storage; null wenn nicht da. */
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

    /** Räumt den Cache — z. B. bei Logout oder nach `manifest reload`. */
    clearCache(): void {
        this.storage.remove(this.etagKey);
        this.storage.remove(this.bodyKey);
    }
}
