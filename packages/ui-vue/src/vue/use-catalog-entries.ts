// useCatalogEntries — Vue 3 composable for the Discovery review
// (Backend: CatalogEntriesController under /admin/catalog/{capabilities,
// features,quotas} + /admin/catalog/discovery/sync).
//
// Discovery (`/admin/discovery`) is the code's actual state; this composable
// reads/writes the persisted review status + the translations.
//
// **Admin endpoint prefix is required** and is supplied by the consumer
// (e.g. `/api/admin` or `/api/v1/admin`).

import { ref, type Ref } from 'vue';
import { markEmptyResponse, markPlatformError } from '../client/admin-error.js';
import type {
    CapabilityCatalogEntryRow,
    CatalogEntryI18n,
    DiscoverySnapshot,
    FeatureCatalogEntryRow,
    QuotaCatalogEntryRow,
    ReviewCatalogEntryData,
    SyncDiscoveryResult,
    UpdateCatalogEntryBaseData,
} from '@saasicat/core';
import { requireServerAnswer } from '../client/http-json.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseCatalogEntriesOptions {
    /** Admin endpoint prefix incl. globalPrefix (`/api/admin`, `/api/v1/admin`). */
    adminEndpoint: string;
    http?: HttpClient;
    autoLoad?: boolean;
}

/**
 * A catalog-entries call failed. Its `message` is a diagnostic for the log, in
 * English like every other developer-facing string in the repository — the
 * sentence a user is shown comes from the `errors` catalog through
 * `adminErrorMessage`, in whichever language the shell speaks.
 */
export class CatalogEntriesApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        message: string,
    ) {
        super(message);
        this.name = 'CatalogEntriesApiError';
        // Identity, so `toAdminError` can tell this diagnostic from a
        // consumer error whose message an operator needs to read.
        markPlatformError(this);
    }
}

export interface UseCatalogEntriesResult {
    capabilities: Ref<CapabilityCatalogEntryRow[]>;
    features: Ref<FeatureCatalogEntryRow[]>;
    quotas: Ref<QuotaCatalogEntryRow[]>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;

    load: () => Promise<void>;
    /** Approval transition of a feature (#20): PATCH …/features/:key/review. */
    reviewFeature: (
        featureKey: string,
        data: ReviewCatalogEntryData,
    ) => Promise<FeatureCatalogEntryRow>;
    /** Approval transition of a quota (#20): PATCH …/quotas/:key/review. */
    reviewQuota: (quotaKey: string, data: ReviewCatalogEntryData) => Promise<QuotaCatalogEntryRow>;
    setFeatureI18n: (featureKey: string, i18n: CatalogEntryI18n) => Promise<FeatureCatalogEntryRow>;
    setQuotaI18n: (quotaKey: string, i18n: CatalogEntryI18n) => Promise<QuotaCatalogEntryRow>;
    /** Sets the editable default-locale label/description of a feature. */
    setFeatureBase: (
        featureKey: string,
        data: UpdateCatalogEntryBaseData,
    ) => Promise<FeatureCatalogEntryRow>;
    /** Sets the editable default-locale label/description of a quota. */
    setQuotaBase: (
        quotaKey: string,
        data: UpdateCatalogEntryBaseData,
    ) => Promise<QuotaCatalogEntryRow>;
    /** Upserts the catalog entries from a discovery snapshot and reloads. */
    syncDiscovery: (snapshot: DiscoverySnapshot) => Promise<SyncDiscoveryResult>;
}

export function useCatalogEntries(options: UseCatalogEntriesOptions): UseCatalogEntriesResult {
    if (!options?.adminEndpoint) {
        throw new Error('useCatalogEntries: `adminEndpoint` is required.');
    }
    const http = options.http ?? defaultHttpClient();
    const capabilities = ref<CapabilityCatalogEntryRow[]>([]);
    const features = ref<FeatureCatalogEntryRow[]>([]);
    const quotas = ref<QuotaCatalogEntryRow[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    const base = `${options.adminEndpoint}/catalog`;

    function authHeaders(): Record<string, string> {
        return {};
    }

    async function fetchJson<T>(url: string, init?: Parameters<HttpClient>[1]): Promise<T | null> {
        const method = init?.method ?? 'GET';
        const res = await http(url, {
            method,
            headers: { 'content-type': 'application/json', ...authHeaders(), ...init?.headers },
            body: init?.body,
        });
        // Before any body is read: `null` below has to mean "the server
        // answered without one", which is what the callers' empty-response
        // sentinels claim.
        requireServerAnswer(
            res.status,
            method,
            url,
            (diagnostic) => new CatalogEntriesApiError(res.status, null, diagnostic),
        );
        if (res.status === 204) return null;
        const body = await res.json().catch(() => null);
        if (res.status >= 400) {
            throw new CatalogEntriesApiError(
                res.status,
                body,
                `Catalog entries API responded with HTTP ${res.status}`,
            );
        }
        return body as T;
    }

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const [caps, feats, qs] = await Promise.all([
                fetchJson<CapabilityCatalogEntryRow[]>(`${base}/capabilities`),
                fetchJson<FeatureCatalogEntryRow[]>(`${base}/features`),
                fetchJson<QuotaCatalogEntryRow[]>(`${base}/quotas`),
            ]);
            capabilities.value = caps ?? [];
            features.value = feats ?? [];
            quotas.value = qs ?? [];
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function reviewFeature(
        featureKey: string,
        data: ReviewCatalogEntryData,
    ): Promise<FeatureCatalogEntryRow> {
        const updated = await fetchJson<FeatureCatalogEntryRow>(
            `${base}/features/${encodeURIComponent(featureKey)}/review`,
            { method: 'PATCH', body: JSON.stringify(data) },
        );
        if (!updated)
            throw markEmptyResponse(new CatalogEntriesApiError(0, null, 'Review returned no body'));
        features.value = features.value.map((f) => (f.featureKey === featureKey ? updated : f));
        return updated;
    }

    async function reviewQuota(
        quotaKey: string,
        data: ReviewCatalogEntryData,
    ): Promise<QuotaCatalogEntryRow> {
        const updated = await fetchJson<QuotaCatalogEntryRow>(
            `${base}/quotas/${encodeURIComponent(quotaKey)}/review`,
            { method: 'PATCH', body: JSON.stringify(data) },
        );
        if (!updated)
            throw markEmptyResponse(new CatalogEntriesApiError(0, null, 'Review returned no body'));
        quotas.value = quotas.value.map((q) => (q.quotaKey === quotaKey ? updated : q));
        return updated;
    }

    async function setFeatureI18n(
        featureKey: string,
        i18n: CatalogEntryI18n,
    ): Promise<FeatureCatalogEntryRow> {
        const updated = await fetchJson<FeatureCatalogEntryRow>(
            `${base}/features/${encodeURIComponent(featureKey)}/i18n`,
            { method: 'PATCH', body: JSON.stringify({ i18n }) },
        );
        if (!updated)
            throw markEmptyResponse(new CatalogEntriesApiError(0, null, 'i18n returned no body'));
        features.value = features.value.map((f) => (f.featureKey === featureKey ? updated : f));
        return updated;
    }

    async function setQuotaI18n(
        quotaKey: string,
        i18n: CatalogEntryI18n,
    ): Promise<QuotaCatalogEntryRow> {
        const updated = await fetchJson<QuotaCatalogEntryRow>(
            `${base}/quotas/${encodeURIComponent(quotaKey)}/i18n`,
            { method: 'PATCH', body: JSON.stringify({ i18n }) },
        );
        if (!updated)
            throw markEmptyResponse(new CatalogEntriesApiError(0, null, 'i18n returned no body'));
        quotas.value = quotas.value.map((q) => (q.quotaKey === quotaKey ? updated : q));
        return updated;
    }

    async function setFeatureBase(
        featureKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<FeatureCatalogEntryRow> {
        const updated = await fetchJson<FeatureCatalogEntryRow>(
            `${base}/features/${encodeURIComponent(featureKey)}`,
            { method: 'PATCH', body: JSON.stringify(data) },
        );
        if (!updated)
            throw markEmptyResponse(new CatalogEntriesApiError(0, null, 'Base returned no body'));
        features.value = features.value.map((f) => (f.featureKey === featureKey ? updated : f));
        return updated;
    }

    async function setQuotaBase(
        quotaKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<QuotaCatalogEntryRow> {
        const updated = await fetchJson<QuotaCatalogEntryRow>(
            `${base}/quotas/${encodeURIComponent(quotaKey)}`,
            { method: 'PATCH', body: JSON.stringify(data) },
        );
        if (!updated)
            throw markEmptyResponse(new CatalogEntriesApiError(0, null, 'Base returned no body'));
        quotas.value = quotas.value.map((q) => (q.quotaKey === quotaKey ? updated : q));
        return updated;
    }

    async function syncDiscovery(snapshot: DiscoverySnapshot): Promise<SyncDiscoveryResult> {
        const result = await fetchJson<SyncDiscoveryResult>(`${base}/discovery/sync`, {
            method: 'POST',
            body: JSON.stringify({ snapshot }),
        });
        if (!result)
            throw markEmptyResponse(new CatalogEntriesApiError(0, null, 'Sync returned no body'));
        await load();
        return result;
    }

    if (options.autoLoad) {
        void load();
    }

    return {
        capabilities,
        features,
        quotas,
        loading,
        error,
        load,
        reviewFeature,
        reviewQuota,
        setFeatureI18n,
        setQuotaI18n,
        setFeatureBase,
        setQuotaBase,
        syncDiscovery,
    };
}
