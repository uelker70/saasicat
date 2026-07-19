// useCatalogEntries — Vue-3-Composable für den Discovery-Review
// (Backend: CatalogEntriesController unter /admin/catalog/{capabilities,
// features,quotas} + /admin/catalog/discovery/sync).
//
// Discovery (`/admin/discovery`) ist der Code-Ist-Zustand; dieses Composable
// liest/schreibt den persistierten Review-Status + die Übersetzungen.
//
// **Admin-Endpoint-Prefix ist Pflicht** und wird vom Konsumenten geliefert
// (AutohausPro: `/api/admin`, vereinsfux: `/api/v1/admin`).
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §6.3

import { ref, type Ref } from 'vue';
import type {
    CapabilityCatalogEntryRow,
    CatalogEntryI18n,
    DiscoverySnapshot,
    FeatureCatalogEntryRow,
    QuotaCatalogEntryRow,
    ReviewCatalogEntryData,
    SyncDiscoveryResult,
    UpdateCatalogEntryBaseData,
} from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export interface UseCatalogEntriesOptions {
    /** Admin-Endpoint-Prefix inkl. globalPrefix (`/api/admin`, `/api/v1/admin`). */
    adminEndpoint: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /** projectKey, gegen den die Catalog-Entries gefiltert werden. */
    projectKey: string;
    autoLoad?: boolean;
}

export class CatalogEntriesApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        message: string,
    ) {
        super(message);
        this.name = 'CatalogEntriesApiError';
    }
}

export interface UseCatalogEntriesResult {
    capabilities: Ref<CapabilityCatalogEntryRow[]>;
    features: Ref<FeatureCatalogEntryRow[]>;
    quotas: Ref<QuotaCatalogEntryRow[]>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;

    load: () => Promise<void>;
    /** Freigabe-Übergang eines Features (#20): PATCH …/features/:key/review. */
    reviewFeature: (
        featureKey: string,
        data: ReviewCatalogEntryData,
    ) => Promise<FeatureCatalogEntryRow>;
    /** Freigabe-Übergang einer Quota (#20): PATCH …/quotas/:key/review. */
    reviewQuota: (quotaKey: string, data: ReviewCatalogEntryData) => Promise<QuotaCatalogEntryRow>;
    setFeatureI18n: (featureKey: string, i18n: CatalogEntryI18n) => Promise<FeatureCatalogEntryRow>;
    setQuotaI18n: (quotaKey: string, i18n: CatalogEntryI18n) => Promise<QuotaCatalogEntryRow>;
    /** Setzt das editierbare Default-Locale-Label/-Beschreibung eines Features. */
    setFeatureBase: (
        featureKey: string,
        data: UpdateCatalogEntryBaseData,
    ) => Promise<FeatureCatalogEntryRow>;
    /** Setzt das editierbare Default-Locale-Label/-Beschreibung einer Quota. */
    setQuotaBase: (
        quotaKey: string,
        data: UpdateCatalogEntryBaseData,
    ) => Promise<QuotaCatalogEntryRow>;
    /** Upsertet die Catalog-Entries aus einem Discovery-Snapshot und lädt neu. */
    syncDiscovery: (snapshot: DiscoverySnapshot) => Promise<SyncDiscoveryResult>;
}

export function useCatalogEntries(options: UseCatalogEntriesOptions): UseCatalogEntriesResult {
    if (!options?.adminEndpoint) {
        throw new Error('useCatalogEntries: `adminEndpoint` ist Pflicht.');
    }
    if (!options?.projectKey) {
        throw new Error('useCatalogEntries: `projectKey` ist Pflicht.');
    }

    const http = options.http ?? defaultHttpClient();
    const capabilities = ref<CapabilityCatalogEntryRow[]>([]);
    const features = ref<FeatureCatalogEntryRow[]>([]);
    const quotas = ref<QuotaCatalogEntryRow[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    const base = `${options.adminEndpoint}/catalog`;
    const pk = encodeURIComponent(options.projectKey);

    function authHeaders(): Record<string, string> {
        const token = options.getAuthToken?.();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function fetchJson<T>(url: string, init?: Parameters<HttpClient>[1]): Promise<T | null> {
        const res = await http(url, {
            method: init?.method ?? 'GET',
            headers: { 'content-type': 'application/json', ...authHeaders(), ...init?.headers },
            body: init?.body,
        });
        if (res.status === 204) return null;
        const body = await res.json().catch(() => null);
        if (res.status >= 400) {
            throw new CatalogEntriesApiError(
                res.status,
                body,
                `Catalog-Entries-API antwortete mit HTTP ${res.status}`,
            );
        }
        return body as T;
    }

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const [caps, feats, qs] = await Promise.all([
                fetchJson<CapabilityCatalogEntryRow[]>(`${base}/capabilities?projectKey=${pk}`),
                fetchJson<FeatureCatalogEntryRow[]>(`${base}/features?projectKey=${pk}`),
                fetchJson<QuotaCatalogEntryRow[]>(`${base}/quotas?projectKey=${pk}`),
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
            `${base}/features/${encodeURIComponent(featureKey)}/review?projectKey=${pk}`,
            { method: 'PATCH', body: JSON.stringify(data) },
        );
        if (!updated) throw new CatalogEntriesApiError(0, null, 'Review gab keinen Body zurück');
        features.value = features.value.map((f) => (f.featureKey === featureKey ? updated : f));
        return updated;
    }

    async function reviewQuota(
        quotaKey: string,
        data: ReviewCatalogEntryData,
    ): Promise<QuotaCatalogEntryRow> {
        const updated = await fetchJson<QuotaCatalogEntryRow>(
            `${base}/quotas/${encodeURIComponent(quotaKey)}/review?projectKey=${pk}`,
            { method: 'PATCH', body: JSON.stringify(data) },
        );
        if (!updated) throw new CatalogEntriesApiError(0, null, 'Review gab keinen Body zurück');
        quotas.value = quotas.value.map((q) => (q.quotaKey === quotaKey ? updated : q));
        return updated;
    }

    async function setFeatureI18n(
        featureKey: string,
        i18n: CatalogEntryI18n,
    ): Promise<FeatureCatalogEntryRow> {
        const updated = await fetchJson<FeatureCatalogEntryRow>(
            `${base}/features/${encodeURIComponent(featureKey)}/i18n?projectKey=${pk}`,
            { method: 'PATCH', body: JSON.stringify({ i18n }) },
        );
        if (!updated) throw new CatalogEntriesApiError(0, null, 'i18n gab keinen Body zurück');
        features.value = features.value.map((f) => (f.featureKey === featureKey ? updated : f));
        return updated;
    }

    async function setQuotaI18n(
        quotaKey: string,
        i18n: CatalogEntryI18n,
    ): Promise<QuotaCatalogEntryRow> {
        const updated = await fetchJson<QuotaCatalogEntryRow>(
            `${base}/quotas/${encodeURIComponent(quotaKey)}/i18n?projectKey=${pk}`,
            { method: 'PATCH', body: JSON.stringify({ i18n }) },
        );
        if (!updated) throw new CatalogEntriesApiError(0, null, 'i18n gab keinen Body zurück');
        quotas.value = quotas.value.map((q) => (q.quotaKey === quotaKey ? updated : q));
        return updated;
    }

    async function setFeatureBase(
        featureKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<FeatureCatalogEntryRow> {
        const updated = await fetchJson<FeatureCatalogEntryRow>(
            `${base}/features/${encodeURIComponent(featureKey)}?projectKey=${pk}`,
            { method: 'PATCH', body: JSON.stringify(data) },
        );
        if (!updated) throw new CatalogEntriesApiError(0, null, 'Base gab keinen Body zurück');
        features.value = features.value.map((f) => (f.featureKey === featureKey ? updated : f));
        return updated;
    }

    async function setQuotaBase(
        quotaKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<QuotaCatalogEntryRow> {
        const updated = await fetchJson<QuotaCatalogEntryRow>(
            `${base}/quotas/${encodeURIComponent(quotaKey)}?projectKey=${pk}`,
            { method: 'PATCH', body: JSON.stringify(data) },
        );
        if (!updated) throw new CatalogEntriesApiError(0, null, 'Base gab keinen Body zurück');
        quotas.value = quotas.value.map((q) => (q.quotaKey === quotaKey ? updated : q));
        return updated;
    }

    async function syncDiscovery(snapshot: DiscoverySnapshot): Promise<SyncDiscoveryResult> {
        const result = await fetchJson<SyncDiscoveryResult>(`${base}/discovery/sync`, {
            method: 'POST',
            body: JSON.stringify({ snapshot }),
        });
        if (!result) throw new CatalogEntriesApiError(0, null, 'Sync gab keinen Body zurück');
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
