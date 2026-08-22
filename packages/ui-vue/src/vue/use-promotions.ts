// usePromotions — Vue 3 composable for SuperAdmin promotions management
// (backend: PromotionsController under /admin/catalog/promotions).
//
// **The admin endpoint prefix is mandatory** and is supplied by the consumer
// (e.g. `/api/admin` or `/api/v1/admin`).

import { ref, type Ref } from 'vue';
import { markEmptyResponse, markPlatformError } from '../client/admin-error.js';
import type { CreatePromotionData, PromotionRow, UpdatePromotionData } from '@saasicat/types';
import { requireServerAnswer } from '../client/http-json.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UsePromotionsOptions {
    adminEndpoint: string;
    http?: HttpClient;
    projectKey: string;
    autoLoad?: boolean;
}

/**
 * A promotions call failed. Its `message` is a diagnostic for the log, in
 * English like every other developer-facing string in the repository — the
 * sentence a user is shown comes from the `errors` catalog through
 * `adminErrorMessage`, in whichever language the shell speaks.
 */
export class PromotionsApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        message: string,
    ) {
        super(message);
        this.name = 'PromotionsApiError';
        // Identity, so `toAdminError` can tell this diagnostic from a
        // consumer error whose message an operator needs to read.
        markPlatformError(this);
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
        throw new Error('usePromotions: `adminEndpoint` is required.');
    }
    if (!options?.projectKey) {
        throw new Error('usePromotions: `projectKey` is required.');
    }

    const http = options.http ?? defaultHttpClient();
    const promotions = ref<PromotionRow[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    const baseUrl = `${options.adminEndpoint}/catalog/promotions`;
    const pk = encodeURIComponent(options.projectKey);

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
            (diagnostic) => new PromotionsApiError(res.status, null, diagnostic),
        );
        if (res.status === 204) return null;
        const body = await res.json().catch(() => null);
        if (res.status >= 400) {
            throw new PromotionsApiError(
                res.status,
                body,
                `Promotions API responded with HTTP ${res.status}`,
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
        if (!created)
            throw markEmptyResponse(new PromotionsApiError(0, null, 'Create returned no body'));
        promotions.value = [...promotions.value, created];
        return created;
    }

    async function update(id: string, data: UpdatePromotionData): Promise<PromotionRow> {
        const updated = await fetchJson<PromotionRow>(`${baseUrl}/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
        if (!updated)
            throw markEmptyResponse(new PromotionsApiError(0, null, 'Update returned no body'));
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
