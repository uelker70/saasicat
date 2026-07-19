// usePromotions — Vue-3-Composable für die SuperAdmin-Aktionen-Verwaltung
// (Backend: PromotionsController unter /admin/catalog/promotions).
//
// **Admin-Endpoint-Prefix ist Pflicht** und wird vom Konsumenten geliefert
// (AutohausPro: `/api/admin`, vereinsfux: `/api/v1/admin`).
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §9a

import { ref, type Ref } from 'vue';
import type {
    CreatePromotionData,
    PromotionRow,
    UpdatePromotionData,
} from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export interface UsePromotionsOptions {
    adminEndpoint: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    projectKey: string;
    autoLoad?: boolean;
}

export class PromotionsApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        message: string,
    ) {
        super(message);
        this.name = 'PromotionsApiError';
    }
}

export interface UsePromotionsResult {
    promotions: Ref<PromotionRow[]>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    load: () => Promise<void>;
    create: (data: CreatePromotionData) => Promise<PromotionRow>;
    update: (id: string, data: UpdatePromotionData) => Promise<PromotionRow>;
    remove: (id: string) => Promise<void>;
}

export function usePromotions(options: UsePromotionsOptions): UsePromotionsResult {
    if (!options?.adminEndpoint) {
        throw new Error('usePromotions: `adminEndpoint` ist Pflicht.');
    }
    if (!options?.projectKey) {
        throw new Error('usePromotions: `projectKey` ist Pflicht.');
    }

    const http = options.http ?? defaultHttpClient();
    const promotions = ref<PromotionRow[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    const baseUrl = `${options.adminEndpoint}/catalog/promotions`;
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
            throw new PromotionsApiError(
                res.status,
                body,
                `Promotions-API antwortete mit HTTP ${res.status}`,
            );
        }
        return body as T;
    }

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchJson<PromotionRow[]>(`${baseUrl}?projectKey=${pk}`);
            promotions.value = data ?? [];
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function create(data: CreatePromotionData): Promise<PromotionRow> {
        const created = await fetchJson<PromotionRow>(baseUrl, {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!created) throw new PromotionsApiError(0, null, 'Create gab keinen Body zurück');
        promotions.value = [...promotions.value, created];
        return created;
    }

    async function update(id: string, data: UpdatePromotionData): Promise<PromotionRow> {
        const updated = await fetchJson<PromotionRow>(`${baseUrl}/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
        if (!updated) throw new PromotionsApiError(0, null, 'Update gab keinen Body zurück');
        promotions.value = promotions.value.map((p) => (p.id === id ? updated : p));
        return updated;
    }

    async function remove(id: string): Promise<void> {
        await fetchJson<null>(`${baseUrl}/${id}`, { method: 'DELETE' });
        promotions.value = promotions.value.filter((p) => p.id !== id);
    }

    if (options.autoLoad) {
        void load();
    }

    return { promotions, loading, error, load, create, update, remove };
}
