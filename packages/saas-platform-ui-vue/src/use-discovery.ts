// useDiscovery — Vue-3-Composable über den Discovery-Endpoint
// (`GET /admin/discovery`).
//
// Liefert den Boot-Zeit-Snapshot des laufenden Backends — Capabilities,
// Features, Bundles und Quotas, die im Code via @ImplementsCapability,
// @DefinesQuota etc. annotiert sind. ETag-Caching: bei Folge-Requests
// wird `If-None-Match: <hash>` mitgeschickt; bei 304 bleibt der gecachte
// Snapshot bestehen, kein Re-Parse nötig.
//
// **Endpoint ist Pflicht** und wird vom Konsumenten geliefert
// (z. B. `/api/admin/discovery` oder `/api/v1/admin/discovery`).

import { ref, type Ref } from 'vue';
import type { DiscoverySnapshot } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export interface UseDiscoveryOptions {
    /**
     * Voll-qualifizierter Discovery-Endpoint inkl. App-globalPrefix
     * (`/api/admin/discovery`, `/api/v1/admin/discovery`, …). Pflicht.
     */
    endpoint: string;
    http?: HttpClient;
    /**
     * Auth-Header für `Authorization: Bearer <token>`. Wird bei jedem
     * Request mitgeschickt. Konsument liefert eine Funktion, die den
     * aktuellen Token aus dem Auth-Store zieht.
     */
    getAuthToken?: () => string | null;
    /**
     * Bei `true` wird beim Composable-Init automatisch geladen. Default
     * `false` — Konsument triggert `load()` selbst (z. B. nach Page-Mount).
     */
    autoLoad?: boolean;
}

export class DiscoveryLoadError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'DiscoveryLoadError';
    }
}

export interface UseDiscoveryResult {
    snapshot: Ref<DiscoverySnapshot | null>;
    /** ETag-Header des letzten 200er-Responses, oder null. */
    etag: Ref<string | null>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /**
     * Lädt frisch. Bei Cache-Hit (HTTP 304) bleibt `snapshot` unverändert,
     * `etag` ebenfalls.
     */
    load: () => Promise<void>;
    /**
     * Wirft Cache weg (etag = null) und lädt ohne If-None-Match. Sinnvoll
     * nach Code-Deploys, wenn ein neuer Snapshot erwartet wird.
     */
    reload: () => Promise<void>;
    /**
     * `POST <endpoint>/rescan` — erzwingt im Backend einen frischen
     * Code-Scan (neues `scannedAt`) und übernimmt den Snapshot.
     */
    rescan: () => Promise<void>;
}

export function useDiscovery(options: UseDiscoveryOptions): UseDiscoveryResult {
    if (!options?.endpoint) {
        throw new Error(
            'useDiscovery: `endpoint` ist Pflicht (z. B. "/api/admin/discovery" ' +
                'oder "/api/v1/admin/discovery"). Plattform hat keinen Default, ' +
                'weil Apps unterschiedliche globalPrefix-Konventionen haben.',
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

            if (res.status === 304) {
                // Cache-Hit: snapshot bleibt unverändert, kein Re-Parse.
                return;
            }
            if (res.status !== 200) {
                throw new DiscoveryLoadError(
                    res.status,
                    `Discovery-Endpoint antwortete mit HTTP ${res.status}`,
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

            const res = await http(`${options.endpoint}/rescan`, { method: 'POST', headers });
            if (res.status !== 200 && res.status !== 201) {
                throw new DiscoveryLoadError(
                    res.status,
                    `Discovery-Rescan antwortete mit HTTP ${res.status}`,
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
