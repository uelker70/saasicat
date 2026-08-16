// useDiscovery — Vue 3 composable over the discovery endpoint
// (`GET /admin/discovery`).
//
// Returns the boot-time snapshot of the running backend — capabilities,
// features, bundles and quotas that are annotated in code via
// @ImplementsCapability, @DefinesQuota etc. ETag caching: on follow-up
// requests `If-None-Match: <hash>` is sent along; on 304 the cached
// snapshot stays in place, no re-parse needed.
//
// **The endpoint is mandatory** and is supplied by the consumer
// (e.g. `/api/admin/discovery` or `/api/v1/admin/discovery`).

import { ref, type Ref } from 'vue';
import { markPlatformError } from '../client/admin-error.js';
import type { DiscoverySnapshot } from '@saasicat/types';
import { requireServerAnswer } from '../client/http-json.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseDiscoveryOptions {
    /**
     * Fully qualified discovery endpoint including the app globalPrefix
     * (`/api/admin/discovery`, `/api/v1/admin/discovery`, …). Mandatory.
     */
    endpoint: string;
    http?: HttpClient;
    /**
     * Auth header for `Authorization: Bearer <token>`. Sent along with every
     * request. The consumer supplies a function that pulls the current token
     * from the auth store.
     */
    getAuthToken?: () => string | null;
    /**
     * When `true`, loads automatically on composable init. Default
     * `false` — the consumer triggers `load()` itself (e.g. after page mount).
     */
    autoLoad?: boolean;
}

/**
 * The discovery endpoint could not be read. Its `message` is a diagnostic for
 * the log, in English like every other developer-facing string in the
 * repository — the sentence a user is shown comes from the `errors` catalog
 * through `adminErrorMessage`, in whichever language the shell speaks.
 */
export class DiscoveryLoadError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'DiscoveryLoadError';
        // Identity, so `toAdminError` can tell this diagnostic from a
        // consumer error whose message an operator needs to read.
        markPlatformError(this);
    }
}

export interface UseDiscoveryResult {
    snapshot: Ref<DiscoverySnapshot | null>;
    /** ETag header of the last 200 response, or null. */
    etag: Ref<string | null>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /**
     * Loads fresh. On a cache hit (HTTP 304) `snapshot` stays unchanged,
     * as does `etag`.
     */
    load: () => Promise<void>;
    /**
     * Discards the cache (etag = null) and loads without If-None-Match. Useful
     * after code deploys, when a new snapshot is expected.
     */
    reload: () => Promise<void>;
    /**
     * `POST <endpoint>/rescan` — forces a fresh code scan in the backend
     * (new `scannedAt`) and adopts the snapshot.
     */
    rescan: () => Promise<void>;
}

export function useDiscovery(options: UseDiscoveryOptions): UseDiscoveryResult {
    if (!options?.endpoint) {
        throw new Error(
            'useDiscovery: `endpoint` is required (e.g. "/api/admin/discovery" ' +
                'or "/api/v1/admin/discovery"). The platform has no default ' +
                'because apps use different globalPrefix conventions.',
        );
    }

    const http = options.http ?? defaultHttpClient();
    const snapshot = ref<DiscoverySnapshot | null>(null);
    const etag = ref<string | null>(null);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    async function fetchSnapshot(includeEtag: boolean): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const headers: Record<string, string> = {};
            const token = options.getAuthToken?.();
            if (token) headers.Authorization = `Bearer ${token}`;
            if (includeEtag && etag.value) {
                headers['If-None-Match'] = etag.value;
            }

            const res = await http(options.endpoint, { method: 'GET', headers });
            requireServerAnswer(
                res.status,
                'GET',
                options.endpoint,
                (diagnostic) => new DiscoveryLoadError(res.status, diagnostic),
            );

            if (res.status === 304) {
                // Cache hit: snapshot stays unchanged, no re-parse.
                return;
            }
            if (res.status !== 200) {
                throw new DiscoveryLoadError(
                    res.status,
                    `Discovery endpoint responded with HTTP ${res.status}`,
                );
            }

            const body = (await res.json()) as DiscoverySnapshot;
            snapshot.value = body;
            etag.value = res.headers.get('ETag');
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function load(): Promise<void> {
        await fetchSnapshot(true);
    }

    async function reload(): Promise<void> {
        etag.value = null;
        await fetchSnapshot(false);
    }

    async function rescan(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const headers: Record<string, string> = { 'content-type': 'application/json' };
            const token = options.getAuthToken?.();
            if (token) headers.Authorization = `Bearer ${token}`;

            const rescanUrl = `${options.endpoint}/rescan`;
            const res = await http(rescanUrl, { method: 'POST', headers });
            requireServerAnswer(
                res.status,
                'POST',
                rescanUrl,
                (diagnostic) => new DiscoveryLoadError(res.status, diagnostic),
            );
            if (res.status !== 200 && res.status !== 201) {
                throw new DiscoveryLoadError(
                    res.status,
                    `Discovery rescan responded with HTTP ${res.status}`,
                );
            }
            const body = (await res.json()) as DiscoverySnapshot;
            snapshot.value = body;
            etag.value = res.headers.get('ETag');
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    if (options.autoLoad) {
        void load();
    }

    return { snapshot, etag, loading, error, load, reload, rescan };
}
