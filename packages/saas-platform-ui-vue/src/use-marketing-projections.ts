// useMarketingProjections — Vue-3-Composable über den
// MarketingProjectionsController (`/admin/catalog/marketing-projections`).
//
// Anders als Bundle/BusinessType **ohne Versionierung**: Marketing-Edits
// gehen direkt live. Das Composable cached die Liste pro Filter-Tupel
// nicht, sondern lädt bei jedem `load()` frisch — Marketing-Pflege ist
// niedrig-frequent und Konsistenz wichtiger als Performance.

import { ref, type Ref } from 'vue';
import type {
    CreateMarketingProjectionData,
    MarketingProjectionFilter,
    MarketingProjectionRow,
    UpdateMarketingProjectionData,
} from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export interface UseMarketingProjectionsOptions {
    adminEndpoint: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /** Filter, der bei `load()` aktiv ist. Kann via `setFilter()` geändert werden. */
    filter: MarketingProjectionFilter;
    autoLoad?: boolean;
}

export class MarketingProjectionsApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        message: string,
    ) {
        super(message);
        this.name = 'MarketingProjectionsApiError';
    }
}

export interface UseMarketingProjectionsResult {
    projections: Ref<MarketingProjectionRow[]>;
    filter: Ref<MarketingProjectionFilter>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;

    /** Ändert den Filter und lädt frisch. */
    setFilter: (next: MarketingProjectionFilter) => Promise<void>;
    load: () => Promise<void>;
    create: (data: CreateMarketingProjectionData) => Promise<MarketingProjectionRow>;
    update: (id: string, data: UpdateMarketingProjectionData) => Promise<MarketingProjectionRow>;
    remove: (id: string) => Promise<void>;
}

export function useMarketingProjections(
    options: UseMarketingProjectionsOptions,
): UseMarketingProjectionsResult {
    if (!options?.adminEndpoint) {
        throw new Error('useMarketingProjections: `adminEndpoint` ist Pflicht.');
    }
    if (!options?.filter?.projectKey) {
        throw new Error('useMarketingProjections: `filter.projectKey` ist Pflicht.');
    }

    const http = options.http ?? defaultHttpClient();
    const projections = ref<MarketingProjectionRow[]>([]);
    const filter = ref<MarketingProjectionFilter>({ ...options.filter });
    const loading = ref(false);
    const error = ref<Error | null>(null);

    const baseUrl = `${options.adminEndpoint}/catalog/marketing-projections`;

    function authHeaders(): Record<string, string> {
        const token = options.getAuthToken?.();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    function buildListUrl(): string {
        const params = new URLSearchParams();
        params.set('projectKey', filter.value.projectKey);
        if (filter.value.targetType) params.set('targetType', filter.value.targetType);
        if (filter.value.targetVersionId)
            params.set('targetVersionId', filter.value.targetVersionId);
        if (filter.value.locale) params.set('locale', filter.value.locale);
        return `${baseUrl}?${params.toString()}`;
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
            throw new MarketingProjectionsApiError(
                res.status,
                body,
                `MarketingProjections-API antwortete mit HTTP ${res.status}`,
            );
        }
        return body as T;
    }

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchJson<MarketingProjectionRow[]>(buildListUrl());
            projections.value = data ?? [];
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function setFilter(next: MarketingProjectionFilter): Promise<void> {
        filter.value = { ...next };
        await load();
    }

    async function create(data: CreateMarketingProjectionData): Promise<MarketingProjectionRow> {
        const created = await fetchJson<MarketingProjectionRow>(baseUrl, {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!created) {
            throw new MarketingProjectionsApiError(0, null, 'Create gab keinen Body zurück');
        }
        // Nach Create: liste neu laden (eindeutiges Tupel-Insert kann
        // sich auf Filter auswirken).
        await load();
        return created;
    }

    async function update(
        id: string,
        data: UpdateMarketingProjectionData,
    ): Promise<MarketingProjectionRow> {
        const updated = await fetchJson<MarketingProjectionRow>(`${baseUrl}/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
        if (!updated) {
            throw new MarketingProjectionsApiError(0, null, 'Update gab keinen Body zurück');
        }
        projections.value = projections.value.map((p) => (p.id === id ? updated : p));
        return updated;
    }

    async function remove(id: string): Promise<void> {
        await fetchJson<null>(`${baseUrl}/${id}`, { method: 'DELETE' });
        projections.value = projections.value.filter((p) => p.id !== id);
    }

    if (options.autoLoad) {
        void load();
    }

    return { projections, filter, loading, error, setFilter, load, create, update, remove };
}
